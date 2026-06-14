# Agent E1 — WaylineCheckError 25-code coverage

Scope: enumerate every DJI MSDK v5 `WaylineCheckError` code returned by
`IWPMZManager.checkValidation()` and verify that the TarmacView KMZ/WPML
exporter cannot trip it. The enum is the closest thing DJI publishes to an
XSD for `wpmz/1.0.6`; every code is a launch-blocker class.

Source for the enum: GitHub issue `dji-sdk/Mobile-SDK-Android-V5#586`,
agent comment from `YIGUI LIU` (Zendesk ticket 148032), retrieved
2026-05-26 via `gh issue view`. Verbatim Java declaration:

```java
public enum WaylineCheckError implements JNIProguardKeepTag {
    NoError(0), FileNotExist(-1), FileParseError(-2),
    WaylineNumberOutOfRange(-3), WaylinePointNumberOutOfRange(-4),
    InvalidRCLoastBehavior(-5), WaypointSpeedOutOfRange(-6),
    TransitionalSpeedOutOfRange(-7), DampintDistOutOfRange(-8),
    InvalidTurnMode(-9), InvalidHeadingMode(-10),
    WaypointInvalidPos(-11), WaypointHeightOutOfRange(-12),
    InvalidTransitionalSpeed(-14), InvalidSecurityTakeOffHeight(-15),
    InvalidWaypointPointIndex(-16), InvalidActionType(-26),
    SetFocusTypeActionInvalidFocusType(-27),
    InvalidRegionFocusRange(-28), InvalidPointFocusPoint(-29),
    InvalidGimbalRange(-30), InvalidActionTriggerType(-32),
    InvalidMultipleTimingTimeValue(-33),
    InvalidMultipleDistacneDistanceValue(-34),
    InvalidExecuteAltitudeMode(261), InvalidFlyToWaylineMode(262),
    UNKNOWN(-65535);
}
```

That is 25 distinct error codes (excluding `NoError` and `UNKNOWN`),
matching the audit-doc count. Spellings preserved from DJI (note the
`InvalidRCLoastBehavior` / `DampintDist` / `MultipleDistacne` typos).

## Summary

- Codes enumerated: 25
- SAFE (path proven safe, in code, ideally pinned by test): 11
- BOUND (guarded in code but bound not asserted, or test pins literal not
  the bound the code defends): 6
- RISKY (path exists, no static guard, currently safe only because input
  data happens to avoid it): 5
- UNGUARDED (no test, weak or no guard): 3

P0 (a code the exporter CAN trip in plausible production data): **3**
P1 (safeguard is in code but not pinned by a test of the bound): **6**
P2 (safeguard is documented but not visibly present in code): **2**
P3 (upgrade — lint the emitted KMZ against the enum in CI): **1**

## Codes table

Conventions: file paths abbreviated to the `backend/app/services/export/dji/`
basename. Test file is `backend/tests/test_export_service.py` unless noted.

| #  | Code (verbatim from DJI)                  | Element(s) gated                                                | Guard in code (file:line)                                                          | Test pinning                                       | Verdict   |
|----|-------------------------------------------|-----------------------------------------------------------------|------------------------------------------------------------------------------------|----------------------------------------------------|-----------|
| 1  | `FileNotExist (-1)`                       | KMZ file presence                                               | n/a — fires on consumer-side IO                                                    | n/a                                                | SAFE (n/a) |
| 2  | `FileParseError (-2)`                     | XML well-formedness, ZIP archive structure                      | `ET.ElementTree(...).write(..., encoding="UTF-8", xml_declaration=True)` + `zipfile` round-trip | `TestDjiSpecConformance.test_xml_header_uppercase_utf8` (2382)        | SAFE |
| 3  | `WaylineNumberOutOfRange (-3)`            | `waylineId` count (exactly 1 wayline emitted per export)        | `builders.py` always emits a single `<Folder>` with `waylineId=0`                  | `TestGenerateKmz.test_kmz_*_structure` (1641, 1653, 1797) — implicit (one folder) | BOUND |
| 4  | `WaylinePointNumberOutOfRange (-4)`       | per-wayline waypoint count (DJI documents ≤ 65535 / ≥ 2)        | None — bound is enormous; trajectory orchestrator's `len(waypoints) ≥ 2` is implicit | None for the lower bound; D1 notes "≥ 200-WP performance ceiling" pinned by `TestDjiActionGroupIdRange` (2734) | BOUND |
| 5  | `InvalidRCLoastBehavior (-5)`             | `executeRCLostAction` enum value                                | `mission_config.py:201` emits the literal `"goBack"` (a documented enum value)     | None directly — `test_mission_config_has_rc_lost_and_rth` (611) asserts presence only | SAFE (literal locked) |
| 6  | `WaypointSpeedOutOfRange (-6)`            | per-WP `waypointSpeed` strictly in `(0, max_drone_speed]`        | `placemark.py:204` — `f"{wp.speed or 0:g}"` → **emits `0` on `speed=None`**         | None — A4-P1-2 and C1-P1-1 flag this              | **RISKY (P0)** |
| 7  | `TransitionalSpeedOutOfRange (-7)`        | `globalTransitionalSpeed` in `[0, 15]` waylines / `>0` template | `mission_config.py:213` — hardcoded `"15"` (literally at the upper bound)            | None for the bound — value pinned indirectly by every `test_kmz_*_structure` | **RISKY (P0)** |
| 8  | `DampintDistOutOfRange (-8)` (sic)         | `waypointTurnDampingDist` in `(0, segment length]`               | `placemark.py:208-211` — `damping_dist = min(0.2, 0.5 * nearest_leg)` on continuity-curvature placemarks; default-stop keeps literal `0.2` | `TestDjiTurnDampingClamp` (2780, 2815, 2852)        | SAFE (pinned for non-degenerate input) — C2-P1-1 flags collocated-WP corner case as RISKY |
| 9  | `InvalidTurnMode (-9)`                    | `waypointTurnMode` enum                                          | `placemark.py:207` selects from `{toPointAndStopWithDiscontinuityCurvature, toPointAndPassWithContinuityCurvature}`; `builders.py:112` global same | implicit — every placemark test asserts the literal | SAFE (literal locked) |
| 10 | `InvalidHeadingMode (-10)`                | `waypointHeadingMode` enum (and `globalWaypointHeadingMode`)     | `heading.py:69-84` `_dji_heading_mode` returns `{smoothTransition, towardPOI, followWayline}`; `_DJI_HEADING_MODES` literal + migration CHECK | `_DJI_HEADING_MODE_VALUES` model-side + migration constraint mirrors the literal set | SAFE |
| 11 | `WaypointInvalidPos (-11)`                | per-WP `(lon, lat)` validity + ordering                          | `point_lonlatalt` raises `ValueError` on missing / non-Point WKT; lon/lat formatted at 8 dp | None direct                                        | BOUND |
| 12 | `WaypointHeightOutOfRange (-12)`          | per-WP `executeHeight` (relative) ≥ 0 in relativeToStartPoint    | `placemark.py:167-180` — below-takeoff clamp to `0` with `logger.warning`         | `TestDjiBelowTakeoffClamp` (2270, 2296, 2313)      | SAFE |
| 13 | `InvalidTransitionalSpeed (-14)`          | template-side `globalTransitionalSpeed > 0`                      | `mission_config.py:213` — literal `"15"` (strictly positive)                       | implicit — same `"15"` pinned in every `test_kmz_*_structure` | SAFE |
| 14 | `InvalidSecurityTakeOffHeight (-15)`      | `takeOffSecurityHeight ∈ [1.2, 1500]` (RC)                       | `mission_config.py:32` `_AIRBORNE_TAKEOFF_SECURITY_HEIGHT = "1.5"`; FULL hardcodes `"20"` (literal) | `test_kmz_measurements_only_structure` (1653, asserts `1.5`); `test_kmz_full_scope_uses_relative_height_mode` (1641, asserts `20`) | BOUND (D1 invariant #17 — value pinned exactly, but the ≥ 1.2 bound not asserted as a bound) |
| 15 | `InvalidWaypointPointIndex (-16)`         | `wpml:index` is 0-indexed, monotonic, in `[0, 65535]`            | `placemark.py:190` — `str(wp.sequence_order - 1)`; same offset on `actionGroupStartIndex` / `EndIndex` | `TestDjiZeroIndexedReferences` (2020, 2031, 2041, 2080) | SAFE |
| 16 | `InvalidActionType (-26)`                 | `actionActuatorFunc` enum                                        | `actions.py` emits only `{rotateYaw, gimbalRotate, hover, takePhoto, startRecord, stopRecord, gimbalEvenlyRotate, zoom}` (all documented) | A5 inventory confirms the 8 emitted values are all in-spec | SAFE |
| 17 | `SetFocusTypeActionInvalidFocusType (-27)`| `focus` action's `focusType`                                     | Exporter does **not** emit `focus` (M4T-incompatible per audit §7)                 | None direct — A5 inventory + B5 P3 note            | **P2 (documented absence not asserted)** |
| 18 | `InvalidRegionFocusRange (-28)`           | `focus` region rectangle bounds                                  | Exporter does **not** emit `focus`                                                  | None direct                                        | **P2 (documented absence not asserted)** |
| 19 | `InvalidPointFocusPoint (-29)`            | `focus` point coordinates                                        | Exporter does **not** emit `focus`                                                  | None direct                                        | P2 (documented absence) |
| 20 | `InvalidGimbalRange (-30)`                | `gimbalPitchRotateAngle` within drone soft limits (M4T: `[-90, +35]`) | `actions.py:189-211` + `267-272` emit `f"{wp.gimbal_pitch:g}"` directly, **no clamp** | None — B4-P2-1 flags this; trajectory output is currently in-band but not guarded | **UNGUARDED (P1)** |
| 21 | `InvalidActionTriggerType (-32)`          | `actionTriggerType` enum                                         | `actions.py:170` literal `"reachPoint"`; `actions.py:265` literal `"betweenAdjacentPoints"` | A5 confirms both are documented enum values        | SAFE (literal locked) |
| 22 | `InvalidMultipleTimingTimeValue (-33)`    | `actionTriggerParam > 0` (seconds) under `multipleTiming`        | Exporter does **not** emit `multipleTiming`                                         | None direct                                        | SAFE (not emitted) |
| 23 | `InvalidMultipleDistacneDistanceValue (-34)` (sic) | `actionTriggerParam > 0` (meters) under `multipleDistance` | Exporter does **not** emit `multipleDistance`                                       | None direct                                        | SAFE (not emitted) |
| 24 | `InvalidExecuteAltitudeMode (261)`        | `executeHeightMode` enum value                                   | `builders.py` emits literal `relativeToStartPoint`; template `heightMode` same     | `TestDjiRelativeHeightExport.test_execute_height_mode_is_relative_on_every_scope` (2886); `test_waylines_folder_uses_relative_height_mode` (417); `test_kmz_full_scope_uses_relative_height_mode` (1641) | SAFE |
| 25 | `InvalidFlyToWaylineMode (262)`           | `flyToWaylineMode` enum value                                    | `mission_config.py:196` — `"pointToPoint"` (airborne scopes) or `"safely"` (FULL); both documented | `test_kmz_measurements_only_uses_point_to_point_and_goto_first_waypoint` (1764); `test_kmz_no_takeoff_landing_uses_point_to_point_and_goto_first_waypoint` (1809); `test_kmz_full_scope_unchanged_flytowayline_and_finish` (1797) | SAFE |

## Findings — RISKY / UNGUARDED with severity

### [P0-1] `WaypointSpeedOutOfRange (-6)` — `waypointSpeed=0` is emitted on TAKEOFF / LANDING / bookend hovers

**Source path**: `placemark.py:204`

```python
_sub_text(placemark, "waypointSpeed", f"{wp.speed or 0:g}")
```

The MSDK enum's `WaypointSpeedOutOfRange (-6)` fires when a per-waypoint
`waypointSpeed` falls outside the `(0, max_drone_speed]` band documented in
`waylines-wpml.md` (exclusive of `0` on both sides). The current code
falls back to the literal `0` whenever `wp.speed` is falsy — and the
trajectory pipeline plumbs `default_speed` (which can be `None`) into
`_ground_takeoff_waypoint` / `_ground_landing_waypoint`, so every
TAKEOFF / LANDING / HOVER bookend on a mission without a `default_speed`
emits `<wpml:waypointSpeed>0</wpml:waypointSpeed>` in `waylines.wpml`.

Why this trips `-6`, not just lives in spec drift: in `template.kml` the
`useGlobalSpeed=1` flag rescues the placemark because the global picks
up. In `waylines.wpml` the four `useGlobal*` flags are deliberately
omitted (services CLAUDE.md gotcha "Every template Placemark must emit
four `useGlobal*` flags; the waylines folder omits all four"), so the
raw `0` is what `IWPMZManager.checkValidation()` sees.

Cross-ref: A4-P1-2, C1-P1-1. The Litchi exporter already solved this
with `_LITCHI_MIN_SPEED = 0.1` (`export/formats/litchi.py`). Mirror in
DJI: clamp at the emission site to `auto_speed` (already resolved in
`builders.py`) or to a small positive floor. C1-P1-1 has the
implementation sketch.

Pilot 2 has tolerated this in operator testing, but the MSDK
`checkValidation()` enum is stricter than Pilot 2 in practice
(`docs/kmz-wpml-audit.md` §10 "sometimes stricter than Pilot 2"). One
firmware bump from quiet-pass to launch rejection.

### [P0-2] `TransitionalSpeedOutOfRange (-7)` — `globalTransitionalSpeed="15"` sits at the inclusive upper bound

**Source path**: `mission_config.py:213`

```python
_sub_text(config, "globalTransitionalSpeed", "15")
```

The `waylines.wpml` spec bounds `globalTransitionalSpeed` to `[0, 15]`
(inclusive). Hardcoding the literal `"15"` is at the ceiling with zero
margin. Two failure modes:

1. **Floating-point rounding inside `IWPMZManager.checkValidation()`.**
   The validator parses `"15"` as `float`; a strict `> 15.0` test that
   should pass on `15.0` exact can fail on the IEEE-754
   `15.000000000000002` round-up of certain JSON paths inside the MSDK
   pipeline. DJI's own canonical samples in `common-element.md` emit
   `8` (template) and `10` (waylines), suggesting the recommended
   operating range is `8-10 m/s`, not the ceiling.
2. **Future tightening to `[0, 15)` exclusive.** The template-side spec
   already says `> 0` without an upper-bound annotation, so DJI's own
   copy is internally inconsistent — a future Pilot 2 firmware that
   harmonises to `[0, 15)` (matching `waypointSpeed`'s exclusive
   convention) flips this from quiet-pass to rejection.

Cross-ref: C1-P0-1 owns the fix sketch (`min(mission.default_speed or
8, drone.max_speed or 15, 15)` — strict-less-than 15). The bound is
hit specifically by `TransitionalSpeedOutOfRange (-7)`; the related
`InvalidTransitionalSpeed (-14)` covers the strict-positive template
case which is fine today.

### [P0-3] `InvalidGimbalRange (-30)` — no clamp on `gimbalPitchRotateAngle` against M4T `[-90, +35]` soft limits

**Source path**: `actions.py:189-211` (per-WP `gimbalRotate`) +
`actions.py:267-272` (segment `gimbalEvenlyRotate`)

```python
_sub_text(action_param, "gimbalPitchRotateAngle", f"{wp.gimbal_pitch:g}")
```

The MSDK enum's `InvalidGimbalRange (-30)` fires when
`gimbalPitchRotateAngle` is outside the gimbal's documented soft range.
DJI Matrice 4T's public spec lists `-90° to +35°` as the soft tilt range
(mechanical range `-140° to +113°`). The exporter writes
`wp.gimbal_pitch` verbatim with no clamp on either emit site.

Why this is P0 despite trajectory output being currently in-band: the
trajectory layer is drone-agnostic by design (`services/CLAUDE.md`
"M4T-specific limits belong in export, not trajectory"). Any of three
plausible code paths produces an out-of-band value:

1. A future inspection method whose pitch geometry is steeper than
   `-90°` (e.g. a hover-point-lock variant directly above an LHA).
2. An operator-configured `altitude_offset` that drives a near-vertical
   geometry on Fly-Over (currently capped at `-89°` by
   `MIN_TILT_BELOW_HORIZONTAL = -1°` but not against `-90`).
3. A camera_target above the drone (gimbal pitch positive > +35°) on a
   bottom-up VP inspection of an elevated PAPI (allowed by config
   today).

The M4T silently clamps to the soft limit at flight time, so the
commanded geometry and the executed geometry diverge — the planner
thinks the camera is pointed at the LHA but the gimbal is at its limit.
Cross-ref: B4-P2-1 owns the proposed fix (clamp at write site with a
logged warning, constants in `app.core.constants`).

`checkValidation()` keys on the raw number in the WPML file, not the
drone's behaviour, so an out-of-band value rejects the file regardless
of the silent firmware clamp.

### [P1-1] `WaylinePointNumberOutOfRange (-4)` — no explicit guard on the lower bound

**Source path**: implicit across the trajectory orchestrator +
exporter; DJI documents `waylinePointNumber ∈ [2, ?]` for a usable
wayline.

The orchestrator drops empty inspection passes before phase 5
(`_process_inspection` returns `None` on a zero-waypoint pass; see
services CLAUDE.md "Empty inspection passes are dropped before phase
5"), and `_pass_boundary` raises `TrajectoryGenerationError` on a pass
that survives but carries only TRANSIT waypoints. So zero-WP missions
cannot reach the writer.

But the **single-waypoint** case is not guarded: a mission whose
flight plan has exactly one Placemark (e.g. a one-LHA HOVER_POINT_LOCK
with no transit bookends in MEASUREMENTS_ONLY scope) would emit one
`<Placemark>` and trip `-4`. The trajectory pipeline does not enforce
`≥ 2`; the WPML spec does. Pin with a guard in
`_build_dji_waylines_wpml` that raises if `len(waypoints) < 2` (or
that injects a degenerate second WP at the same position — but that's
its own footgun).

Today this is `P1` not `P0` because every shipping inspection method
emits `≥ 2` measurement waypoints by design, but the bound is not
asserted anywhere.

### [P1-2] `InvalidRCLoastBehavior (-5)` — `executeRCLostAction` value is locked but no test asserts membership

**Source path**: `mission_config.py:201`

```python
_sub_text(config, "executeRCLostAction", "goBack")
```

`goBack` is a documented enum value per `common-element.md`. The bound
itself (`executeRCLostAction ∈ {goBack, hover, landing}` per the
spec — confirm against the M4T golden reference) is not asserted by
any test: a typo or refactor to `"go_back"` would silently produce a
file that trips `-5`. Cheap to pin with a parametric test of the
literal.

### [P1-3] `InvalidSecurityTakeOffHeight (-15)` — value pinned exactly but `≥ 1.2` bound not asserted

D1 invariant #17 — already flagged in the test-map audit. Tests pin
the strings `"1.5"` and `"20"`, so a constant change to `"0.5"` in
`mission_config.py:32` would fail those exact-match tests. The
underlying SPEC bound `[1.2, 1500]` is not asserted as a bound: if the
constant ever becomes dynamic (per-mission, operator-configurable, per
B2-P2-3), the lower bound would silently regress. Pin with a
parametric test exercising every produced value against `≥ 1.2 and ≤
1500`.

### [P1-4] `WaylineNumberOutOfRange (-3)` — single-wayline shape is structural but unasserted

The exporter emits exactly one `<Folder>` with `waylineId=0`. No test
asserts that exactly one wayline folder exists in the file (the
`test_kmz_*_structure` tests assert presence of the folder, not
uniqueness). A refactor that emits a per-inspection wayline (e.g. for
multi-pass execution) would trip `-3` against the documented
single-wayline bound for the M4T. Pin with a regression test that
asserts `len(folders) == 1` in both `template.kml` and
`waylines.wpml`.

### [P1-5] `WaypointInvalidPos (-11)` — `point_lonlatalt` raises but tests don't pin the failure shape

`point_lonlatalt` (services CLAUDE.md: "strict — raises `ValueError`
on empty/None/non-Point") is the chokepoint for invalid positions, and
the exporter does not catch the exception (the `_takeoff_ref_msl`
fallback in `mission_config.py:122-131` swallows it for the takeoff
ref calculation only). A `POINT EMPTY` WKT in `wp.position` propagates
up as a 500. That's correct behaviour — the alternative would be
emitting Null Island `(0, 0)`, which IS what `-11` is designed to
catch.

But: B2-P1-1 flagged a separate path where `point_lonlatalt` silently
returns `0.0` on a 2D point (`POINT (lon lat)` without Z). Lon/lat
themselves are still valid, so `-11` does not fire — but the `0.0`
altitude propagates into `executeHeight = -takeoff_ref_msl`, which
then triggers `WaypointHeightOutOfRange (-12)` via the below-takeoff
clamp (handled). The cascade is safe; B2-P1-1's fix
(raise on 2D point) is the right defense in depth.

### [P1-6] `InvalidExecuteAltitudeMode (261)` — locked literal, but enum membership not asserted

D1 invariant #15 covers the value (`relativeToStartPoint` on every
scope). The enum spec (`common-element.md`) lists three valid
values: `EGM96`, `relativeToStartPoint`, `WGS84`. The test asserts the
exact literal; a refactor that switches the literal to
`relativeToTakeoff` (a plausible typo / synonym) would trip `261` and
not be caught by the literal-match test. Cheap parametric pin.

## P2 — Documented absences not asserted in tests

These cover the `focus` action codes (`-27`, `-28`, `-29`). The
exporter does not emit any `focus` action — `isInfiniteFocus`
explicitly forbidden for M4T per audit §7. But no test asserts the
absence: a future refactor that re-introduces a `focus` action to fix
a different issue (e.g. lock focal distance for low-light) would not
fail any existing assertion. D1 invariant #30 already flagged the
parent class (`isInfiniteFocus`, `panoShot`, `recordPointCloud`
non-emission) as P2 unpinned. Extending the same one-liner test to
also assert `"focus"` not in the emitted XML closes the three codes
`-27 / -28 / -29` in one shot.

## P3 — Upgrade: CI linter that runs the exporter output against the enum

Audit §10 already calls out "DJI MSDK v5 `IWPMZManager.checkValidation()`
— authoritative but needs a small Android app." A cheaper intermediate
is a Python linter that walks the emitted XML and asserts each
`WaylineCheckError` code's documented condition. The 22 in-scope codes
(every non-zero, non-UNKNOWN code) reduce to ~15 distinct structural
assertions because several share the same WPML element (e.g. `-6 / -7
/ -14` all key on speed elements). The lint can run in CI on every
exporter test fixture and prevents the entire enum class of
regressions without an Android runtime.

Sequence: implement after the M4T Pilot 2 golden fixture lands (audit
Phase 0). The golden fixture gives a reference KMZ to cross-check the
linter against — every assertion the linter makes should hold on
DJI's own output.

## Cross-references

- A4-P1-2, C1-P1-1 — `waypointSpeed=0` (code #6).
- C1-P0-1 — `globalTransitionalSpeed=15` (code #7).
- C2-P1-1 — degenerate-leg damping (code #8 corner case).
- B4-P2-1 — gimbal pitch clamp (code #20).
- B2-P0-3 — below-takeoff clamp surface (code #12 already SAFE; surface
  the warning to the operator).
- D1 invariants #15 (`executeHeightMode`), #17 (`takeOffSecurityHeight`),
  #30 (`isInfiniteFocus`/`panoShot`/`recordPointCloud`) — feeding into
  E1's BOUND verdicts and P2 absences.

## Verdict

The TarmacView exporter is **structurally compliant** with the
`WaylineCheckError` enum for the M4T-shaped data the operator
currently produces. 11 of 25 codes are SAFE with strong tests; 6 are
BOUND (value emitted, bound not asserted as a bound — defensible for
operationally-stable literals but susceptible to future tightening or
constant changes); 3 are UNGUARDED (the three P0s above), and 5
others are P1 hardening work.

The two highest-value pre-flight actions are (1) clamp `waypointSpeed`
above zero at the emission site (code #6 fix; uses already-resolved
`auto_speed`), and (2) replace the `globalTransitionalSpeed="15"`
literal with a drone-aware derivation strictly less than 15 (code #7
fix). Both close P0 launch-rejection windows on a single firmware
bump. The gimbal clamp (code #20) is defense-in-depth against future
trajectory changes; today the trajectory output is in-band.
