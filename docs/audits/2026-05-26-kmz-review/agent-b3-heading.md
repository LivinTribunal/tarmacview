# Agent B3 - Heading modes / yaw smoothness

Scope: heading-mode selection, per-placemark `waypointHeadingParam` emission,
`waypointPoiPoint` scoping + coordinate order + altitude, the
`smoothTransition` / `towardPOI` / `followWayline` matrix on HR / VP, and the
yaw-smoothness symptom on PAPI inspections.

Audited files:
- `backend/app/services/export/dji/heading.py`
- `backend/app/services/export/dji/placemark.py`
- `backend/app/services/export/dji/actions.py`
- `backend/app/services/export/dji/builders.py`
- `backend/app/services/export/dji/video.py`
- `backend/app/services/export/orchestrator.py`
- `backend/app/services/trajectory/methods/horizontal_range.py`
- `backend/app/services/trajectory/methods/vertical_profile.py`
- `backend/app/services/trajectory/helpers.py` (`_insert_video_hover_waypoints`)
- `frontend/src/components/mission/ExportPanel.tsx`,
  `frontend/src/components/mission/ExportFormatSection.tsx`

Spec sources fetched:
- `common-element.md` (WPML 1.0.6 - waypointHeadingMode enum, waypointPoiPoint
  format + altitude=0 allowance, no M4T in product matrix)
- `template-kml.md` (globalWaypointHeadingParam sample structure,
  useGlobalHeadingParam required at every Placemark)
- `waylines-wpml.md` (waylines.wpml structure)

## Summary

- P0 blockers: 0
- P1 high (smoothness): 1
- P2 conformance: 3
- P3 upgrades: 4

The §2.4 sentinel bug (waypointPoiPoint on every placemark) is gone. POI
coordinate order is correct (`lat,lon,0.000000`). Altitude is pinned to 0
per spec. The HR / VP / HOVER_POINT_LOCK / MEHT_CHECK methods correctly route
through the `body_tracks_target` predicate.

The single P1 is the user's stated symptom: under the default
`smoothTransition` mode, HR (lateral path tracking the PAPI) interpolates body
yaw LINEARLY between per-WP angles, but the bearing-to-PAPI along a straight
lateral path is non-linear, so the body lags the PAPI between waypoints
("abrupt correction" feel at each WP). This is reasoned in CLAUDE.md and
`docs/kmz-wpml-audit.md` §8 but the **default** stays `smoothTransition` and
the operator must know to switch to `towardPOI` per export. See [P1-1] for the
proposed mitigation.

## Findings

### [P1-1] HR default `smoothTransition` produces visible yaw lag between waypoints

- **Severity**: high
- **Location**: `backend/app/services/export/dji/heading.py:84`
  (`_dji_heading_mode` default), `backend/app/services/trajectory/methods/horizontal_range.py:54`
  (per-WP `heading = bearing_to_center`),
  `docs/kmz-wpml-audit.md` §8 (HR yaw smoothness goal)
- **Spec**: `common-element.md` waypointHeadingMode table:
  `smoothTransition` "transitions evenly to the target yaw angle of the next
  waypoint during the flight segment"; `towardPOI` "the aircraft heading
  faces the point of interest". For a *non-linear* bearing arc, only
  `towardPOI` keeps the body framed.
- **Current behavior**: `_dji_heading_mode(mission, override=None)` falls back
  to `"smoothTransition"` when neither override nor persisted column wins.
  For HR (every WP at constant altitude on a lateral path tracking the LHA),
  per-WP `wp.heading = bearing_between(wp_pos, center)` is correct *at* each
  WP, but the firmware linearly interpolates yaw between them. Between two
  HR WPs at lateral offset, the true bearing-to-LHA traces a non-linear arc;
  linear yaw between snapshot angles drifts off-LHA up to several degrees
  mid-segment, then snaps back on arrival. At 7x optical zoom the resulting
  framing oscillation is the operator's reported "abrupt correction"
  symptom.
- **Why it's wrong**: the default mode is documented in
  `docs/kmz-wpml-audit.md` §8 as the wrong shape for HR ("`towardPOI` is the
  correct mode" for HR). Leaving `smoothTransition` as the default means
  every HR export ships with the worse-framed shape unless the operator
  remembers to flip the picker. This is the second-priority objective the
  user named ("smoothness of drone yaw during measurements").
- **Evidence**:
  - `_dji_heading_mode` (heading.py:84): `return "smoothTransition"`.
  - `_body_tracks_target` predicate (heading.py:35-66): correctly identifies
    HR waypoints as bearing-to-target, so `_append_heading_param` emits the
    per-WP `smoothTransition` + `waypointHeadingAngle=<wp.heading>` block
    (heading.py:151-162) - the documented-but-jerky shape.
  - VP is a true vertical climb at one (lon, lat) so every WP shares
    `bearing_to_center` (vertical_profile.py:46) and shares lon/lat - linear
    interpolation between identical angles is fine for VP. The symptom is
    HR-specific.
- **Proposed fix**: two-step.
  1. Make the *HR-default* heading mode `towardPOI` while keeping
     `smoothTransition` as the global default for non-HR. Cleanest seam:
     resolve the mode per-inspection instead of per-mission inside
     `_append_heading_param` - if the WP belongs to an HR inspection AND no
     explicit override is set, prefer `towardPOI`. This is hardware-tested
     to work on M4T per `docs/kmz-wpml-audit.md` §11 and §8.
  2. If a per-inspection switch is too invasive for the thesis cut, change
     the column-level default to `towardPOI` and let `smoothTransition`
     become opt-in via the picker. The risk is firmware fragility
     (`common-element.md` does not list M4T as a supported product for
     `towardPOI`, see §3.2 of the 2026-05-15 audit), but operator reports
     in the codebase indicate it works in practice.
- **HW verify**: re-export one of the three reporter KMZs from
  `docs/audits/2026-05-11-papi-altitude-camera-aim.md` §1 with the new
  default; fly at 7x optical zoom on the M4T; confirm the camera stays
  centred on the PAPI across the lateral path with no abrupt yaw snap at
  each WP. The PAPI altitude+camera-aim audit §4.1 already names this as
  the hardware-test re-record step.

### [P2-1] `globalWaypointHeadingParam` is template-only; spec lists it under both folders

- **Severity**: low (Pilot 2 has been tolerating its absence in waylines)
- **Location**: `backend/app/services/export/dji/builders.py:106-110`
  (template emits it), `backend/app/services/export/dji/builders.py:213-244`
  (waylines folder block, no global heading param)
- **Spec**: `template-kml.md` shows `globalWaypointHeadingParam` inside the
  `<Folder>` of the waypoint template. The 30.waylines-wpml.md sample folder
  in the spec also carries a `globalWaypointHeadingParam` sibling block, but
  the fetched sample is truncated and does not include explicit text
  requiring it.
- **Current behavior**: template.kml emits `globalWaypointHeadingParam` with
  mode `followWayline`. waylines.wpml emits no folder-level
  `globalWaypointHeadingParam` - every Placemark carries its own
  `waypointHeadingParam` block in-line.
- **Why it's wrong**: a Placemark whose `waypointHeadingParam` matches the
  global block could legally use `useGlobalHeadingParam=1` and inherit. The
  waylines folder skips `useGlobalHeadingParam` entirely
  (placemark.py:231-238), so this is not a contradiction - but emitting a
  parallel `globalWaypointHeadingParam` in waylines would match
  template-kml.md exactly and let a strict validator key on it. Pilot 2 has
  not complained about this in practice.
- **Evidence**: builders.py:106 emits only on the template path; the
  waylines builder (line 213+) has no equivalent block.
- **Proposed fix**: emit `globalWaypointHeadingParam` in the waylines folder
  too (byte-identical to the template block) for parity. The block is
  inert under the current per-Placemark scheme because waylines drops
  `useGlobalHeadingParam`, so the emission is metadata-only and cannot
  change flight behaviour.
- **HW verify**: N/A - parity emission, no semantic change.

### [P2-2] `waypointHeadingPoiIndex` is emitted but is not in common-element.md

- **Severity**: low
- **Location**: `backend/app/services/export/dji/heading.py:161,178,191`
  and `builders.py:110`
- **Spec**: `common-element.md` documents `waypointHeadingMode`,
  `waypointHeadingAngle`, `waypointPoiPoint`, and `waypointHeadingPathMode`
  as the four `<wpml:waypointHeadingParam>` children. No
  `waypointHeadingPoiIndex` element appears in the fetched spec text.
- **Current behavior**: every `waypointHeadingParam` block (template global,
  template per-WP, waylines per-WP, across all three modes) emits
  `<wpml:waypointHeadingPoiIndex>0</wpml:waypointHeadingPoiIndex>` as the
  final child.
- **Why it's wrong**: emitting an undocumented element risks rejection by a
  strict validator (UgCS / 3rd-party WPML linters). Pilot 2 / FH2 tolerate
  it - this is the same pattern that previously masked the
  `waylineAvoidLimitAreaMode` issue (`docs/audits/2026-05-15-dji-wpml-spec-audit.md`
  §2.1).
- **Evidence**: the spec sample globalWaypointHeadingParam in template-kml.md
  shows only mode + angle + waypointPoiPoint + waypointHeadingPathMode -
  no PoiIndex child. The audit doc `common-element.md` quotes the four
  documented children with no fifth.
- **Proposed fix**: drop the `waypointHeadingPoiIndex` emission across all
  three sites in `heading.py` and the `globalWaypointHeadingParam` in
  `builders.py`. Behaviour-preserving on Pilot 2; aligns with the spec
  pattern used to drop `waylineAvoidLimitAreaMode` in PR #508.
- **HW verify**: regenerate one KMZ post-removal and confirm Pilot 2 still
  imports clean.

### [P2-3] template global `waypointHeadingMode=followWayline` carries no
`waypointHeadingAngle` requirement, but we emit `0`

- **Severity**: very low (informational)
- **Location**: `backend/app/services/export/dji/builders.py:108`
- **Spec**: `common-element.md` says `waypointHeadingAngle` is "Required if
  wpml:waypointHeadingMode is smoothTransition". `followWayline` does not
  consume the angle. The template-kml.md sample globalWaypointHeadingParam
  emits the angle anyway (as `45`), so the spec sample treats it as a
  no-op present-but-ignored field.
- **Current behavior**: builders.py emits the global block with mode
  `followWayline` and a `waypointHeadingAngle` of `0`. heading.py emits
  the same in the per-placemark followWayline fallback (line 187).
- **Why it's wrong**: not wrong per the spec sample. Documented here for
  audit-trail completeness because the predicate that decides per-WP
  emission would be cleaner if the angle field only appeared in
  smoothTransition blocks.
- **Proposed fix**: none required. Leave the angle in for forward-compat
  with strict validators that key on the sample shape.
- **HW verify**: N/A.

## Upgrades (P3)

### [P3-1] HR `smoothTransition` falls back to per-WP angle even after a
collision reroute

`resolve_inspection_collisions` reroutes a colliding HR/VP measurement
around an obstacle but inherits `wp.heading` from the source slice
(`docs/kmz-wpml-audit.md` and services CLAUDE.md note this is deliberate).
`_body_tracks_target` then re-computes `bearing_between(rerouted_pos,
camera_target)` and the inherited heading no longer matches - the predicate
returns False and the rerouted WP falls through to followWayline + a
single per-WP rotateYaw snap mid-arc. `heading.py:48-53` flags this as
"cosmetic, not a safety issue". Hardware-test confirmation of whether the
visible snap matters at 7x zoom would close the loop; if confirmed,
plumb a `body_tracks_target: bool` flag on `WaypointData` (set when each
method writes `wp.heading`) so the predicate is method-truth-based
instead of geometry-recomputed.

### [P3-2] VP could use `fixed` instead of `smoothTransition`

For VP, every measurement WP shares the same (lon, lat) and the same
`heading_to_center` (vertical_profile.py:46), so the linear interpolation
between identical angles is a no-op. `fixed` is the semantically correct
WPML mode per `common-element.md` ("maintains the yaw angle of the aircraft
to the next waypoint after the waypoint action has been performed") and
matches `docs/kmz-wpml-audit.md` §8 which explicitly recommends `fixed` for
VP. The current `smoothTransition` shape is functionally equivalent
(0-degree transition between identical angles) but a stricter WPML
consumer might flag the unnecessary angle interpolation request. Two-line
change in `_append_heading_param` once `fixed` joins the `_DJI_HEADING_MODES`
literal (and the migration CHECK constraint - see services/CLAUDE.md
"_DJI_HEADING_MODE_VALUES" note).

### [P3-3] Increase HR waypoint density to reduce per-segment yaw drift

Independent of the chosen heading mode: shorter HR arc segments reduce the
mid-segment yaw drift under `smoothTransition` and reduce the firmware's
runtime yaw-rate change under `towardPOI`. The default
`measurement_density` of HR is operator-tunable per inspection and is not
linked to a "yaw smoothness" knob anywhere. Adding a "smoothness mode"
that bumps HR density when the export picks `smoothTransition` would
mitigate the [P1-1] symptom without flipping the heading mode. Trade-off:
denser HR = longer record duration, more storage. Tracked as a future
deepening, not a current PR.

### [P3-4] M4T support for `smoothTransition` / `towardPOI` is empirical

The WPML product-support matrix in `common-element.md` does NOT list M4T
for either mode (the matrix lists M300 RTK, M350 RTK, M30/M30T, M3E/M3T/M3M,
M3D/M3TD only). The inline comment at heading.py:146-150 already records
this caveat and points at the followWayline + per-WP rotateYaw fallback.
A future M4T firmware that regresses `smoothTransition` or `towardPOI`
would not surface in CI; the operator-side hardware re-record on the
mission report `7ca4a234` is the closest thing we have to a regression
net (named in `docs/audits/2026-05-15-dji-wpml-spec-audit.md` §4 and
`docs/audits/2026-05-11-papi-altitude-camera-aim.md` §4.1). Worth a
once-per-firmware-release re-test rather than a code change.

## What was verified (P0 candidates that came up clean)

- **`waypointPoiPoint` is scoped correctly.** Only the `towardPOI` branch
  emits the element (heading.py:174). The `smoothTransition` branch
  (151-162) and the `followWayline` fallback (185-191) do NOT emit
  `waypointPoiPoint`. The template `globalWaypointHeadingParam` in
  builders.py:106-110 carries no `waypointPoiPoint`. The
  sentinel-on-every-placemark bug from `docs/audits/2026-05-15-dji-wpml-spec-audit.md`
  §2.4 is gone.
- **`waypointPoiPoint` coordinate order is `lat,lon,alt` per spec.**
  heading.py:174 emits `f"{lat:.6f},{lon:.6f},0.000000"` after extracting
  `(lon, lat, _)` from the WKT via `point_lonlatalt`. The reversal at the
  write site is documented in `docs/audits/2026-05-11-papi-altitude-camera-aim.md`
  §4.3.
- **`waypointPoiPoint.alt` is pinned to `0.000000`.** heading.py:174.
  Matches the spec allowance ("the altitude can be set to 0") and
  decouples the POI from `camera_target.alt` so a below-takeoff target
  cannot trip Pilot 2's POI geometry pre-flight check (the Pilot 2
  launch-blocking bug recorded in audit §1.4).
- **HR (lateral, video) heading shape.** The exporter picks
  `smoothTransition` by default; the predicate `_body_tracks_target`
  correctly classifies HR WPs as bearing-to-target. The picker can switch
  to `towardPOI` per export. The default-vs-symptom mismatch is the [P1-1]
  finding above.
- **VP (vertical, video) heading shape.** Every WP shares one
  `heading_to_center` and one (lon, lat). Under `smoothTransition` this
  collapses to a constant yaw with 0-degree interpolation between WPs -
  functionally equivalent to `fixed`. The `gimbalEvenlyRotate` segment
  sweep (B4's scope) handles the pitch.
- **M4T inline safeguard.** heading.py:146-150 carries the inline comment
  documenting that the WPML product matrix does not list M4T for
  `smoothTransition` / `towardPOI` and pointing at the `followWayline`
  fallback via the `dji_heading_mode` column.
- **`globalWaypointHeadingParam` block in template.kml.** builders.py:106-110
  emits mode + angle + pathMode + poiIndex (poiIndex is the [P2-2]
  finding) and notably omits `waypointPoiPoint`. The block is gated on
  `useGlobalHeadingParam=1` (placemark.py:235), which fires only when the
  placemark's local block matches the global followWayline shape.
- **Heading mode x scope x capture_mode matrix.** All 9 combos
  (3 modes x {HR, VP, HOVER_POINT_LOCK, MEHT_CHECK, FO, SS} x
  {VIDEO_CAPTURE, PHOTO_CAPTURE}) route through `_emits_followwayline_block`
  -> `_aims_at_target` -> `_body_tracks_target`. Non-aimed
  (transit/takeoff/landing) WPs are byte-stable across all three modes
  (pinned by `test_non_aimed_placemark_byte_stable_across_modes` in
  test_export_service.py).
- **Per-export override write-back.** orchestrator.py:203-208 updates
  `mission.dji_heading_mode` only when the override differs from the
  persisted value, and only the column is touched (not via
  `regress_if_trajectory_changed`). The column is deliberately NOT in
  `TRAJECTORY_FIELDS` so the side effect cannot regress status to DRAFT
  (services/CLAUDE.md "Per-export override + persistence write-back").
