# Agent C4 — Degenerate geometry (zero-length segments, RECORDING bookends, distance/duration math)

Scope: every degenerate-geometry path the WPML writer touches. Specifically:

- `backend/app/services/export/dji/placemark.py` — `_nearest_leg_lengths`,
  `_append_placemark` (the `nearest_leg` consumer + the `executeHeight` /
  `waypointSpeed` emission), `_append_turn_param`.
- `backend/app/services/export/dji/mission_config.py` —
  `_emitted_distance_duration`, `_max_relative_height`, `_resolve_auto_speed`.
- `backend/app/services/export/dji/builders.py` — the placemark loop and the
  `wpml:distance` / `wpml:duration` emission site.
- `backend/app/services/export/dji/video.py` — `_video_smooth_emit_plan`
  passthrough and segment_target plan for VP / HR video.
- `backend/app/services/export/dji/heading.py` — `_body_tracks_target`
  bearing computation on zero-length legs and the per-mode emission branches.
- `backend/app/services/export/dji/actions.py` — `gimbalEvenlyRotate`
  emission, `_append_segment_action_group` on a zero-length segment.
- `backend/app/services/trajectory/helpers.py::_insert_video_hover_waypoints`
  — the source of the RECORDING_START / RECORDING_STOP collocation.
- `backend/app/services/trajectory/orchestrator/_postprocess.py::_compute_totals`
  — the math reference for the `wpml:distance` / `wpml:duration` comparison.
- `backend/app/services/trajectory/pathfinding/_reroute.py::resolve_inspection_collisions`
  — the new collocation source flagged in the brief.

Target: DJI Matrice 4T (exported as M30T enums via the `_M4T_FALLBACK_ENUM`
table), WPML 1.0.6.

Spec quoted verbatim from `dji-sdk/Cloud-API-Doc` (commit master, retrieved
2026-05-26):

- `waypointTurnDampingDist` range: `(0, the maximum length of wayline
  segment]` with the constraint "The wayline segment between two waypoints
  should be greater than the sum of the turn intercepts of two waypoints"
  (`40.common-element.md`). Required when `waypointTurnMode` is
  `coordinateTurn` OR `toPointAndPassWithContinuityCurvature` with
  `useStraightLine=1`. Range is exclusive on both sides — `0` is NOT in
  range, and a damping value of `0.2 m` on a `0 m` segment fails the upper
  bound as well.
- `waypointSpeed` range: `(0, Maximum flight speed of this drone]`
  (`30.waylines-wpml.md`). Required if `useGlobalSpeed=0`. **Range is
  exclusive of 0.** "Speed of drone flying from current waypoint to the
  next waypoint."
- `hoverTime` range: `> 0` (`40.common-element.md`). Required when emitted.
  Unit: seconds.
- `waypointPoiPoint`: required only when `waypointHeadingMode=towardPOI`;
  altitude component can be set to 0.
- `isRisky`: product support — M30/M30T, M3D/M3TD only
  (`30.waylines-wpml.md`). Not listed for M4T.
- `autoFlightSpeed` range: `(0, max drone speed]` — also exclusive of 0.
- `wpml:distance` / `wpml:duration`: not defined in any of the four spec
  pages; A2 (waylines-wpml audit) flags emission as undocumented. This
  audit owns the math; A2 owns the conformance question.

Existing audits cross-read:

- `docs/audits/2026-05-15-dji-wpml-spec-audit.md` §5.2 (the original
  turn-damping clamp that introduced the zero-length-leg exclusion).
- `docs/kmz-wpml-audit.md` §11 (current exporter state — first-measurement
  anchor snap, RECORDING_START hover bookend).
- `docs/audits/2026-05-26-kmz-review/agent-c2-turn-damping.md` §[P1-1] —
  C2 owns the per-WP damping clamp itself; this audit owns every other
  degenerate-geometry path that consumes (or should consume) the same leg
  data.
- `docs/audits/2026-05-26-kmz-review/agent-a2-waylines-wpml.md` —
  `wpml:distance` / `wpml:duration` undocumented-element question (separate
  from the math correctness flagged here).

---

## Severity counts

- P0 (BLOCKER): **1**
- P1 (HIGH): **3**
- P2 (CONFORMANCE): **3**
- P3 (UPGRADE): **2**

---

## Findings

### [P0-1] `waypointSpeed=0` is emitted whenever `wp.speed` is null or zero (spec range is exclusive of 0)

- **Severity**: P0 (BLOCKER — out-of-range mandatory field; strict
  validators / `IWPMZManager.checkValidation` reject; Pilot 2 may refuse the
  wayline or treat as stop-and-hold)
- **Location**: `backend/app/services/export/dji/placemark.py:204`
  ```python
  _sub_text(placemark, "waypointSpeed", f"{wp.speed or 0:g}")
  ```
- **Spec**: `30.waylines-wpml.md` — `waypointSpeed` range is `(0, Maximum
  flight speed of this drone]`, m/s, required if `useGlobalSpeed=0`. **Range
  is exclusive of 0.** The template emits `useGlobalSpeed=1` on every
  placemark (so the per-WP value is technically advisory in the template),
  but `waylines.wpml` placemarks omit every `useGlobal*` flag (it's already
  executable) — every wayline placemark uses the local `waypointSpeed`
  value as the truth.
- **Current behavior**: Production trajectories normally populate
  `wp.speed` from `mission.default_speed` or the per-method default, so the
  fallback rarely fires. The known fall-through paths are:
  1. **`TRANSIT` waypoints with no upstream speed assignment.** The
     orchestrator's `_assemble_core` sets `speed=default_speed` on
     bookend TRANSITs and the inter-pass transit cluster inherits from the
     source, but `compute_transit_path`'s intermediate A* nodes are
     generated by `pathfinding` without a guaranteed speed. A null leaks
     through.
  2. **A `mission.default_speed` left null.** Schema floors it at >0, but
     the test fixtures and seeder bypass the schema and assign None / 0
     directly, and any legacy mission row predating the floor can hold a
     null in the column.
  3. **Photo measurements after a reroute.** `resolve_inspection_collisions`
     inherits `speed` from the nearest source waypoint — fine when the
     source is positive, but if the source itself fell through to None
     (case 1), the reroute propagates the null.
  4. **HOVER bookends (`RECORDING_START` / `RECORDING_STOP`)** — these
     inherit `first.speed` / `last.speed` from the measurement they wrap,
     so a measurement with `speed=0` propagates into the bookend. Real
     production missions never zero a MEASUREMENT speed today, but
     `wp.speed=0` would also propagate.
  - In every fall-through case the writer emits
    `<wpml:waypointSpeed>0</wpml:waypointSpeed>`, which is out of range.
- **Why it's wrong**: `0:g` formats to the literal `0`, not even
  `0.0`. Pilot 2 v10.x has been observed to silently treat
  out-of-range `waypointSpeed` as "stop at this waypoint and hold" on
  some firmwares, and to refuse the wayline outright on stricter ones.
  Either failure mode is hard to diagnose from the operator side
  ("the drone stalled at WP3" with no error message). Coming from the
  range *(0, max]*, even an arbitrarily small positive epsilon
  (`autoFlightSpeed`, `mission.default_speed`, or a hardcoded floor) is
  in-range and safe.
- **Evidence**: `placemark.py:204` reads verbatim above. The fallback chain
  in the Litchi generator (`litchi.py`) — `wp.speed > 0` →
  `mission.measurement_speed_override` for MEASUREMENT/HOVER →
  `mission.default_speed` for everything else → `_LITCHI_DEFAULT_CRUISE_SPEED
  = 5.0`, clamped at `_LITCHI_MIN_SPEED = 0.1` — is the canonical
  in-codebase template for this kind of clamp and is what the CLAUDE.md
  gotcha calls out as the model. The DJI writer has no such clamp.
- **Proposed fix**: Mirror Litchi's chain. Resolve `wp.speed` against
  `auto_speed` (already computed by `_resolve_auto_speed` and threaded into
  `_emitted_distance_duration`) at the per-placemark site, then floor at a
  small positive like `0.1 m/s` so a degenerate `auto_speed=0` cannot
  re-introduce a zero. The change is one line:
  ```python
  effective = wp.speed if (wp.speed and wp.speed > 0) else auto_speed_float
  if not effective or effective <= 0:
      effective = 0.1
  _sub_text(placemark, "waypointSpeed", f"{effective:g}")
  ```
  Thread `auto_speed_float` into `_append_placemark`. Pin with a fixture
  whose mission has `default_speed=None` and assert the wayline emits a
  positive `waypointSpeed` on every WP.
- **HW verify**: required only if hardware behavior on `waypointSpeed=0`
  is unconfirmed. The brief flags this as the P0 ceiling — without a real
  Pilot 2 log line from a `=0` mission, the severity rests on the spec's
  strict-range wording. Either way the fix is cheap and risk-free.

---

### [P1-1] `_emitted_distance_duration` undercounts duration by the takeoff / landing / hover / settle penalties (and so disagrees with `flight_plan.estimated_duration`)

- **Severity**: P1 (HIGH — operator-facing ETA divergence, not a flight
  safety issue, but is the kind of inconsistency Pilot 2 / FH2 can flag in
  the mission summary panel and the operator notices on every export)
- **Location**: `backend/app/services/export/dji/mission_config.py:265-304`
  vs
  `backend/app/services/trajectory/orchestrator/_postprocess.py:241-280`
- **Spec**: `wpml:distance` / `wpml:duration` are not in the four DJI
  WPML markdown pages, so there is no authoritative DJI definition.
  The contract is internal: the wayline-level fields drive Pilot 2's
  summary panel, and they must not contradict the persisted
  `flight_plan.estimated_duration` value on the same mission.
- **Current behavior**: The orchestrator's `_compute_totals(all_waypoints,
  scope)` and the writer's `_emitted_distance_duration(waypoints,
  auto_speed)` use the **same 3D per-leg distance formula** (haversine on
  the horizontal projection + altitude delta via `math.hypot`), so the
  geometry side agrees — modulo scope (the writer sums over the emitted
  slice, the orchestrator over the full trajectory, which is intentional
  per CLAUDE.md and documented in the docstring on
  `_emitted_distance_duration`). **Duration is a different story**:
  - **Orchestrator** (`_compute_totals`): per-leg trapezoidal accel/decel
    profile (`_segment_duration_with_accel(d, v_prev, v_cur)`) + fixed
    `TAKEOFF_DURATION + LANDING_DURATION` when scope is FULL +
    `GIMBAL_SETTLE_TIME` whenever the segment type changes into
    MEASUREMENT / HOVER + `wp.hover_duration` on every WP that has one.
  - **Writer** (`_emitted_distance_duration`): per-leg
    `leg / (curr.speed or auto_speed)` — plain straight-line at constant
    cruise. No accel/decel, no fixed bookend time, no settle, no hover.
  - For a typical PAPI mission (5 inspections × 3 RECORDING bookends ×
    2 sec hover_duration + 4 inter-pass settle + takeoff/landing) the gap
    is on the order of 30-60 sec on a 5-min flight, i.e. 10-20%.
- **Why it's wrong**: Pilot 2's summary panel and the persisted mission
  ETA disagree by minutes on long missions. Operators read the wayline-
  level `wpml:duration` from the import view and the
  `flight_plan.estimated_duration` from the planner's UI; the
  inconsistency surfaces as "the planner says 8m, Pilot 2 says 6m" with
  no documented explanation. The orchestrator value is the more accurate
  one (it's the same number `check_battery` uses), so the writer should
  match.
- **Evidence**: read the two functions side-by-side. The orchestrator adds
  `tl_fixed`, `GIMBAL_SETTLE_TIME`, and `all_waypoints[j].hover_duration`;
  the writer adds none of the three. The geometric distance side IS
  consistent — both use `math.hypot(haversine, alt_delta)`.
- **Proposed fix**: Either (a) replace the per-leg `leg / speed` accumulator
  with a delegation to `_segment_duration_with_accel` + the same fixed /
  settle / hover penalties (lift the helper into a shared module under
  `export/dji/` or `app/utils/`), or (b) feed
  `flight_plan.estimated_duration` directly when the scope matches the
  full trajectory (FULL only) and keep the slice math for MO/NTL. Option
  (a) is the more honest fix; option (b) is one line. Pin with a fixture
  that asserts the wayline `wpml:duration` is within 5% of
  `flight_plan.estimated_duration` for a FULL scope export.
- **HW verify**: not required — this is operator-perceived ETA accuracy,
  not a flight-time decision.

---

### [P1-2] RECORDING_START / RECORDING_STOP hover bookends emit `<wpml:waypointSpeed>` at the wrapped measurement's speed even though the leg into/out of the bookend has length 0

- **Severity**: P1 (HIGH — smoothness + ETA accuracy)
- **Location**: `backend/app/services/trajectory/helpers.py:443-469` (the
  source of collocation) + `backend/app/services/export/dji/placemark.py:204`
  (the speed emission, which has no awareness of collocation)
- **Spec**: `waypointSpeed` is "Speed of drone flying from current waypoint
  to the next waypoint" (`30.waylines-wpml.md`). On a zero-length leg the
  field is meaningless, but firmware still consumes it and uses it to
  compute the trapezoidal segment time.
- **Current behavior**: `_insert_video_hover_waypoints` (in
  `services/trajectory/helpers.py`) creates a `HOVER` waypoint
  byte-collocated with the first MEASUREMENT (same lon/lat/alt) carrying
  `camera_action=RECORDING_START` and a non-zero `hover_duration`
  (`config.recording_setup_duration`, typically 2 sec). The HOVER is
  followed by the MEASUREMENT at the identical (lon, lat, alt), so the
  leg HOVER→MEASUREMENT is exactly zero. The exporter emits both as
  separate placemarks; the MEASUREMENT placemark's `waypointSpeed` is the
  measurement's cruise speed (e.g. 1 m/s), but the leg into it is 0 m, so
  the firmware never gets to use the speed — it transitions instantly.
  The downstream HOVER→MEASUREMENT damping clamp (the C2 P1-1 finding) is
  the more dangerous symptom; **this** finding is the upstream cause —
  zero-length legs from the bookend collocation propagate everywhere.
- **Why it's wrong**: Pilot 2 sometimes interprets a 0-distance leg with a
  non-zero `waypointSpeed` as a stop-and-hold, which then layers the
  hover_duration on top of an already-implicit stop. The drone hovers for
  4 seconds instead of 2. The smoothness regression is small (the
  RECORDING bookend is intentionally a hover anyway), but the duration
  miscount compounds with P1-1 above.
- **Evidence**: `helpers.py:443-469` copies `first.alt`, `first.lon`,
  `first.lat` verbatim into the HOVER bookend so the
  HOVER→MEASUREMENT leg geometry is `(0, 0, 0)`. The exporter has no
  branch that detects the zero leg and merges. Litchi's
  `_LITCHI_MIN_3D_DIST = 0.6` `_group_collocated` pass does exactly this
  (CLAUDE.md gotcha for `litchi.py`); the DJI exporter has no equivalent.
- **Proposed fix**: two options:
  1. **Detection only**. Add a `_merge_collocated_recording_bookends`
     pass between `_video_smooth_emit_plan` and `_append_placemark` that
     folds the HOVER's `hover_duration` + `RECORDING_START` action onto
     the wrapped MEASUREMENT (or vice versa) and drops the redundant
     placemark. Mirrors Litchi.
  2. **Separation only**. In the trajectory pipeline, nudge the HOVER
     bookend ~0.3 m back along the previous TRANSIT's heading (or
     ~0.3 m up in altitude) so the leg is no longer zero. This is the
     safer DJI-side fix but changes trajectory data.
  Option (1) is the right one for DJI; the trajectory still hands
  back collocated waypoints so every other format (KML, JSON, MAVLink)
  is unchanged, and the merge happens at the boundary. Pin with a
  fixture that asserts a VP video pass with bookends emits N+1
  placemarks (not N+3).
- **HW verify**: required — operator should confirm a video pass with
  bookends starts recording at the expected pose, not 2 sec later.

---

### [P1-3] `_body_tracks_target` returns `False` on a collocated waypoint pair where the bearing is undefined, so a rerouted-onto-itself measurement falls through to `followWayline` mid-arc

- **Severity**: P1 (HIGH — smoothness)
- **Location**: `backend/app/services/export/dji/heading.py:35-66`
  (`_body_tracks_target`) + `backend/app/services/trajectory/pathfinding/_reroute.py`
  (the upstream collocation source flagged in the brief)
- **Spec**: `waypointHeadingMode=smoothTransition` is the default
  (M4T-tested) heading mode; `_body_tracks_target` is the predicate that
  decides whether to emit the per-WP `smoothTransition` + `waypointHeadingAngle`
  override or fall through to the global `followWayline` block.
- **Current behavior**: `_body_tracks_target` calls `bearing_between(wp_lon,
  wp_lat, ct_lon, ct_lat)` to compute the bearing from the waypoint to its
  `camera_target`. When the **waypoint and camera_target are byte-equal**
  (which `_insert_video_hover_waypoints` produces on a hover-on-LHA-center
  mission like HOVER_POINT_LOCK or MEHT_CHECK, where `camera_target =
  first.camera_target` and `wp.position = first.position`), the bearing is
  numerically undefined — `bearing_between` returns 0.0 by definition
  (atan2 of two zero deltas). The predicate then computes
  `delta = ((wp.heading - 0) + 180) % 360 - 180` — a non-zero `delta` for
  any `wp.heading != 0`, which fails the 5° tolerance and pushes the WP
  into the `followWayline` branch.
- **Why it's wrong**: A HOVER bookend on a HOVER_POINT_LOCK mission (drone
  hovers ON the LHA looking at it) gets the followWayline block + a
  per-WP `rotateYaw` snap mid-flight. The yaw snap looks correct on
  paper but firmware-interprets as "rotate to N° from current heading
  *while hovering at a single point*", which on the M4T sometimes
  manifests as a 90° yaw spin between video frames. Cosmetic on most
  methods (HR / VP keep some standoff), but real on HOVER_POINT_LOCK
  and MEHT_CHECK where the standoff is 0.
- **Evidence**: `heading.py:60-66`:
  ```python
  bearing = bearing_between(wp_lon, wp_lat, ct_lon, ct_lat)
  delta = ((wp.heading - bearing + 180.0) % 360.0) - 180.0
  return abs(delta) <= _BODY_TRACKS_TARGET_TOLERANCE_DEG
  ```
  No collocation guard. The reroute path's edge case is documented in
  `heading.py:48-53` as a docstring comment ("a HR/VP waypoint rerouted
  by `resolve_inspection_collisions` inherits the original wp.heading
  but sits at a new (lon, lat). the resolver does not recompute heading
  toward the camera_target...") — same predicate, different cause.
- **Proposed fix**: Add a zero-standoff guard:
  ```python
  horiz_offset = distance_between(wp_lon, wp_lat, ct_lon, ct_lat)
  if horiz_offset < _COLLOCATION_FLOOR_M:  # e.g. 0.01 m
      return True  # collocated WP+target -> any heading is "tracking", emit smoothTransition
  ```
  The branch returns True so the per-WP `smoothTransition` +
  `waypointHeadingAngle` override fires, and the firmware interpolates
  body yaw smoothly between adjacent WPs. Pin with a unit test on
  `_body_tracks_target` with byte-equal position + camera_target.
- **HW verify**: required for HOVER_POINT_LOCK / MEHT_CHECK methods on
  the M4T, where the standoff is genuinely 0.

---

### [P2-1] `isRisky=0` is emitted on every WPML placemark including M4T missions; spec scopes the field to M30/M30T/M3D/M3TD only

- **Severity**: P2 (conformance)
- **Location**: `backend/app/services/export/dji/placemark.py:268`
  ```python
  _sub_text(placemark, "isRisky", "0")
  ```
- **Spec**: `30.waylines-wpml.md` — `isRisky` product support is listed as
  "M30/M30T, M3D/M3TD" only. M4T is not in the supported list (M4T is not
  in any public DJI WPML matrix at all — the exporter falls back to the
  M30T enum tuple via `_M4T_FALLBACK_ENUM`, which means the file is
  *labelled* as M30T, but a strict validator that decodes the enum and
  re-checks element support against the actual product family will flag
  M4T `isRisky` as scope violation).
- **Current behavior**: emitted unconditionally on every waylines
  placemark. Pilot 2 tolerates the extra element today (we ship M30T-
  labelled files and Pilot 2 reads the enum); a stricter validator
  (`IWPMZManager.checkValidation`) may reject.
- **Why it's wrong**: same shape as the 2026-05-15 audit §2.4
  (`waypointPoiPoint` zero sentinel) and §2.1
  (`waylineAvoidLimitAreaMode`): an element emitted outside its
  spec-defined product scope. Bookend WPs (RECORDING_START /
  RECORDING_STOP / TAKEOFF / LANDING) also carry `isRisky=0`, with no
  semantic meaning.
- **Proposed fix**: gate the emission on
  `drone_supports_dji_wpml(drone_profile) and drone_profile.model in
  ISRISKY_SUPPORTED_MODELS = {"Matrice 300 RTK", "Matrice 350 RTK", ...}`
  (M30/M30T mapping plus M3D/M3TD when those land in `DJI_WPML_ENUMS`).
  M4T missions stop emitting the tag. Pilot 2 byte-stable behavior on
  the supported models. Pin with a regression test that asserts no
  `<wpml:isRisky>` element on an M4T-flagged mission.
- **HW verify**: not required.

---

### [P2-2] `wpml:distance` / `wpml:duration` emit `0` for missions with `len(waypoints) < 2`

- **Severity**: P2 (conformance)
- **Location**: `backend/app/services/export/dji/mission_config.py:281-282`
  ```python
  if len(waypoints) < 2:
      return 0.0, 0.0
  ```
  consumed at `builders.py:240-242`:
  ```python
  _sub_text(folder, "distance", f"{emitted_dist:g}")
  _sub_text(folder, "duration", f"{emitted_dur:g}")
  ```
- **Spec**: `wpml:distance` / `wpml:duration` are undocumented in the four
  WPML pages (A2 owns that finding). DJI's own FH2 export emits positive
  numbers always. A `<wpml:distance>0</wpml:distance>` /
  `<wpml:duration>0</wpml:duration>` is structurally valid but
  semantically meaningless.
- **Current behavior**: `test_empty_waypoints_produces_valid_archive`
  exercises the 0-waypoint path (no placemarks at all — fine). The
  `len == 1` single-placemark path is untested. The mission summary in
  Pilot 2 shows "0 m / 0 sec" for a single-WP wayline, which then
  triggers the operator-facing "wayline metadata disagrees with the
  placemark count" warning the docstring in
  `_build_dji_waylines_wpml` calls out.
- **Why it's wrong**: `len == 1` is a real edge case (a one-measurement
  MEASUREMENTS_ONLY HOVER_POINT_LOCK mission). Emitting `0` for both
  fields is mathematically correct (no legs to travel) but Pilot 2 may
  refuse the wayline as the docstring warns. The fix is structural: if
  the mission has only ONE WP, the wayline is degenerate and the export
  should probably refuse / warn earlier rather than ship a
  zero-distance file.
- **Evidence**: read the function verbatim. Add a single-WP fixture; no
  test exercises this today.
- **Proposed fix**: either (a) raise a clear `ValueError` at the
  `_emitted_distance_duration` call site when `len < 2` and the scope is
  `FULL` (a real flight always has at least a takeoff and a landing),
  or (b) accept the degenerate file as written but add a `logger.warning`
  so the operator sees the issue in the export log. Option (b) is the
  current path; option (a) is the safer DJI-side fix. Pin with a fixture.
- **HW verify**: not required — operator-facing only.

---

### [P2-3] Zero-length-segment `gimbalEvenlyRotate` is not suppressed when VP-video collocates two adjacent measurements

- **Severity**: P2 (conformance + smoothness)
- **Location**: `backend/app/services/export/dji/placemark.py:251-257` +
  `actions.py:238-272` (`_append_segment_action_group`)
- **Spec**: `gimbalEvenlyRotate` on `actionTriggerType=betweenAdjacentPoints`
  ramps the gimbal pitch evenly **across the time spent traversing the
  segment between the two referenced waypoints**. On a zero-length
  segment the segment time is `0 / speed = 0` and the ramp is
  mathematically undefined — firmware behavior is product-specific (DJI
  has not published spec language for this case).
- **Current behavior**: `_video_smooth_emit_plan` emits a
  `segment_target` for every VP video MEASUREMENT that has a successor
  measurement in the same inspection — without checking whether the
  successor is collocated. The placemark loop then unconditionally calls
  `_append_segment_action_group`, which emits the
  `betweenAdjacentPoints` group with `gimbalPitchRotateAngle=target_pitch`
  even when the two measurements are byte-equal.
- **Why it's wrong**: A reroute (`resolve_inspection_collisions`) or a
  pathological VP density (`measurement_density=0` slipping the schema
  floor) can place two VP measurements arbitrarily close in (lon, lat,
  alt). The C2 audit P1-1 covers the damping clamp side; the
  `gimbalEvenlyRotate` action side has the same root cause but a
  different consequence — undefined gimbal ramp instead of out-of-range
  damping.
- **Evidence**: read `_video_smooth_emit_plan` (`video.py:153-167`) — no
  segment-length guard. `_append_segment_action_group` has no guard
  either.
- **Proposed fix**: Drop the `segment_target` from the plan entry when
  the segment 3D length is below a floor (e.g. `1e-3 m`). The check can
  ride on the same `_nearest_leg_lengths` infrastructure C2's fix
  introduces — if the leg to the next measurement is non-positive,
  emit no segment group on this WP. Pin with a fixture of two
  collocated VP measurements (same alt, same lon/lat) and assert no
  `betweenAdjacentPoints` actionGroup is emitted.
- **HW verify**: not required until the pathological VP density is
  observed in production.

---

## Upgrades (P3)

- **P3-1 — Centralize the 3D-leg computation.** Three sites compute the
  same `math.hypot(distance_between(...), alt_delta)` per-leg formula:
  `_emitted_distance_duration` (`mission_config.py:295-296`),
  `_nearest_leg_lengths` (`placemark.py:76-77`), and `_compute_totals`
  (`orchestrator/_postprocess.py:255-257`). They agree today; a refactor
  could lift them into a shared `app.utils.geo` helper
  `leg_3d(prev_wp, curr_wp)` so they cannot drift. The C2 P1-1 fix
  (the zero-leg detection in damping) and this audit's P2-3 fix (the
  zero-leg detection in `gimbalEvenlyRotate`) both add caller-side guards
  on the same formula — one shared helper would let both fixes ride on
  one invariant.

- **P3-2 — Litchi-style collocation merge in the DJI writer.** The
  Litchi generator already has `_LITCHI_MIN_3D_DIST = 0.6` and
  `_group_collocated` (CLAUDE.md gotcha). Lift that helper into a shared
  module under `export/` and call it from
  `_build_dji_waylines_wpml` / `_build_dji_template_kml` between the
  waypoint sort and the placemark loop, with a configurable floor (the
  DJI floor can be tighter than Litchi's 0.6 m — the WPML spec doesn't
  document a minimum, and `0.1 m` is enough to avoid the damping +
  gimbalEvenlyRotate issues without merging anything Pilot 2 cares about).
  This obsoletes P1-2 and P2-3 in one move, and gives every future format
  a consistent collocation-merge story. Lower priority than the per-site
  fixes because it touches more code.

---

## Cross-cutting observations (no severity)

- **The exporter has no integration test that exercises a degenerate-
  geometry mission end-to-end.** Every test fixture (`_make_flight_plan`,
  `_make_vp_video_pass`, `_make_hr_video_pass`,
  `_make_tight_vp_video_pass`) emits a well-formed trajectory; none
  collocate two measurements at the same (lon, lat, alt), or emit a
  zero-length leg outside the RECORDING bookend, or run the export with
  `len(waypoints) == 1` / `mission.default_speed = None`. The findings
  above are all "code path X handles case Y" claims — pinning them with
  fixtures is the right durable shape, and the C2 audit's
  `TestDjiTurnDampingClamp` is the template.

- **The orchestrator's `_compute_totals` and the writer's
  `_emitted_distance_duration` would benefit from a documented invariant**
  ("emitted distance is a subset slice of total distance; emitted
  duration uses the same per-leg accel/decel/settle profile but over the
  emitted slice"). Today the gap is implicit and only visible by reading
  both functions side by side. The CLAUDE.md gotcha is a half-step
  toward this but reads as "they're different by design" — the spec is
  "they're different on the slice, identical on the per-leg math".
  Pinning this as a unit test (assert
  `wpml_duration_full_scope ≈ flight_plan.estimated_duration` within
  1%) would let P1-1 land as a one-line fix.

- **The `_M4T_FALLBACK_ENUM`-as-`isRisky`-mask coincidence is fragile.**
  P2-1 above is *only* a problem because we ship every M4T mission
  labelled as M30T. The day `DJI_WPML_ENUMS` gains a real M4T entry
  with `droneEnumValue=??`, the `isRisky` emission becomes immediately
  spec-violating because M4T is genuinely not in the supported product
  list. The fix (gate emission on the *physical* drone, not the
  *labelled* enum) is the more durable shape.
