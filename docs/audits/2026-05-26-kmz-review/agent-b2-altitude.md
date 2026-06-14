# Agent B2 — Altitude encoding end-to-end

Scope: every byte of altitude data in the DJI KMZ/WPML exporter, the math
under it, and the geoid model. The current scheme is `executeHeightMode =
relativeToStartPoint` with `executeHeight = wp_MSL - takeoff_ref_msl`
(geoid-free), `ellipsoidHeight = msl_to_hae(lat, lon, wp_MSL)` carrying HAE,
and `takeOffRefPoint.z = msl_to_hae(...)`. Audited against the WPML 1.0.6
spec (`template-kml.md`, `waylines-wpml.md`, `common-element.md` — fetched
2026-05-26).

The exporter recovered cleanly from the descend-to-ground bug recorded in
`docs/kmz-wpml-audit.md` §12, and the post-`#726` shape is structurally
correct. The remaining altitude-encoding risks are concentrated in the
**airborne-scope anchor** (MO/NTL anchor against a single
`airport.elevation` constant), the **`takeOffRefPoint.z` HAE conversion**
(coarse closed-form EGM96 model is only calibrated for LZIB ±~1000 km),
**silent clamping** when a measurement resolves below the anchor, and a
handful of **spec-conformance items** in the waylines folder.

## Summary
- P0 blockers: 3
- P1 high: 4
- P2 conformance: 3
- P3 upgrades: 2

## Findings

### [P0-1] Airborne-scope `executeHeight` anchor uses one flat `airport.elevation` for terrain that may not match WP1's actual ground

- **Severity**: blocker
- **Location**: `backend/app/services/export/dji/mission_config.py:110-134` (`_takeoff_ref_msl`); `backend/app/services/export/orchestrator.py:146-151` (`airport_elevation = airport.elevation`)
- **Spec**: `executeHeightMode = relativeToStartPoint` — "Relative take-off point altitude model" (`waylines-wpml.md`). The relative origin is the *aircraft's actual takeoff fix* at flight time. The exporter chooses the stored anchor that the placemark heights subtract from.
- **Current behavior**: For `MEASUREMENTS_ONLY` / `NO_TAKEOFF_LANDING`, `_takeoff_ref_msl` unconditionally returns `airport_elevation` (the single column from `airport.elevation`). That value also flows into `executeHeight = wp.alt - airport_elevation` for every placemark and into `takeOffRefPoint.z`. The orchestrator threads only the airport-wide constant — there is no per-point elevation lookup at WP1's lat/lon despite the elevation provider stack added in audit `2026-05-11-papi-altitude-camera-aim.md`.
- **Why it's wrong**: When the operator hand-launches in MO/NTL, the real ground at WP1 lat/lon can differ from `airport.elevation` by several metres on airports with terrain variation (the very reason `_normalize_position_altitude` was introduced for LHAs/obstacles). `executeHeight` is baked into the file as `wp_MSL - airport_elevation`. At flight time the firmware substitutes the *runtime* ground takeoff alt for the anchor, so the executed altitude becomes `runtime_takeoff_MSL + (wp_MSL - airport_elevation)`. If real ground at the takeoff spot sits LOWER than `airport.elevation` by ΔH (e.g. operator stands in a depression beside a hangar; airport ELEVATION is the highest of declared / runway / threshold per ICAO), every commanded altitude is ΔH BELOW intended. For a 8 m AGL HR measurement and ΔH = 5 m, the drone executes at 3 m AGL — inside the safety floor and potentially below obstacles the planner cleared at 8 m.
- **Evidence**: `_takeoff_ref_msl` for airborne scopes (line 119-120): `if scope in _AIRBORNE_SCOPES: return airport_elevation`. The frontend already resolves per-point ground via `GET /api/v1/airports/{id}/elevation` for the FULL takeoff coord (`airport_service.get_elevation_at_point`), but the export call site in `orchestrator.py:151` short-circuits to `airport.elevation`. The 2026-05-11 audit explicitly notes: "ignore[s] real terrain variation" was the symptom-cause for the PAPI/takeoff bug.
- **Proposed fix**: For airborne scopes, resolve the anchor as `provider.get_elevation(wp1_lon, wp1_lat)` using `create_elevation_provider(airport, allow_api=False)` (DEM-aware if uploaded). Fall back to `airport_elevation` only when the lookup returns None. Thread the provider into the KMZ/WPML generators (or pre-resolve in the orchestrator and pass an explicit `takeoff_anchor_msl: float` arg). Document operator-facing guidance: in MO/NTL, hand-launch as close as possible to the resolved WP1 ground point.
- **HW verify**: Pick an MO mission at an airport with ≥3 m terrain variation across the operating area (LZIB and Jaro Luka both qualify). Hand-launch at three different positions: (a) at airport ground reference; (b) ~5 m higher; (c) ~5 m lower. For each, fly the same KMZ and record at WP4-WP6: actual altitude AGL via the drone telemetry, geometric distance to PAPI fixture, and 7× framing offset. Without the fix, (b) flies 5 m too high and (c) flies 5 m too low. With the fix, all three should hit the planned AGL within ±1 m.

### [P0-2] FULL-scope first placemark emits `executeHeight=0`, which can collide with `takeOffSecurityHeight=20`

- **Severity**: blocker
- **Location**: `backend/app/services/export/dji/placemark.py:167-180` and `192-202`; `backend/app/services/export/dji/mission_config.py:202` (`security_height = "20"` on FULL).
- **Spec**: `common-element.md` defines `takeOffSecurityHeight` as the climb-to-safety altitude reached *before* the wayline starts when `flyToWaylineMode=safely`. The `kmz-wpml-audit.md` §3 symptom table calls out "first waypoint height below `takeOffSecurityHeight`" as a known cause of the "lands at start" Pilot 2 behavior.
- **Current behavior**: In FULL scope, the first placemark is a `TAKEOFF` waypoint at `mission.takeoff_coordinate`. `_takeoff_ref_msl` resolves to `takeoff_coordinate.alt`, so the first placemark's `executeHeight = takeoff_coordinate.alt - takeoff_coordinate.alt = 0.000000`. Meanwhile `takeOffSecurityHeight = 20` and `flyToWaylineMode = safely`. After the drone climbs to 20 m to enter the wayline, the first placemark commands `executeHeight=0`, asking the drone to descend back to takeoff ground level before transiting onward.
- **Why it's wrong**: Per the audit's own §3 root-cause table this is one of the "lands at start" symptom patterns. Even if Pilot 2 doesn't outright reject the file, the drone briefly descends to ground at the start of the wayline — exactly the descend-to-ground symptom the post-#726 fix was designed to eliminate. The clamp branch (line 169-180) doesn't fire (the value is 0, not negative), so no warning is logged either. The second placemark is typically a transit climb (≥5 m AGL by `MIN_TRANSIT_ALTITUDE_AGL_M`), so the descent is short, but it is a real downward command issued to the drone right after climb-to-security.
- **Evidence**: `_append_placemark` is called for every waypoint including TAKEOFF/LANDING — there is no scope-aware skip. `mission_config.py:202` sets FULL `takeOffSecurityHeight=20`. No code path raises the TAKEOFF placemark's `executeHeight` above 0 or skips it for emission.
- **Proposed fix**: Two options, pick one:
  1. **Skip TAKEOFF and LANDING placemarks** in the waylines.wpml (and emit them as informational in template.kml only). The wayline is supposed to be the in-air flight path; takeoff and landing are orchestrated by `flyToWaylineMode=safely` + `finishAction=goHome`. This matches the DJI MSDK reference `waypointsample.kmz` shape (which has no ground waypoints in the wayline).
  2. **Floor TAKEOFF placemark `executeHeight` at `takeOffSecurityHeight + 0.5`** so the wayline picks up *above* the safety climb and the drone proceeds laterally instead of descending. Document the deviation from `wp.alt` in a comment.
- **HW verify**: Generate a FULL-scope KMZ for a mission with the operator takeoff coord at airport ground. Import to Pilot 2 on the M4T. Begin mission. Verify the drone climbs to 20 m and proceeds laterally to the first MEASUREMENT *without* a downward dip. With the current code, expect a 20 m → 0 m → climb-back-to-measurement dip. Capture flight telemetry altitude trace.

### [P0-3] Below-takeoff measurement clamps silently to 0 with no operator-visible signal

- **Severity**: blocker (because the operator never sees it)
- **Location**: `backend/app/services/export/dji/placemark.py:167-180`
- **Spec**: WPML `executeHeight` has no documented negative-value contract (`waylines-wpml.md`: "no explicit range" per the fetched spec body); the exporter's choice to clamp at 0 is reasoned but a measurement below the takeoff anchor is genuinely outside the relative frame.
- **Current behavior**: When `wp.alt < takeoff_ref_msl`, the placemark emits `executeHeight=0.000000` for that waypoint and logs ONE warning per waypoint to the `app.services.export.dji.placemark` logger. The warning is not surfaced in the export response, validation panel, PDF, or audit row.
- **Why it's wrong**: The drone executes `executeHeight=0` literally — it flies at runtime-takeoff-ground level for that waypoint, not at the planner's intended `wp.alt`. On undulating terrain the drone descends back to takeoff-ground at the clamped WP's lat/lon, potentially well below the surrounding terrain or below obstacles cleared by the planner at the intended `wp.alt`. The clamp is *safer than emitting negative* (which Pilot 2 would reject with `WaypointHeightOutOfRange`), but the user never learns the file was modified.
- **Evidence**: `placemark.py:174-179` — `logger.warning(...)` only. No `caplog`-equivalent surface; no validation suggestion appended; no operator UI feedback. The validation pipeline runs *before* the export, so even a re-validate cannot flag this.
- **Proposed fix**: Two parts. (1) **Emit a validation suggestion at export time** with `violation_kind="below_takeoff_clamp"` listing the affected `waypoint_ids` so the operator sees a banner before downloading. (2) **Refuse to export** when `>0` waypoints would clamp on FULL scope (in MO/NTL the operator can argue the hand-launch was higher than expected, but in FULL the takeoff coord is authoritative — a measurement below it is a planner bug). Or at minimum, return the clamped count in the export response body so the UI can warn.
- **HW verify**: Simulate by planting a synthetic measurement at `wp.alt = takeoff_msl - 5`. Generate the KMZ. Verify the operator-visible banner before the download link enables. After the warning surfaces, no HW step is needed for THIS finding — the surfacing is a UI assertion.

### [P1-1] `point_lonlatalt` silently defaults alt to 0 on 2D points; cascades to clamp-to-0 with no signal

- **Severity**: high
- **Location**: `backend/app/core/geometry.py:49-57` (`point_lonlatalt`); consumed by `placemark.py:167` and `mission_config.py:94, 100, 104, 124, 130`
- **Spec**: No WPML implication — this is an internal contract. The CLAUDE.md project rule explicitly says `point_lonlatalt` is "strict — raises `ValueError` on empty/None/non-Point; a missing waypoint position is a data bug, not a `(0, 0, 0)` Null Island fallback".
- **Current behavior**: For a Point WKT without a Z component (`POINT (lon lat)` instead of `POINT Z (lon lat alt)`), `point_lonlatalt` returns `(lon, lat, 0.0)` silently — line 57: `float(coords[2]) if len(coords) > 2 else 0.0`. The "strict" contract in the docstring is partial — it raises on missing/non-Point, but not on a Point without Z.
- **Why it's wrong**: A 2D waypoint reaching the exporter (e.g. a DB row written by a legacy ingestion path, a manual SQL fix, a future bulk-import tool) would compute `executeHeight = 0 - takeoff_ref_msl`, which is a large negative number that THEN gets clamped to 0 by the existing clamp (with a warning that says "below the takeoff reference" — confusing because the cause is a missing Z, not real terrain). The drone would fly the entire mission at takeoff-ground level.
- **Evidence**: `geometry.py:57` returns `0.0` on missing Z. The CLAUDE.md gotcha is explicit about strictness; the code is laxer.
- **Proposed fix**: Either (a) require Z in the geometry helper (`raise ValueError("missing altitude in Point geometry")`) to match the documented strict contract, or (b) keep the soft fallback but log a distinct WARNING in `_append_placemark` that names the cause ("waypoint %s has no altitude in its geometry; treating as 0 MSL"). Pick (a) — the lax behavior contradicts CLAUDE.md and the only correct response to a missing Z is "the planner produced a bad waypoint".
- **HW verify**: N/A — static check. Add a unit test that asserts `point_lonlatalt("POINT (10 20)")` raises.

### [P1-2] `ellipsoidHeight` and `takeOffRefPoint.z` use a coarse closed-form EGM96 fit that is wildly wrong outside Europe

- **Severity**: high (low for LZIB-only thesis runs; high if the bundle ships to any non-European user)
- **Location**: `backend/app/utils/geo.py:46-97` (`_EGM96_BUMPS`, `egm96_undulation`, `msl_to_hae`); consumed by `placemark.py:201`, `mission_config.py:95, 101, 105`.
- **Spec**: WPML `ellipsoidHeight` — "Used in conjunction with `wpml:height`, which is an expression of different elevation reference planes at the same location" (`template-kml.md`). The datum is WGS84 ellipsoid height (HAE). `takeOffRefPoint.z` — "the height of the ellipsoid shall be used" (HAE).
- **Current behavior**: `egm96_undulation` is a gaussian-bump fit over a J2-like zonal baseline, calibrated only against LZIB / Jaro Luka. Computed values (verified by running the code today):
  - LZIB (48.17 N, 17.21 E): `+45.4 m` (real EGM96: ~+44.5 m → ~1 m off) ✓
  - Jaro Luka (49.69 N, 18.11 E): `+46.1 m` (real EGM96: ~+43.7 m → ~2.4 m off) ✓ (within audit-claimed ±2 m)
  - NYC (40.7 N, -74 W): `-23.3 m` (real: ~-32.5 m → ~9 m off)
  - Tokyo (35.7 N, 139.7 E): `-32.3 m` (real: ~+36.7 m → **~69 m off, wrong sign**)
  - Sydney (-33.9 S, 151.2 E): `+30.3 m` (real: ~+21.5 m → ~9 m off)
  - Mumbai (19 N, 73 E): `-93.5 m` (real: ~-65 m → **~28 m off**)
  - Sao Paulo (-23.5 S, -46.6 W): `+18.5 m` (real: ~-6 m → **~24 m off, wrong sign**)
- **Why it's wrong**: The relative-to-start scheme (P0-1 aside) is geoid-free, so `executeHeight` is not affected. But:
  1. `ellipsoidHeight` is the *spec-documented absolute datum*. A strict consumer reading it (UgCS, FH2 import-export round-trip, third-party validators, DJI MSDK `IWPMZManager.checkValidation`) would see waypoints up to ~70 m off ground.
  2. `takeOffRefPoint.z` is HAE per spec; consumers that draw the takeoff icon from this value will place it ~70 m underground (or in mid-air) on non-European airports.
  3. The audit `2026-05-15-dji-wpml-spec-audit.md` §1.4 explicitly tracks "Global accuracy is ~10 m" — the Tokyo / Mumbai / Sao Paulo numbers above (~28-69 m) show this claim is too generous; the model is *unusable* outside the LZIB ±~1000 km band.
- **Evidence**: Run `python -c "from app.utils.geo import egm96_undulation; print(egm96_undulation(35.7, 139.7))"` — gives `-32.3` vs published EGM96 `+36.7`. Sign is wrong because the bump table omits any positive bump near Japan.
- **Proposed fix**: Two-stage:
  1. **Short term** — add more bumps to `_EGM96_BUMPS` calibrated against published EGM96 at: Tokyo, Sydney, NYC/Boston, San Francisco, Mumbai, Sao Paulo, Cape Town, Cairo. Each bump fitted independently. Target ±5 m globally.
  2. **Long term** (the P3 upgrade) — swap the body of `egm96_undulation` for `geographiclib.geoid.GeoidPGM('egm96-15')`. Already tracked in audit §1.4 — gated on `backend/requirements.txt` (protected file). Single line of replacement code inside the existing function; the 16 MB pgm grid is shipped with the geographiclib pypi wheel.
- **HW verify**: Confirm any non-LZIB airport ships a KMZ whose `ellipsoidHeight` matches an independent EGM96 source within ±5 m. If the operator is LZIB-only, no HW test needed.

### [P1-3] `_takeoff_ref_msl` swallows every non-`ValueError` exception via `_global_rth_height`'s bare `except`

- **Severity**: high
- **Location**: `backend/app/services/export/dji/mission_config.py:146-161` (`_global_rth_height`)
- **Spec**: `globalRTHHeight` is the RTH ceiling. Wrong value → wrong ceiling on a real RTH event.
- **Current behavior**: `_global_rth_height` wraps the body in `try / except Exception` and returns `_MIN_RTH_HEIGHT_M = 100` on any failure (line 158-161). The catch is documented as "last-resort floor". Reading the body, the only *expected* failures are `ValueError` from `point_lonlatalt`. Any other exception (e.g. `AttributeError` from a malformed mission object, a typo, a circular import side-effect) is also swallowed.
- **Why it's wrong**: The "fall through to a safe floor" reasoning is sound, but the bare `except Exception` masks programmer errors. A new field added to `mission` that throws on lazy-load would silently degrade every export's RTH ceiling to 100 m. If the actual route's highest waypoint is at 150 m relative to takeoff, the drone on RTH would fly *below* the route — collision risk.
- **Evidence**: `mission_config.py:158-161` — `except Exception: return _MIN_RTH_HEIGHT_M`. No logging.
- **Proposed fix**: Narrow the catch to `(ValueError, AttributeError, TypeError)` and `logger.warning(...)` the fallback so it surfaces in the export logs. Genuine programmer errors propagate; data-shape failures still fall through safely.
- **HW verify**: N/A — defensive coding. Static fix.

### [P1-4] `_max_relative_height` fallback of `100.0` is silently wrong on data-empty plans, and `globalHeight = max(50, ...)` floors below the real envelope

- **Severity**: high (informational only when `useGlobalHeight=0`, but pollutes preview)
- **Location**: `backend/app/services/export/dji/mission_config.py:233-248` (`_max_relative_height`); `backend/app/services/export/dji/builders.py:65` (`global_height = str(max(50, int(_max_relative_height(...) + 5)))`)
- **Spec**: `globalHeight` is the folder-level default that per-WP `height` overrides when `useGlobalHeight=0`. Per template-kml.md it is required on every Folder.
- **Current behavior**: When the waypoint loop produces no parseable heights (e.g. every waypoint had unparseable position), `_max_relative_height` returns `100.0`. The caller then computes `int(100.0 + 5) = 105`, floored at `max(50, 105) = 105`. The "100.0" fallback is unrelated to anything real about the mission.
- **Why it's wrong**: The 100.0 fallback is a magic number that mixes two semantic ideas: "no waypoints have heights, give a value that won't break the export" and "default route altitude". The correct fail-safe is to raise — a flight plan with zero parseable heights is not exportable. Also, `max(50, ...)` floors `globalHeight` at 50 m even when the actual envelope is, say, 25 m AGL for a low-altitude PAPI inspection — the preview ceiling rendered in FH2 will look wrong (drone appears too high). With `useGlobalHeight=0` this is cosmetic, but if a strict consumer flips that interpretation, it becomes a real altitude error.
- **Evidence**: `mission_config.py:248` returns 100.0; `builders.py:65` clamps at 50. Neither is named with a constant.
- **Proposed fix**: Replace the 100.0 fallback with a `TrajectoryGenerationError` ("flight plan has no parseable waypoint altitudes") *or* re-anchor to a named `_FALLBACK_GLOBAL_HEIGHT_M` constant and log a warning. Remove the `max(50, ...)` floor — let `globalHeight` ride at the actual envelope plus a small margin (5 m is fine).
- **HW verify**: N/A — preview/cosmetic.

### [P2-1] Waylines folder emits `waylineCoordinateSysParam` which is not in the documented spec order

- **Severity**: medium
- **Location**: `backend/app/services/export/dji/builders.py:221-223`
- **Spec**: `waylines-wpml.md` (fetched 2026-05-26) — the documented waylines Folder children are `templateId`, `executeHeightMode`, `waylineId`, `autoFlightSpeed`, `Placemark`. `waylineCoordinateSysParam` is documented for `template.kml` only.
- **Current behavior**: The waylines folder emits `<wpml:waylineCoordinateSysParam><coordinateMode>WGS84</coordinateMode><heightMode>relativeToStartPoint</heightMode></wpml:waylineCoordinateSysParam>` (line 221-223) before `executeHeightMode`. Inline comment: "mirror the template.kml block — pilot rc rejects waylines whose folder does not declare how per-placemark coordinates and heights should be interpreted."
- **Why it's wrong**: The empirical "Pilot RC rejects" claim is undocumented in spec; it's a hardware-observed fix. The reasoning is plausible (Pilot 2 may want both fields to draw the polyline), but a strict spec-validator could fail the file on the extra element. The exporter is taking on schema-compliance risk to dodge an undocumented Pilot RC behavior.
- **Evidence**: Spec lists no `waylineCoordinateSysParam` in waylines; current emit is at `builders.py:221-223`; comment acknowledges it's reasoned, not spec-derived.
- **Proposed fix**: Confirm via the M4T golden-fixture project (audit §6) whether DJI's own Pilot 2 export includes this element in waylines.wpml. If yes — pin a regression test citing the fixture. If no — remove it and re-run the original Pilot RC test that motivated the addition.
- **HW verify**: Need a Pilot 2 M4T golden export to settle. Diff the golden file's waylines.wpml against the current exporter's output; if Pilot 2 omits this block in waylines, drop it from the writer.

### [P2-2] Waylines folder emits `distance`, `duration`, `realTimeFollowSurfaceByFov` which are not in the documented spec order

- **Severity**: medium
- **Location**: `backend/app/services/export/dji/builders.py:240-244`
- **Spec**: `waylines-wpml.md` — documented Folder children are limited to `templateId`, `executeHeightMode`, `waylineId`, `autoFlightSpeed`, `Placemark`. No `distance`, `duration`, `realTimeFollowSurfaceByFov`.
- **Current behavior**: Emits `wpml:distance`, `wpml:duration` (computed from `_emitted_distance_duration`) and `wpml:realTimeFollowSurfaceByFov` (hardcoded "0"). Inline comments justify distance/duration as "pilot rc populates the mission summary panel from these wayline-level fields".
- **Why it's wrong**: Same as P2-1 — undocumented elements emitted on empirical grounds. `realTimeFollowSurfaceByFov` is not in any of the three spec markdown files fetched. Strict validators may reject.
- **Evidence**: `builders.py:240-244`. Spec child-order list from `waylines-wpml.md`.
- **Proposed fix**: Confirm against golden fixture. If golden Pilot 2 export carries them, pin; if not, drop.
- **HW verify**: Same fixture as P2-1.

### [P2-3] `takeOffSecurityHeight=20` on FULL is an opinionated choice with no spec citation

- **Severity**: medium
- **Location**: `backend/app/services/export/dji/mission_config.py:202`
- **Spec**: `takeOffSecurityHeight` valid range is `[1.2, 1500]` m on a remote-controlled aircraft (`template-kml.md`). No default documented.
- **Current behavior**: FULL scope hardcodes `20` (a string literal); airborne scopes use `_AIRBORNE_TAKEOFF_SECURITY_HEIGHT = "1.5"`. Both are valid; neither is configurable.
- **Why it's wrong**: A 20 m climb-to-safety is conservative but not always appropriate — operators near low ceilings (controlled airspace, restricted hover) might want lower; operators near tall obstacles might want higher. It's also the value that drives the P0-2 collision with `executeHeight=0`. The constant has no name and no source citation. Operators have no way to override.
- **Evidence**: `mission_config.py:202` — `security_height = _AIRBORNE_TAKEOFF_SECURITY_HEIGHT if is_airborne_start else "20"`.
- **Proposed fix**: Extract `_FULL_TAKEOFF_SECURITY_HEIGHT = "20"` to a module-level constant. Consider making it operator-configurable per mission (a `mission.takeoff_security_height` column with a sane default). Even just naming the constant makes the value reviewable.
- **HW verify**: N/A — naming.

## Upgrades (P3)

- **P3-1: Swap closed-form EGM96 for `geographiclib.geoid.GeoidPGM('egm96-15')`.** Already tracked in audit `2026-05-15` §1.4. Single-line body replacement in `egm96_undulation`. Gated on `backend/requirements.txt` (protected). Once landed, the bump table can be deleted and global HAE accuracy improves to ~0.1 m. This is the *correct* fix for P1-2; the bump-table tuning is a stopgap.
- **P3-2: Move from `executeHeightMode=relativeToStartPoint` to `executeHeightMode=WGS84` once the real EGM96 grid lands.** With accurate HAE everywhere, the absolute-HAE encoding (which `template.kml` and `waylines.wpml` would both agree on byte-for-byte) sidesteps both the P0-1 anchor-mismatch problem (no anchor — every waypoint stands alone in HAE) and the P0-3 clamp problem (no anchor → no "below anchor" condition). The audit explicitly forbids this *today* because the encoding has been hardware-broken (descend-to-ground per §12), but the root cause there was the template/waylines disagreeing on the MSL number, not WGS84 itself. With a real EGM96 grid emitted into both files, the disagreement vanishes. Sequence: land geographiclib → verify by golden-fixture diff that template/waylines agree → flip back to WGS84 → flight-test → keep relativeToStartPoint as the fallback mode behind a mission flag for a few releases.
