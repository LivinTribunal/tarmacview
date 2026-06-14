# DJI WPML 1.0.6 spec audit (2026-05-15)

After mission `7ca4a234-dd98-40a7-8352-503fa35acd3f` (Luka Jaro, Matrice 4T,
NTL scope, `towardPOI` heading mode) was rejected by DJI Pilot 2 at launch
with two pre-flight errors (altitude error, "wrongly placed point"), the
exporter `backend/app/services/export/dji/` (a single `export/dji.py` at audit
time; split into the `export/dji/` package by #562) was walked end-to-end against
the official DJI WPML 1.0.6 documentation set:

- `template-kml.md` — template.kml structure and the canonical
  `<wpml:missionConfig>` child order.
- `common-element.md` — every shared `<wpml:*>` element with valid range,
  default, and `towardPOI`-only scoping notes.
- DJI WPML product-support matrix — model × heading-mode × action coverage.

This document captures the findings. The launch bug (§1) and the
schema-conformance fixes (§2) are addressed in PR #508; the
documentation-only observations (§3) are inline-commented in the same PR
for future readers.

## 1. Primary launch bug — `_takeoff_ref_alt` (closed)

PR #478 commit `a821595e` ("fix: anchor DJI executeHeight + POI alt to
takeoff_ref_alt", part of the closed branch
`issue/476-db-backed-elevation-cache`) introduced a `_takeoff_ref_alt(...)`
helper that subtracted the resolved takeoff altitude from every per-point
write so `executeHeight` and `waypointPoiPoint` would land relative to the
takeoff anchor.

That commit was based on a misreading of the spec. `common-element.md`
states that `<wpml:takeOffRefPoint>` is informational only — the firmware
ignores the z-component at flight time and uses the live ellipsoid altitude
read at takeoff as the relative-mode origin. Subtracting the stored anchor
in the writer produced negative `executeHeight` (`-0.67 m` on the rejected
mission's first measurement) and negative `waypointPoiPoint.alt`
(`-12.3 m`), which Pilot 2 caught with `WaypointHeightOutOfRange` and the
POI geometry guard respectively.

The helper and its call sites never reached `main` (the branch was closed
without merging), but the test net that would have pinned the contract
went down with it. PR #508 lands the regression tests against the
post-revert math:

- `executeHeight = wp.alt - airport.elevation` (NTL / FULL scope, paired
  with `executeHeightMode=relativeToStartPoint`).
- `executeHeight = wp.alt` (MEASUREMENTS_ONLY, paired with
  `executeHeightMode=EGM96`).
- `waypointPoiPoint.alt = 0.000000` for every `towardPOI` placemark per
  the `common-element.md` allowance ("the altitude can be set to 0").

### 1.4 Switch to `executeHeightMode=WGS84` + HAE altitudes (issue #509)

> **Superseded by PR #726 (2026-05-24).** Hardware testing on the M4T
> reproduced a descend-to-ground symptom with the WGS84/HAE shape described
> below: `template.kml` and `waylines.wpml` disagreed on the same MSL number
> and Pilot 2 regenerates the executable wayline from `template.kml` on
> import, so the inconsistent template heights drove the executed altitude
> ~45 m below ground. The exporter is back on
> `executeHeightMode=relativeToStartPoint` with
> `executeHeight = wp_MSL − takeoff_ground_MSL` (see
> `docs/kmz-wpml-audit.md` §12 for the confirmed root cause and §11 for the
> current state). Section §1.4 is preserved as the history of the
> intermediate decision; do not act on the body below as current guidance.

The post-#508 shape above is the immediate cure; structurally it still
carries two issues:

- `relativeToStartPoint` (NTL / FULL) imposes the "every WP ≥ takeoff"
  constraint because the firmware refuses negative `executeHeight`. Any
  measurement below the takeoff anchor was previously caught by
  Pilot 2 as `WaypointHeightOutOfRange`.
- `EGM96` (MEASUREMENTS_ONLY) is not in the valid set for
  `executeHeightMode`. `common-element.md` scopes the value to the
  `template.kml`'s `wpml:waylineCoordinateSysParam/heightMode` slot only;
  `executeHeightMode` in `waylines.wpml` accepts `WGS84`,
  `relativeToStartPoint`, or `realTimeFollowSurface`.

Issue #509 lands the structural cure: every emitted `executeHeight` is the
HAE-converted MSL value (`msl_to_hae(lat, lon, wp.alt) = wp.alt +
egm96_undulation(lat, lon)`), and `executeHeightMode` is unconditionally
`WGS84`. The wayline then anchors against the M4T's RTK-corrected runtime
GNSS fix instead of the takeoff reference, which:

- removes the `relativeToStartPoint` constraint (negative
  `executeHeight` is no longer possible since the operating region's
  undulation is ~+44 m);
- replaces the invalid `EGM96` value;
- reverts `takeOffRefPoint.alt` to its spec-documented role of
  route-planning metadata (HAE-converted from the operator's takeoff MSL).

This matches what UgCS Pilot 2 exports use and what the open-source
`lefolab-dji-waypoints` generator emits. The template.kml side is
unchanged: `wpml:waylineCoordinateSysParam/heightMode` stays `EGM96`
(spec-valid on the template side) and per-placemark
`ellipsoidHeight` / `height` stay as raw MSL for preview consistency
with `takeOffRefPoint`.

The EGM96 undulation lookup is a coarse closed-form fit (fitted gaussian
bumps + leading J2-like term) embedded in `app.utils.geo`. It is
calibrated against the published EGM96 undulation at LZIB / Jaro Luka
(~+44.5 m) and accurate to ~1.7 m there. The earlier "~10 m global
accuracy" claim was wrong - cross-checks against the published EGM96 grid
at Tokyo show ~69 m off (wrong sign) and Mumbai ~28 m off, so the fit is
local to the LZIB region and degrades sharply outside it. This is not
load-bearing today (the §1.4 fix is the relative-to-takeoff encoding,
which is geoid-free), but the closed-form fit must not be reused for any
non-LZIB site without recalibration. Swapping in `geographiclib`'s 16 MB
egm96-15.pgm grid is the right long-term answer once
`backend/requirements.txt` (a protected file) gains the dependency.

**Hardware verification (TODO)**: regenerate mission
`7ca4a234-dd98-40a7-8352-503fa35acd3f` KMZ with the WGS84/HAE export,
fly at LZIB or Jaro Luka, and confirm the M4T tracks the planned MSL
altitudes within ±2 m with the PAPI framed at 7× zoom. Result will be
appended to this section once the bench test runs.

## 2. Schema-conformance fixes (folded in)

Each finding lists the spec section, the prior writer behaviour, and the
post-#508 shape.

### 2.1 `wpml:waylineAvoidLimitAreaMode` — drop

`common-element.md` does not list this element. Pilot 2 tolerated it but
strict validators reject the file. Removed from `_append_mission_config`.

### 2.2 `wpml:globalRTHHeight` scope — waylines only

`common-element.md` scopes `globalRTHHeight` to `waylines.wpml`. Prior
writer emitted it in both `template.kml`'s `missionConfig` and the
`waylines.wpml` mirror. Now emitted only when `in_waylines=True`.

### 2.3 `<wpml:missionConfig>` child order

After §2.1 / §2.2 land, the surviving children must be reordered to match
the canonical sample in `template-kml.md`:

```
flyToWaylineMode
finishAction
exitOnRCLost
executeRCLostAction
takeOffSecurityHeight
takeOffRefPoint           (template.kml only)
takeOffRefPointAGLHeight  (template.kml only)
globalTransitionalSpeed
globalRTHHeight           (waylines.wpml only)
droneInfo
payloadInfo
```

### 2.4 Non-`towardPOI` `waypointPoiPoint` sentinel — drop

`common-element.md` marks `waypointPoiPoint` required *only* when
`waypointHeadingMode=towardPOI`. Prior writer emitted
`waypointPoiPoint=0.000000,0.000000,0.000000` on every placemark including
`smoothTransition` and `followWayline` blocks plus the document-level
`globalWaypointHeadingParam`. The zero sentinel is a real coordinate off
the West African coast and a strict validator can flag it as a
mis-positioned POI. Now emitted only on `towardPOI` placemarks.

### 2.5 XML encoding header case

DJI sample files use uppercase `UTF-8`:

```
<?xml version="1.0" encoding="UTF-8"?>
```

Prior writer emitted lowercase `utf-8`. Switched both `template.kml` and
`waylines.wpml` headers to uppercase via `ET.tostring(..., encoding="UTF-8", ...)`.

### 2.6 `wpml:createTime` / `wpml:updateTime` format — already conformant

Spec uses 13-digit Unix epoch milliseconds (e.g. `1637600807044`). Writer
emits `int(now.timestamp() * 1000)` at the top of `_build_dji_template_kml`.
No change needed; documented here for the audit trail.

### 2.7 `wpml:globalHeight` in template `<Folder>` — already emitted

Spec lists `globalHeight` as required for waypoint templates. Writer
emits `<wpml:globalHeight>` in `_build_dji_template_kml`'s folder block.
No change needed; documented here for the audit trail.

### 2.8 `gimbalEvenlyRotate` trigger pairing — already conformant

Spec requires `actionTriggerType=betweenAdjacentPoints` whenever a group
contains a `gimbalEvenlyRotate` action. Writer only emits the action
inside `_append_segment_action_group`, which sets the trigger type
unconditionally. No change needed; documented here for the audit trail.
A regression assertion is added in PR #508 to pin the invariant.

### 2.9 `accurateShoot` — already absent

`accurateShoot` is deprecated per spec. Writer never emits it.
A regression assertion across all three heading modes is added in PR #508
so a future regression cannot reintroduce it silently.

## 3. Inline-comment observations (no code change)

### 3.1 M4T enum pair — PSDK-confirmed

`_dji_enums_for` returns `(drone=99, sub=1, payload=89, sub=0)` for every
mission. These ARE the correct M4T values, not an M30T collapse. The DJI
PSDK header `psdk_lib/include/dji_typedef.h` defines
`DJI_AIRCRAFT_TYPE_M4T = 99` and `DJI_CAMERA_TYPE_M4T = 89` directly. M30T
is PSDK aircraft `68`, not `99`. The "FH2 normalises every M4T export to
the M30T enum pair" theory that this section previously asserted was
wrong - it was an inference from `99/89` matching nothing in the public
WPML enum table, but the WPML enum table simply stops at the M3 generation
and the PSDK header is the authoritative source for M4T. Confirmed against
DJI Pilot 2's real M4T export at `docs/specs/PAPI 22.kmz`, which emits the
same `99/1/89/0` pair. An inline comment now records this provenance so a
future reader does not "fix" it back to a guessed M4T value.

### 3.2 M4T support for `smoothTransition` / `towardPOI` — empirical

The WPML product-support matrix does not list M4T as a supported model
for either `smoothTransition` or `towardPOI`. Hardware testing has shown
both work in practice on M4T firmware. An inline comment in
`_append_heading_param` now records this caveat so the operator
(eventually) knows where to look if a future firmware revision regresses.

## 4. Hardware verification — operator-side

CI cannot verify the DJI Pilot 2 launch path. Post-merge, the operator
regenerates mission `7ca4a234` against the new build and:

1. Imports the KMZ into DJI Pilot 2 and confirms launch succeeds
   without `WaypointHeightOutOfRange` or the POI geometry pre-flight error.
2. Sim-frames the mission in Flight Hub 2 and confirms the gimbal still
   centres on the PAPI at 7× zoom on the Jaro Luka shape (the framing
   residual from the original symptom is expected to remain — it is
   tracked in #509's WGS84 migration, not this PR).

## 5. Later spec-conformance fixes - export audit #635 / PR #638

A second WPML element-range pass (issue #635, "the export audit") turned up
two more `common-element.md` range violations in the now-split
`export/dji/` package. Both are behaviour-preserving and need no hardware
verification, so they were carved off into #637 and landed by PR #638
ahead of the hardware-gated remainder of #635. Same format as §2: spec
section, prior writer behaviour, post-#638 shape.

### 5.1 `wpml:actionGroupId` range - renumber into `[0, 65535]`

`common-element.md` caps `actionGroupId` at `[0, 65535]`. The reach-point
group used `wp.sequence_order` (1-indexed) directly, and the VP-video
segment group added a `_VP_VIDEO_SEGMENT_GROUP_ID_OFFSET` of `100000` -
already past the documented max before any per-waypoint offset, and
growing unbounded with waypoint count. `actionGroupId` is an opaque key
(Pilot 2 / FH2 read it as an id, not a position reference), so the value
itself is free to change as long as it stays unique per file. #638 dropped
the offset constant and interleaved the two id streams off
`sequence_order`: `_append_action_group` reach-point groups take the odd
lane (`2*index - 1`), `_append_segment_action_group` VP-video segment
groups take the even lane (`2*sequence_order`). The streams stay
collision-free and well inside `65535` past the 500-WP performance
ceiling. Behaviour-preserving; pinned by `TestDjiActionGroupIdRange` in
`test_export_service.py`.

### 5.2 `wpml:waypointTurnDampingDist` clamp under the local leg

`common-element.md` scopes `waypointTurnDampingDist` to
`(0, segment length]`. The continuity-curvature
(`toPointAndPassWithContinuityCurvature`) placemarks emitted on VP / HR
video measurement interiors hardcoded `0.2 m`, safe only by an unenforced
trajectory-spacing assumption: a measurement-density bump or a
`resolve_inspection_collisions` reroute can place two video measurements
closer than `0.4 m` apart and push the damping distance out of range.
#638 added `_nearest_leg_lengths(waypoints)` (3D leg, mirroring
`_emitted_distance_duration`) and threaded a `nearest_leg` kwarg through
`_append_placemark` → `_append_turn_param`. Continuity-curvature
placemarks now emit `min(0.2, 0.5 * nearest_leg)`; the default-stop path
keeps the literal `0.2` byte-for-byte. Zero-length legs (the collocated
RECORDING_START hover bookend) are excluded from the per-waypoint minimum
so the clamp can never emit `0`, which is itself outside the
`(0, segment length]` range. Pinned by `TestDjiTurnDampingClamp`.
