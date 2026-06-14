# KMZ / WPML Export Audit & Remediation Plan

Audit of the DJI KMZ/WPML exporter for the **DJI Matrice 4T**. Captures why the
export has been unreliable, what the authoritative sources actually are, how to
obtain a ground-truth reference file, and the plan to fix it.

---

## 1. Problem statement

The exporter (`backend/app/services/export/`) produces KMZ flight plans that
import into DJI Pilot 2 unreliably. Three reported symptoms:

1. **Lands at start** — the drone descends/lands right at mission start.
2. **Jerky movement** — non-smooth, stop-start motion between waypoints.
3. **Erratic camera** — gimbal/focus behaves unpredictably.

A large amount of effort has gone into fixing this without convergence.

## 2. Why the fixes have not converged — debugging blind

Three structural facts make trial-and-error fixing nearly impossible:

1. **DJI publishes no XSD / XML Schema for WPML.** There is no machine-readable
   schema to validate a file against. "Diff each line against the docs" has no
   authoritative target — the spec is prose across four markdown files.
2. **The Matrice 4T's required enum values are undocumented.** DJI's public docs
   stop at the M3 generation. `droneEnumValue`, `droneSubEnumValue`,
   `payloadEnumValue`, `payloadSubEnumValue` for the M4 series appear in **no**
   public source. A wrong `droneEnumValue` alone can make Pilot 2 reject or
   mishandle the import.
3. **The doc examples use a stale namespace.** They show `wpmz/1.0.2`; current
   Pilot 2 for the M4 series writes `wpmz/1.0.6`. Pilot 2 **silently drops**
   elements it does not recognize for the declared version — so a wrong
   namespace can make whole config blocks (turn mode, height mode, focus)
   vanish, producing all three symptoms at once.

**Conclusion:** the missing piece was never better documentation. It is a
ground-truth reference file emitted by DJI's own software, plus a structural
diff tool. Without those, every fix is a guess.

## 3. Symptom → likely WPML root cause

| Symptom | Most likely cause | Correct setting |
|---|---|---|
| **Lands at start** | `executeHeightMode` mismatched with the altitude numbers — writing `relativeToStartPoint`-style heights but tagging the file `WGS84`/`EGM96`, so the first waypoint resolves below ground. Also `height` vs `ellipsoidHeight` swap; first-waypoint height 0/negative; first height below `takeOffSecurityHeight`. | `executeHeightMode = relativeToStartPoint` with positive AGL-from-takeoff heights; `flyToWaylineMode = safely`; first waypoint height > `takeOffSecurityHeight`. |
| **Jerky movement** | `waypointTurnMode = toPointAndStopWithDiscontinuityCurvature` on every waypoint → full stop + re-accelerate at each point. | `toPointAndPassWithContinuityCurvature` uniformly; `useStraightLine` consistent; adequate waypoint density. |
| **Erratic camera** | Per-waypoint `focus` actions with varying/invalid `focusX/focusY` → continuous AF hunting. Gimbal moved via `gimbalRotate` + `reachPoint` (snaps) instead of `gimbalEvenlyRotate` + `betweenAdjacentPoints` (smooth sweep). `isInfiniteFocus` is **not valid for the M4T**. | Set focus once, keep `focalLength` constant; use `gimbalEvenlyRotate`; `payloadPositionIndex = 0`; `takePhoto` last in the action group. |

Cross-cutting: a stale `xmlns:wpml` version can cause all three at once.

## 4. Format decision — KMZ/WPML is the only viable target

Research verdicts (do not re-litigate these):

- **No better export format exists for the M4T.** Plain KML, GPX, and MAVLink
  `.plan` are unsupported. KMZ/WPML is the native format and the de-facto
  industry standard — UgCS, DroneDeploy, Pix4D, Litchi all convert to it.
- **A transfer bridge does not fix the symptoms.** Every delivery path (Pilot 2
  import, USB/SD, DJI Cloud API, a custom MSDK app) consumes the *same* WPML. A
  bridge ships the same broken bytes. The DJI Cloud API "Pilot Wayline
  Management" flow is a genuine delivery improvement but is a follow-up, not a
  fix.
- **A custom app does not bypass the format.** MSDK v5's waypoint API
  (`pushKMZFileToAircraft`) also takes a KMZ file — there is no programmatic
  mission object. A custom app replaces Pilot 2's UI, not the file format.
- **Firmware bypass is infeasible** — the O4 radio is encrypted, firmware is
  signed, and it would be a ToS/DMCA violation and unsafe near airport
  infrastructure.
- **Do not delete and rewrite blind.** A rewrite re-derives the format from the
  same docs that failed. Fix against a reference instead. If a rewrite is ever
  warranted, base it on the `fcsonline/droneroute` implementation (see §7).

## 5. Authoritative WPML reference

Spec lives in the GitHub mirror `dji-sdk/Cloud-API-Doc` (plain markdown, best
for diffing):

| Page | Path in `dji-sdk/Cloud-API-Doc` |
|---|---|
| Overview / KMZ structure | `docs/en/60.api-reference/00.dji-wpml/10.overview.md` |
| `template.kml` | `docs/en/60.api-reference/00.dji-wpml/20.template-kml.md` |
| `waylines.wpml` | `docs/en/60.api-reference/00.dji-wpml/30.waylines-wpml.md` |
| Common elements / actions / enums | `docs/en/60.api-reference/00.dji-wpml/40.common-element.md` |

`40.common-element.md` is the element/enum bible — per element it gives type,
required/optional, range, and enum domain.

KMZ structure (a plain ZIP; folder/file names are mandatory and case-sensitive):

```
<route>.kmz
└── wpmz/
    ├── template.kml      planning view (Pilot 2 displays/edits this)
    ├── waylines.wpml     the executable flight path (the drone flies THIS)
    └── res/              optional auxiliary resources
```

Documented `droneEnumValue` (public docs — **M4 series is NOT here**):
`60` M300 RTK · `89` M350 RTK · `67` M30/M30T · `77` M3E/M3T/M3M · `91` M3D/M3TD.

## 6. Reference-file acquisition — the unlock

> **Status (2026-05-26).** Item 1 is no longer aspirational - a real M4T export
> from DJI Pilot 2 now lives at `docs/specs/PAPI 22.kmz` and was used as the
> ground truth for the 20-agent audit at
> `docs/audits/2026-05-26-kmz-export-review.md`. When the doc-derived rules in
> this file disagree with the Pilot 2 1.0.6 export, the export wins. In
> particular, `globalHeight`, `caliFlightEnable`, `globalUseStraightLine`,
> `payloadSubEnumValue`, and a `payloadParam` block placed AFTER Placemarks
> are NOT in the public 1.0.2 element tables but ARE emitted by Pilot 2 1.0.6
> on the M4T - do not "fix" the exporter to remove them. The public WPML docs
> enumerate the 1.0.2 element set and the M4T enum table stops at the M3
> generation; treat the docs as a lower bound on what is valid, not the full
> set.

Ranked by authority:

1. **DJI Pilot 2 export from the real M4T — GOLD.** Author a small mission in
   Pilot 2 on the actual aircraft, export to microSD, unzip. Gives the real M4T
   enum values, the real namespace version, and the exact element ordering
   Pilot 2 treats as canonical. **Check this into `backend/tests/data/` as a
   fixture.** This is the single highest-value artifact. Done - the reference
   file is `docs/specs/PAPI 22.kmz`.
2. **`com.dji:wpmz` library output** — DJI's official KMZ generator (Maven
   Central, MIT). Current-version, authoritative; requires a small Android/JVM
   harness.
3. **DJI MSDK sample `waypointsample.kmz`** — a real DJI-emitted file in
   `dji-sdk/Mobile-SDK-Android-V5` at
   `SampleCode-V5/android-sdk-v5-sample/src/main/assets/waypointsample.kmz`.
   Namespace `1.0.0` (older than M4T), so good for building the diff harness but
   not M4T-exact.

Do **not** use third-party converter output (Litchi, format-wpmz,
dji-waylines-sdk) as ground truth — diffing against another guesser is circular.

### Reference mission recipe (build this in Pilot 2 on the M4T)

A simple mission that exercises every construct, so the exported file is a
structurally authoritative golden fixture:

- 4–5 waypoints
- per-waypoint gimbal pitch
- a Take Photo action + a Start Record / Stop Record pair
- one Hover action
- one waypoint with a non-default turn mode and a non-default heading mode
- thermal capture enabled (to see how the `ir` lens is encoded)
- an explicit finish action

## 7. M4T-specific checklist

- **`droneEnumValue` / `droneSubEnumValue` / `payloadEnumValue` /
  `payloadSubEnumValue`** — undocumented; copy verbatim from a real Pilot 2 M4T
  export. Do not guess.
- **`payloadPositionIndex` = `0`** — the M4T is a single integrated main-gimbal
  payload.
- **Namespace** `xmlns:wpml="http://www.dji.com/wpmz/1.0.6"` — confirm against
  the reference export.
- **Captures** — use `orientedShoot` (DJI deprecates `accurateShoot`).
- **Do not emit** `panoShot` (M30/M3D-only) or `recordPointCloud` (LiDAR-only).
- **Thermal** — add `ir` to `<wpml:imageFormat>` and per-action
  `<wpml:payloadLensIndex>` (comma-separated, e.g. `wide,ir`). Match the exact
  token spelling from the reference export; verify the M4T honours the lens
  list.
- **Do not emit `isInfiniteFocus`** for the M4T.

Reference implementation worth studying (not adopting): `fcsonline/droneroute`
(TypeScript, MIT, actively maintained) — the only open-source project that gets
the full `wpmz/` structure right (`template.kml` + `waylines.wpml` + `res/`,
action groups, turn modes, gimbal/focus, height modes).

## 8. Smooth camera motion for the two inspection methods

Both methods need smooth motion; the smoothness mechanism differs.

### Horizontal Range (HR)

Drone translates sideways along a path; gimbal pitch fixed; the camera stays
centred on the PAPI; the **aircraft heading rotates continuously** to keep
facing the PAPI — and must do so smoothly, not in abrupt per-waypoint
corrections.

WPML encoding:

- `wpml:waypointHeadingMode` = **`towardPOI`** — the aircraft continuously yaws
  to face the POI; DJI interpolates yaw smoothly along each segment. This is the
  built-in smooth-heading mechanism.
- `wpml:waypointPoiPoint` = `<lon>,<lat>,<alt>` of the PAPI centre — the POI the
  heading tracks.
- `wpml:waypointTurnMode` = **`toPointAndPassWithContinuityCurvature`** — never
  stop at a waypoint (stopping while yawing causes the abrupt feel).
- Gimbal pitch — one `gimbalRotate` action at the start/hover waypoint, then
  leave it. Do not re-issue gimbal pitch per waypoint.
- Adequate waypoint density along the lateral path.

Abrupt heading is caused by `fixed`/`followWayline` heading with discrete
per-waypoint angles (heading only changes *at* waypoints) and/or stop-type turn
modes. The fix is `towardPOI`.

### Vertical Profile (VP)

Heading static (drone faces the PAPI); the **gimbal pitch sweeps** as the drone
moves — and must sweep smoothly.

WPML encoding:

- `wpml:waypointHeadingMode` = **`fixed`**, `wpml:waypointHeadingAngle` =
  constant bearing to the PAPI on every waypoint.
- Gimbal pitch — per segment, a `gimbalEvenlyRotate` action inside an
  `actionGroup` whose `actionTrigger`/`actionTriggerType` =
  **`betweenAdjacentPoints`**. `gimbalEvenlyRotate` ramps pitch evenly across
  the whole segment → smooth sweep.
- `wpml:waypointTurnMode` = **`toPointAndPassWithContinuityCurvature`**.

Jerky pitch is caused by discrete `gimbalRotate` actions on the `reachPoint`
trigger (gimbal snaps at each waypoint). The fix is `gimbalEvenlyRotate` +
`betweenAdjacentPoints`.

### Authoring these in DJI Pilot 2

**The mission is generated by this module, not authored in Pilot 2.** Pilot 2's
role is (1) to *fly* the generated KMZ and (2) to provide a structural reference
for simple encodings. Pilot 2's UI exposes POI heading and per-waypoint gimbal
pitch only partially and inconsistently across drone models, and does not
cleanly expose `gimbalEvenlyRotate` between points — so the complex HR/VP
missions cannot be fully authored in the app, and that is expected. The
`towardPOI` / `waypointPoiPoint` / `gimbalEvenlyRotate` encodings come from
`40.common-element.md` and the `droneroute` reference implementation. Final
verification is importing the module-generated KMZ into Pilot 2 on the real M4T
and flying it.

## 9. Remediation plan

- **Phase 0 — Golden reference.** Author the §6 reference mission in Pilot 2 on
  the M4T, export, check the `.kmz` into `backend/tests/data/`. *(Requires the
  physical drone.)*
- **Phase 1 — Diff harness.** A tool that parses the exporter's output and the
  reference, walks both element trees, and reports every wrong / missing / extra
  element and value.
- **Phase 2 — Fix the exporter** against the diff (not against the docs blind).
- **Phase 3 — Validation linter in CI.** No XSD exists, so encode DJI's rules as
  a linter: structural checks plus the 25-code `WaylineCheckError` enum (see
  §10).
- **Phase 4 — Round-trip confirmation.** Import the fixed KMZ into Pilot 2,
  re-save, re-export, diff again; then a real flight.

## 10. Validation

No official WPML XSD exists. Layered strategy, increasing authority and cost:

1. Custom Python structural + enum linter in CI (fast, no hardware).
2. Structural diff against the Pilot 2 M4T golden reference.
3. DJI MSDK v5 `IWPMZManager.checkValidation()` — authoritative but needs a
   small Android app, and is sometimes stricter than Pilot 2.
4. Pilot 2 import round-trip on the real M4T.

`WaylineCheckError` codes (from DJI SDK support) cover wayline/waypoint counts,
speed ranges, damping distance, turn/heading modes, positions, heights, action
types, gimbal ranges, action triggers, and altitude modes — encode these as the
linter's rule set.

## 11. Current exporter state (code audit)

The exporter is `backend/app/services/export/dji/` (`builders.py`,
`mission_config.py`, `placemark.py`, `heading.py`, `actions.py`, `video.py`). It
is **not a naive mess** — it is a well-factored exporter that already implements
three heading modes and segment-wise gimbal interpolation.

**Central finding: the long fix history produced reasoned but
hardware-unverified decisions.** The code is full of comments like "not yet
hardware-confirmed against Pilot RC2 + Matrice 4T" and "Hardware-unverified
until the M4T's RTK + firmware geoid model are confirmed". The blocker is
**verification, not implementation** — the exporter needs a ground-truth
reference and a real flight to confirm which guesses are correct, not more code.

Specific items:

- **Drone/payload enums are an unverified assumption.** `mission_config.py`
  hardcodes `droneEnumValue/SubEnumValue = 99/1`, `payloadEnumValue/SubEnumValue
  = 89/0`, labelled "m30t". Documented M30T is `67` / payload `53` — so the
  label is wrong. The `99/1/89/0` values were observed in the operator's own
  FH2 round-trip exports, so they are probably closer to right than wrong, but
  the theory "FH2 normalizes every export to m30t" is an inference, not a fact.
  A Pilot 2 export from the M4T settles it definitively.
- **`towardPOI` and `gimbalEvenlyRotate` are already implemented** — see §8 for
  how they map to HR/VP. The default heading mode is `smoothTransition`;
  `towardPOI` is selectable per-export (ExportPanel picker, or the
  `mission.dji_heading_mode` column).
- **Altitude is takeoff-relative** (`executeHeightMode=relativeToStartPoint`,
  `executeHeight = wp_MSL − takeoff_ground_MSL`). PR #726 reverted the
  intermediate WGS84/HAE shape after hardware testing reproduced the
  descend-to-ground symptom (see §12 for the root cause): the absolute encoding
  had `template.kml` and `waylines.wpml` disagree on the same MSL number, and
  Pilot 2 regenerates the executable wayline from `template.kml` so the
  inconsistent template heights drove the executed altitude ~45 m below ground.
  Relative-to-takeoff is geoid-free and cancels any datum error. A waypoint
  below the takeoff reference is clamped to `0` with a logged warning rather
  than reverted to absolute mode. Template `ellipsoidHeight` still carries the
  true WGS84 HAE (`msl_to_hae(lat, lon, wp.alt)`) per the WPML spec definition
  of `ellipsoidHeight`; only `executeHeight` / `height` / `globalHeight` /
  `heightMode` ride on the relative scale. Hardware-unverified for the relative
  fix until a Matrice 4T re-flight confirms the drone holds the intended AGL on
  a mid-air wayline start.
- **`payloadParam/imageFormat` is emitted as `visable`** (the misspelling DJI's
  own materials are inconsistent about). Confirm against the reference export
  which spelling the M4T expects.

### HR / VP — current behaviour vs. the goal

- **Horizontal Range.** Default `smoothTransition` emits a per-waypoint
  `waypointHeadingAngle` and lets firmware interpolate *linearly between those
  angles*. The true bearing to the PAPI along a straight lateral path is
  non-linear, so linear angle interpolation drifts off-centre between waypoints
  and changes yaw rate at each waypoint — this is the "abrupt correction" the
  operator sees. `towardPOI` (already implemented, selectable) makes firmware
  track the POI continuously — exact centring, no per-waypoint angle steps. For
  HR, `towardPOI` is the correct mode. Turn mode is already pass-through for HR
  video.
- **Vertical Profile.** For a VIDEO_CAPTURE inspection the exporter already
  emits the correct smooth-pitch mechanism: a `gimbalEvenlyRotate` action on a
  `betweenAdjacentPoints` trigger per segment, with pass-through turn mode and
  the per-waypoint gimbal snap suppressed after the first (anchor) measurement.
  If VP pitch is still jerky the suspects are: the inspection is PHOTO_CAPTURE
  (then it stops and snaps at every waypoint by design), too few waypoints (each
  `gimbalEvenlyRotate` segment spans waypoint-to-waypoint, so sparse waypoints =
  coarse sweep), or the first-measurement anchor snap.

**Whole-route smoothness is gated on `capture_mode == "VIDEO_CAPTURE"`** (a null
capture mode is treated as video). A PHOTO_CAPTURE inspection deliberately stops
and snaps at every waypoint — none of the smooth-motion path applies.

## 12. Root cause — descend-to-ground (CONFIRMED)

Five parallel bug-hunt agents regenerated the real KMZ from the failing missions
("Test OM" = MEASUREMENTS_ONLY, "Test NTL" = NO_TAKEOFF_LANDING, airport JARO)
and converged on the cause.

Symptom (pilot report): on all 4 test missions the M4T descends straight to the
ground at the start until obstacle sensors stop it; manual resume repeats it;
the mission never executes. Identical across both scopes and all 3 heading
modes — so a single shared altitude-encoding bug.

**Ruled out:** the trajectory data (airport elevation 134 m, waypoint MSL ~140-156
/ AGL ~8-24 consistent — clean) and the geoid model (`egm96_undulation` at JARO
computes +45.4 m vs the true +43.7 m — only 1.7 m off, and in the wrong
direction to cause a descent).

**Root cause — the absolute-altitude encoding is internally inconsistent and the
executed altitude resolves ~45 m below ground:**

- `template.kml` declares `heightMode=EGM96` and emits per-waypoint
  `ellipsoidHeight` AND `height` as the *same* raw MSL number (~146 m). Per the
  WPML spec `ellipsoidHeight` must be WGS84 ellipsoid height (HAE) — it should
  be ~191 m, ~45 m above `height`. As written it is ~45 m too low.
- `waylines.wpml` declares `executeHeightMode=WGS84` with `executeHeight` as HAE
  (~191 m — internally correct in the bundled file).
- DJI's own docs state Pilot 2 **regenerates the executable wayline from
  `template.kml`** on import. The regeneration consumes the template's
  inconsistent/too-low height fields; the executed altitude resolves ~45 m below
  true ground, so every waypoint is underground and the drone descends into it.
- `globalHeight` is computed on an AGL scale (~50) while per-waypoint `height`
  is MSL (~146) — a latent unit mismatch in the same file.

**Second, independent bug:** `mission_config.py` emits `takeOffSecurityHeight=0`
for MEASUREMENTS_ONLY. The WPML spec minimum is 1.2 m (RC). With
`flyToWaylineMode=pointToPoint` this compounds the descent on the two
measurements-only missions.

**Fix direction (agent consensus):** abandon absolute WGS84/HAE altitude; switch
the whole export to `executeHeightMode=relativeToStartPoint` with
`executeHeight = wp_MSL − takeoff_MSL`. Relative-to-takeoff is geoid-free,
removes the `ellipsoidHeight`/`height`/`heightMode` ambiguity, and is the height
mode DJI Pilot 2 reliably supports. The "every waypoint ≥ takeoff" constraint
that originally motivated the WGS84 switch holds for these missions (waypoints
8-24 m AGL, above takeoff ground); a rare below-takeoff waypoint should be
clamped, not handled by reverting to absolute mode. Also raise
`takeOffSecurityHeight` to ≥1.2 m and make the template's `heightMode`,
per-waypoint heights, and `globalHeight` mutually consistent.

## 13. Sources

- WPML reference: <https://github.com/dji-sdk/Cloud-API-Doc/tree/master/docs/en/60.api-reference/00.dji-wpml>
- Rendered docs: <https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/overview.html>
- DJI MSDK sample KMZ: <https://github.com/dji-sdk/Mobile-SDK-Android-V5> (`SampleCode-V5/android-sdk-v5-sample/src/main/assets/waypointsample.kmz`)
- `com.dji:wpmz` library: <https://central.sonatype.com/artifact/com.dji/wpmz>
- `IWPMZManager` / `checkValidation`: <https://developer.dji.com/api-reference-v5/android-api/Components/IWaypointMissionManager/IWPMZManager.html>
- `WaylineCheckError` enum: <https://github.com/dji-sdk/Mobile-SDK-Android-V5/issues/586>
- M4T thermal lens quirk: <https://github.com/dji-sdk/Mobile-SDK-Android-V5/issues/635>
- droneroute reference implementation: <https://github.com/fcsonline/droneroute>
- Model/payload numbers: <https://sdk-forum.dji.net/hc/en-us/articles/11580925155353>
