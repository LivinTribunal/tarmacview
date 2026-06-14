# Agent D2 — Test-matrix coverage gaps in the DJI export path

Scope: enumerate the full cell coverage of the
`(heading_mode × scope × capture_mode × inspection_method × drone)`
matrix exercised by `backend/tests/test_export_service.py`, then rank the
untested cells by likelihood of harboring a bug.

D1 owns mapping audit-invariants to tests. D3 owns over-mocked tests.
This audit owns the *cell coverage* slice: every distinct combination the
exporter branches on, and which ones the test suite never reaches.

Read first (cross-references — findings *not* re-flagged here):

- `docs/audits/2026-05-26-kmz-review/agent-a1-template-kml.md` —
  template.kml emission audit (per-element).
- `docs/audits/2026-05-26-kmz-review/agent-a2-waylines-wpml.md` —
  waylines.wpml emission audit (per-element).
- `docs/audits/2026-05-26-kmz-review/agent-a5-action-groups.md` — action-
  group + camera-action wiring.
- `docs/audits/2026-05-26-kmz-review/agent-b2-altitude.md` §[P0-3] —
  below-takeoff clamp.
- `docs/audits/2026-05-26-kmz-review/agent-b3-heading.md` — heading-mode
  resolver + per-mode emission.
- `docs/audits/2026-05-26-kmz-review/agent-c2-turn-damping.md` §[P1-1] —
  the `nearest_leg=None` fall-through case.
- `docs/audits/2026-05-26-kmz-review/agent-c4-degenerate.md` §[P0-1] —
  `waypointSpeed=0` emission; §[P1-3] — `_body_tracks_target` on
  collocated WP+target (HOVER_POINT_LOCK / MEHT_CHECK).
- `docs/audits/2026-05-26-kmz-review/agent-d1-invariant-test-map.md` —
  invariants → tests cross-reference.

---

## The matrix axes

Extracted from the export code (`backend/app/services/export/dji/`) and the
core enum module (`backend/app/core/enums.py`).

- **heading_mode** (`heading._dji_heading_mode`, valid set
  `_DJI_HEADING_MODES`):
  - `smoothTransition` (default)
  - `towardPOI` (experimental)
  - `followWayline` (snap fallback)

- **scope** (`enums.FlightPlanScope`, branched in
  `mission_config._append_mission_config` via `_AIRBORNE_SCOPES`):
  - `FULL`
  - `NO_TAKEOFF_LANDING` (NTL — airborne)
  - `MEASUREMENTS_ONLY` (MO — airborne)

- **capture_mode** (`InspectionConfiguration.capture_mode`; consumed by
  `video._is_vp_video_measurement` / `_is_hr_video_measurement` with `None`
  treated as `VIDEO_CAPTURE`):
  - `VIDEO_CAPTURE`
  - `PHOTO_CAPTURE`
  - `None` (inherits, defaults to `VIDEO_CAPTURE`)

- **inspection_method** (`enums.InspectionMethod`):
  - `VERTICAL_PROFILE` (VP) — PAPI
  - `HORIZONTAL_RANGE` (HR) — PAPI
  - `APPROACH_DESCENT` (AD) — PAPI (anchored on touchpoint, not LHA)
  - `MEHT_CHECK` — PAPI
  - `HOVER_POINT_LOCK` (HPL) — PAPI (operator-collocated hover; per C4 P1-3
    a known-undefined-bearing path)
  - `FLY_OVER` (FO) — RUNWAY_EDGE_LIGHTS (row direction)
  - `PARALLEL_SIDE_SWEEP` (PSS) — RUNWAY_EDGE_LIGHTS (row direction)

- **drone** (`mission_config._dji_enums_for`):
  - `Matrice 4T` (M4T — the target hardware)
  - `Matrice 300 RTK`, `Matrice 350 RTK`, `Mavic 3 Enterprise` (other mapped)
  - **Unmapped / non-DJI** — falls back to the M4T enum tuple in the
    file but does *not* affect any branch in the emission logic
    (`drone_profile` is read only by `mission_config._dji_enums_for`,
    `actions._append_zoom_action` (focal length math),
    `actions._first_zoom_emission_waypoints` (default optical zoom)).

Total cells (without drone): 3 × 3 × 3 × 7 = **189 cells**.
With drone (5 categories): **945 cells**, but drone only affects
enum-emission + zoom — every other branch is drone-independent.

---

## Coverage table (heading × scope × capture × method, M4T)

Cell key: `T` = at least one test exercises the combination end-to-end
(asserts on emitted XML), `t` = touched but only as a side effect of a test
that asserts on a different axis (no assertion on the cell-specific
emission), `−` = no test reaches this combination, `N/A` = combination is
either physically impossible or filtered by an earlier layer.

### heading_mode = `smoothTransition` (default — resolver returns this when mission has no override)

| scope               | capture       | VP  | HR  | AD  | MEHT | HPL | FO  | PSS |
|---------------------|---------------|-----|-----|-----|------|-----|-----|-----|
| FULL                | VIDEO_CAPTURE | T   | T   | −   | −    | −   | −   | −   |
| FULL                | PHOTO_CAPTURE | T   | T   | −   | −    | −   | −   | −   |
| FULL                | None          | T   | T   | −   | −    | −   | −   | −   |
| NO_TAKEOFF_LANDING  | VIDEO_CAPTURE | −   | −   | −   | −    | −   | −   | −   |
| NO_TAKEOFF_LANDING  | PHOTO_CAPTURE | −   | −   | −   | −    | −   | −   | −   |
| NO_TAKEOFF_LANDING  | None          | t   | t   | −   | −    | −   | −   | −   |
| MEASUREMENTS_ONLY   | VIDEO_CAPTURE | −   | −   | −   | −    | −   | −   | −   |
| MEASUREMENTS_ONLY   | PHOTO_CAPTURE | −   | −   | −   | −    | −   | −   | −   |
| MEASUREMENTS_ONLY   | None          | t   | t   | −   | −    | −   | −   | −   |

### heading_mode = `towardPOI`

| scope               | capture       | VP  | HR  | AD  | MEHT | HPL | FO  | PSS |
|---------------------|---------------|-----|-----|-----|------|-----|-----|-----|
| FULL                | VIDEO_CAPTURE | t   | t   | −   | −    | −   | N/A | N/A |
| FULL                | PHOTO_CAPTURE | t   | t   | −   | −    | −   | N/A | N/A |
| FULL                | None          | t   | t   | −   | −    | −   | N/A | N/A |
| NO_TAKEOFF_LANDING  | VIDEO_CAPTURE | −   | −   | −   | −    | −   | N/A | N/A |
| NO_TAKEOFF_LANDING  | PHOTO_CAPTURE | −   | −   | −   | −    | −   | N/A | N/A |
| NO_TAKEOFF_LANDING  | None          | −   | −   | −   | −    | −   | N/A | N/A |
| MEASUREMENTS_ONLY   | VIDEO_CAPTURE | −   | −   | −   | −    | −   | N/A | N/A |
| MEASUREMENTS_ONLY   | PHOTO_CAPTURE | −   | −   | −   | −    | −   | N/A | N/A |
| MEASUREMENTS_ONLY   | None          | −   | −   | −   | −    | −   | N/A | N/A |

N/A under `towardPOI` for FO/PSS only in the sense that row-direction
methods don't aim at a single point — but the export code does *not* gate
on this, so a misconfigured mission could pair `dji_heading_mode=towardPOI`
with FO/PSS and still emit per-WP towardPOI blocks. Flagged below.

### heading_mode = `followWayline`

| scope               | capture       | VP  | HR  | AD  | MEHT | HPL | FO  | PSS |
|---------------------|---------------|-----|-----|-----|------|-----|-----|-----|
| FULL                | VIDEO_CAPTURE | t   | t   | −   | −    | −   | −   | −   |
| FULL                | PHOTO_CAPTURE | t   | t   | −   | −    | −   | −   | −   |
| FULL                | None          | t   | t   | −   | −    | −   | −   | −   |
| NO_TAKEOFF_LANDING  | * (any)       | −   | −   | −   | −    | −   | −   | −   |
| MEASUREMENTS_ONLY   | * (any)       | −   | −   | −   | −    | −   | −   | −   |

### Multi-inspection fixtures

- `_stitch_two_vp_video_inspections` (`test_export_service.py:2496-2523`)
  exercises 2× VP video inspections in one mission — `T` (action-group id
  collision + segment-group test only).
- **No multi-inspection coverage** for any other combination: HR + VP,
  VP + HR, VP + FO, AD + anything, or any mix of more than 2 inspections.
  Production allows up to 10 inspections per mission (per the
  `Mission.add_inspection` invariant).

### Drone-axis coverage

| drone                | KMZ unit test | `export_mission` integration |
|----------------------|---------------|------------------------------|
| Matrice 4T           | T             | T (`test_kmz_export_loads_drone_profile`)            |
| Matrice 300 RTK      | T (parametrized `test_dji_enums_resolve_per_configured_drone`) | − |
| Matrice 350 RTK      | T (parametrized) | −                          |
| Mavic 3 Enterprise   | T (parametrized) | −                          |
| Unmapped DJI (Mavic 2 Pro) | T (`_dji_enums_fallback_to_m4t_for_unmapped_drone` + `test_kmz_export_falls_back_to_m4t_for_mavic_2_pro`) | T |
| Non-DJI (Skydio X10) | T (`drone_supports_dji_wpml` predicate + `test_kmz_export_falls_back_to_m4t_for_non_dji_drone`) | T |
| `None` (no drone)    | T (`_dji_enums_fallback_to_m4t_for_unmapped_drone` + `test_kmz_export_falls_back_to_m4t_when_no_drone_configured`) | T |

Drone axis is **comprehensively covered** for the enum emission and
zoom-factor emission, but the *interaction* between drone profile and the
rest of the matrix is untested (e.g. M300 RTK + MO + VP video).

---

## Coverage summary

Counting cells where heading × scope × capture × method coverage is `T`
(end-to-end-asserted):

- **smoothTransition × FULL × {photo, video, None} × {VP, HR}**: 6 cells `T`.
- **towardPOI × FULL × {any} × {VP, HR} (aimed)**: 6 cells `t` (only the
  POI-emission shape is asserted; the rest rides on the same code).
- **followWayline × FULL × {any} × {VP, HR}**: 6 cells `t` (rotateYaw +
  followWayline shape asserted).
- **MO**: 3 cells `T` on the scope-specific shape; 0 on the
  method-specific gimbal/heading interaction.
- **NTL**: 1 cell `T` on the scope-specific shape; 0 on the method-specific
  interaction.

**Overall cell coverage**: ~7-9 of the 63 (heading × scope × method)
top-level cells assert on cell-specific emission. Including the
`None` capture inheritance row, ~12 of 189. **≈ 6-13%**.

The drone axis pushes the denominator to 945, but as noted above the
drone profile only affects two emission sites, so the *interesting*
matrix stays at ~190 cells and ~6-13% coverage.

---

## Findings

### [P0-1] No test exercises `MEASUREMENTS_ONLY × any heading × VIDEO_CAPTURE × HORIZONTAL_RANGE` — the historically broken cell

- **Severity**: P0 (the historical failing path per audit
  §12 of `docs/kmz-wpml-audit.md`; the worst-tested M4T combo per the
  brief's `Specific cells of interest` list)
- **Untested cell**: `MEASUREMENTS_ONLY × {smoothTransition, towardPOI,
  followWayline} × VIDEO_CAPTURE × HR`. The MO scope has 3 dedicated
  shape tests (`test_kmz_measurements_only_structure`, `..._anchors_at_wp1_when_takeoff_coord_set`,
  `..._uses_point_to_point_and_goto_first_waypoint`) but none of them set
  up an HR-shaped inspection, and the HR video coverage
  (`_make_hr_video_pass`, `TestDjiTurnDampingClamp::test_tight_hr_*`)
  only ever runs at scope=FULL (default — `_gen_kmz(fp, ..., 0, mission=mission)`
  omits the scope kwarg).
- **Code paths that fire only here**: in `_append_mission_config` the MO
  branch picks `auto_speed = mission.default_speed` (cruise), but in
  HR video the per-WP `wp.speed` is the measurement speed (typically
  1 m/s) which is lower than `default_speed`. The
  `_emitted_distance_duration` summation then uses `curr.speed or
  auto_speed` per leg — the resulting `wpml:duration` and the
  per-placemark `waypointSpeed` are at two different scales for the same
  WP. No test pins this.
- **Code paths that fire here AND are tested elsewhere**: the
  smoothTransition + body-tracks-target shape (well-tested at FULL), the
  continuity-curvature damping clamp (well-tested at FULL via
  `_make_tight_hr_video_pass`).
- **Why this is the worst-tested cell**: the MO scope is the in-air-
  handover workflow, where the drone is *already in flight* when the
  wayline starts. A misconfigured `wpml:waypointSpeed` or a mid-arc
  `nearest_leg=None` clamp regression here is invisible until the
  hardware refuses the file at takeoff. Per `agent-c4-degenerate.md`
  P0-1, this is also the cell where a null `wp.speed` falling through to
  `f"{0:g}"` is most likely (`_assemble_core` initializes per-WP
  speeds, but MO bypasses the bookend transit cluster and the
  measurement-speed inheritance for the in-air-handover entry is the
  least audited).
- **Concrete fixture to add**:
  ```python
  def test_mo_hr_video_smooth_transition_full_emission(self):
      fp, mission, _ = _make_hr_video_pass(num_measurements=6, with_bookends=True)
      # strip takeoff + landing (MO requires every WP airborne)
      fp.waypoints = [wp for wp in fp.waypoints if wp.waypoint_type not in {"TAKEOFF", "LANDING"}]
      for i, wp in enumerate(fp.waypoints, start=1):
          wp.sequence_order = i
      _, waylines = _read_wpmz(_gen_kmz(fp, "Test", 290.0, mission=mission, scope="MEASUREMENTS_ONLY"))
      # smoothTransition per-WP angle present on every measurement
      assert waylines.count("<wpml:waypointHeadingMode>smoothTransition</wpml:waypointHeadingMode>") >= 6
      # only m1 carries gimbalRotate (anchor); HR is anchor-only
      assert waylines.count("<wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc>") == 1
      # no zero-leg damping clamp issue
      for el in ET.fromstring(waylines).findall(".//wpml:waypointTurnDampingDist", _WPML_NS):
          assert 0 < float(el.text) <= 0.2
      # every placemark emits a positive waypointSpeed
      for el in ET.fromstring(waylines).findall(".//wpml:waypointSpeed", _WPML_NS):
          assert float(el.text) > 0
  ```
- **HW verify**: required — this is the historical failing path and the
  one most likely to surface a regression in production.

---

### [P1-1] `MEASUREMENTS_ONLY × any × any × HOVER_POINT_LOCK` is untested and consumes the C4 P1-3 undefined-bearing path

- **Severity**: P1 (undefined `_body_tracks_target` on a real production
  method)
- **Untested cell**: every (scope, capture, heading_mode) combination
  paired with `HOVER_POINT_LOCK`. `HOVER_POINT_LOCK` measurement
  waypoints sit on top of the LHA (zero standoff), so `wp.position ==
  wp.camera_target` byte-for-byte — `bearing_between` returns 0.0 and
  `_body_tracks_target` may classify any nonzero `wp.heading` as
  row-direction, falling through to followWayline + per-WP rotateYaw
  snap mid-hover. C4 P1-3 documents the predicate gap; no test fixture
  exists.
- **Code paths**: `heading._body_tracks_target` at the collocation case;
  `actions._append_action_group`'s `rotateYaw` emission gated on
  `_emits_followwayline_block(wp, mode) and aims and heading is not
  None`. For HPL specifically, the gimbal anchor + recording bookend
  shapes from `_insert_video_hover_waypoints` collocate at
  byte-for-byte; the export has no fixture asserting the per-WP block.
- **Why it's wrong**: the HOVER_POINT_LOCK / MEHT_CHECK methods are
  production methods (per the `METHOD_AGL_COMPAT` table in
  `enums.py`) — they ship today and operators schedule them. A yaw snap
  during a 5-second hover-on-LHA recording is a real cosmetic failure
  on the M4T (a 90° spin between video frames). No fixture catches it.
- **Concrete fixture to add**: a `_make_hover_point_lock_pass` fixture
  that builds a HPL inspection (`method="HOVER_POINT_LOCK"`,
  `capture_mode="VIDEO_CAPTURE"`) with a single MEASUREMENT collocated
  with its `camera_target`, then asserts the predicate result (per the
  C4 P1-3 fix proposal) and the emitted heading-param block.
- **HW verify**: required only after the C4 P1-3 fix lands; the test
  itself is fixture-only.

---

### [P1-2] `MEHT_CHECK` is untested at every cell

- **Severity**: P1 (real method, ships today, undocumented behavior)
- **Untested cell**: every (scope, heading_mode, capture_mode) cell
  paired with `MEHT_CHECK`. The `_body_tracks_target` docstring at
  `heading.py:38` explicitly mentions MEHT_CHECK as a body-tracks-target
  method, but no test exercises it.
- **Code paths**: same as HPL — collocated-or-near-collocated
  measurements with `camera_target = LHA center`. The MEHT (Minimum
  Eye Height for Threshold) check is a specific PAPI sub-procedure
  where the drone hovers at a known elevation and angle; the
  collocation shape is similar to HPL but the standoff is non-zero,
  so `_body_tracks_target` should fire correctly here. **Should**.
  No test confirms it.
- **Why it's wrong**: the entire MEHT path through the exporter is
  un-pinned. The first time a real MEHT mission is exported, *any*
  shape regression (e.g. someone tightens the body-tracks-target
  tolerance from 5° to 2°, MEHT silently flips to followWayline) is
  invisible.
- **Concrete fixture to add**: `_make_meht_check_pass` mirroring
  `_make_vp_video_pass` but with `method="MEHT_CHECK"` and the
  expected hover-near-LHA geometry. Smoke test on a single emission
  shape (smoothTransition + camera target framed).
- **HW verify**: not required for the fixture; the operator-facing
  MEHT procedure is its own verification path.

---

### [P1-3] `APPROACH_DESCENT` (ZEPHYR procedure e) is untested at every cell

- **Severity**: P1 (newly added method per the recent commit history,
  `feat: PAPI approach-descent inspection method (ZEPHYR procedure e)`
  #718, merged 2 commits ago)
- **Untested cell**: every (scope, heading_mode, capture_mode) cell
  paired with `APPROACH_DESCENT`. The method anchors on the runway
  touchpoint (not the LHA centre) and the
  `_apply_papi_glide_slope_terrain` helper rebuilds altitudes
  geometrically from the touchpoint — different anchor logic than HR /
  VP. No export test exercises this. The recent #718 PR landed the
  method + the trajectory pipeline coverage, but the export end-to-end
  has no fixture.
- **Code paths**: from the exporter's perspective the WP shape is
  similar to HR (body tracks LHA, gimbal pitch defined by the glide
  slope, measurements at constant standoff along a descending line).
  The smooth-turn predicates `_is_vp_video_measurement` and
  `_is_hr_video_measurement` check `cam.get("method") ==
  "VERTICAL_PROFILE"` / `"HORIZONTAL_RANGE"` — `APPROACH_DESCENT` is
  **neither**, so a video AD inspection emits *no* smooth-turn plan
  and reverts to per-WP gimbalRotate snap + stop turn mode. This is
  likely intentional (AD is closer to VP than HR), but it's also
  totally untested.
- **Why it's wrong**: an AD inspection in VIDEO_CAPTURE mode currently
  produces a halt-at-each-WP wayline that the operator was probably
  expecting to ride continuously (the trajectory is a descending
  straight line, similar to a VP climb shape). Whether that's a bug
  or by-design is undocumented and unpinned.
- **Concrete fixture to add**: `_make_approach_descent_pass` with
  `method="APPROACH_DESCENT"` and a descending measurement line.
  Assert the smooth-turn plan is *not* emitted (confirms the current
  by-design behavior) so any future expansion of the predicates to
  include AD is intentional.
- **HW verify**: required if AD is meant to smooth-turn in video mode.

---

### [P1-4] `FLY_OVER` and `PARALLEL_SIDE_SWEEP` (the row-direction methods) are untested at every cell

- **Severity**: P1 (real methods, ship today, with the row-direction
  fallback shape documented but un-pinned end-to-end)
- **Untested cell**: every (scope, heading_mode, capture_mode) cell
  paired with `FLY_OVER` or `PARALLEL_SIDE_SWEEP`. The docstring at
  `heading.py:38-42` explicitly calls these out as the
  *not*-body-tracks-target shape — `wp.heading` is the row direction
  (~90° off the bearing-to-LHA), so `_body_tracks_target` returns
  `False` and the export falls through to the followWayline block + a
  per-WP rotateYaw snap action. There IS a test
  (`test_smoothtransition_falls_back_to_followwayline_for_row_methods`)
  that asserts this fallback fires on a *generic* WP with `heading=0,
  camera_target due east`, but no test uses an actual FO or PSS
  fixture.
- **Code paths**: `heading._body_tracks_target` falsy branch, then
  `actions._emit_rotate_yaw = aims and heading is not None and
  _emits_followwayline_block(wp, "smoothTransition")` true branch, then
  rotateYaw emission. Generic test only covers the false branch — but
  PSS specifically applies a terrain delta (per the CLAUDE.md
  trajectory pipeline gotcha) and FO shifts measurements behind the
  LHA. The exporter has no fixture covering either method's actual WP
  shape.
- **Why it's wrong**: a regression in `_body_tracks_target` (e.g.
  someone widens the tolerance from 5° to 90°) silently flips FO/PSS
  to body-tracks-target — the body would smoothTransition toward each
  LHA along the row, breaking the row-camera framing. Generic
  fixture catches the math; a method-specific fixture catches the
  intent.
- **Concrete fixture to add**: `_make_fly_over_pass` (LHAs along a
  runway edge, `wp.heading` = along-row bearing, `camera_target` at
  each LHA position with `gimbal_pitch=-70°`). Assert per-WP heading
  block is followWayline + rotateYaw action fires.
- **HW verify**: not required.

---

### [P1-5] Multi-inspection KMZ exports beyond the 2× VP video case are untested

- **Severity**: P1 (real production: missions allow up to 10 inspections)
- **Untested cell**: every multi-inspection cell EXCEPT the
  `_stitch_two_vp_video_inspections` fixture (which covers only the
  `actionGroupId` collision and the segment-group ordering in 2× VP
  video). No test exercises:
  - VP + HR in one mission (mixed gimbal-handling: smooth sweep for VP,
    anchor-only for HR; the smooth-turn plan must reset per inspection).
  - HR + HR (does the per-inspection first-measurement anchor reset
    correctly between two HR arcs?).
  - VP + photo (does a video VP followed by a photo VP correctly reset
    the smooth-turn predicate per inspection?).
  - 3+ inspections (does the `actionGroupId` interleave streams stay
    unique with > 200 WPs as the existing test asserts, when the
    inspections themselves are heterogeneous?).
- **Code paths**: `_video_smooth_emit_plan` checks `prev.inspection_id
  == wp.inspection_id` and the predicate-equality to decide `is_first`,
  but the predicate-pair logic
  ```python
  if is_vp and _is_vp_video_measurement(prev, ...): prev_same = True
  elif is_hr and _is_hr_video_measurement(prev, ...): prev_same = True
  ```
  has an implicit "VP after HR resets the anchor" assumption that no
  test pins. A bug here would emit no anchor on the first measurement
  of the second inspection.
- **Why it's wrong**: a 5-inspection PAPI mission with HR + VP +
  photo-HR + video-VP + AD is the canonical real flight, and the
  exporter has zero coverage. Adding an inspection in production today
  is "ship and hope".
- **Concrete fixture to add**: `_stitch_hr_video_then_vp_video()` that
  combines `_make_hr_video_pass` and `_make_vp_video_pass` with offset
  sequence_order, then asserts each inspection's first measurement
  carries the gimbalRotate anchor and the per-inspection segment
  plans don't cross-contaminate.
- **HW verify**: required for any new multi-inspection shape that
  ships.

---

### [P1-6] `MEASUREMENTS_ONLY × towardPOI × any × any` is untested

- **Severity**: P1 (per the brief's specific cells of interest)
- **Untested cell**: `MEASUREMENTS_ONLY` scope crossed with
  `towardPOI` heading. The `test_explicit_toward_poi_mode_emits_per_placemark_poi`
  fixture runs at the default FULL scope; the MO scope-shape tests
  build their own minimal mission with `mission.inspections = []` and
  no `dji_heading_mode` set. No fixture combines the two.
- **Code paths**: the towardPOI POI-emission lives in
  `heading._append_heading_param`, which is scope-agnostic, AND the MO
  scope's `pointToPoint` flyToWaylineMode + the `takeOffRefPoint = WP1`
  override. Both fire on the same emission, but no fixture asserts they
  *coexist* without one perturbing the other (e.g. the
  `globalWaypointHeadingParam` mode at the template root is
  `followWayline`, which a strict consumer could read as "WP1's
  takeOffRefPoint heading is followWayline" — when the per-WP override
  flips to towardPOI mid-arc, does FH2 / Pilot 2 reconcile the two on
  an MO file? Untested).
- **Why it's wrong**: an operator who exports the same mission as
  FULL (planning view) and MEASUREMENTS_ONLY (in-air-handover view) at
  the same `dji_heading_mode=towardPOI` setting sees byte-different
  files; the exporter has no test asserting they agree on the per-WP
  heading shape.
- **Concrete fixture to add**: parametrize the existing
  `test_gimbal_aim_consistent_across_export_scopes` across the three
  heading modes — assert the per-placemark heading block is byte-stable
  on every scope.
- **HW verify**: required for in-air-handover workflow regressions.

---

### [P2-1] Scope × heading combinatorics never assert byte-identity on the heading shape

- **Severity**: P2 (regression-net gap)
- **Untested cell**: the existing 9 (scope, heading_mode) combinations
  are tested in isolation but no test asserts they emit byte-identical
  heading shapes for the same WP. The `test_non_aimed_placemark_byte_stable_across_modes`
  fixture pins this for *transit* placemarks but not for
  *measurement/hover* placemarks across scopes.
- **Code paths**: `_append_heading_param` is called from
  `_append_placemark`, which is called from both `_build_dji_template_kml`
  and `_build_dji_waylines_wpml` in every scope. The scope branch in
  `_append_mission_config` runs *before* the placemark loop and never
  touches per-WP heading.
- **Why it's wrong**: future refactors could couple scope and heading
  emission (e.g. for the airborne scopes, suppress the per-WP heading
  override and rely on the global followWayline — a plausible
  simplification that would break body-tracks-target framing on every
  airborne MO/NTL export). No regression net.
- **Concrete fixture to add**: a parametrized fixture that builds a
  fixed body-tracks-target measurement, exports it 9 times (3 scopes ×
  3 modes), and asserts the per-WP `<wpml:waypointHeadingParam>` block
  is byte-identical across scopes (within each mode).
- **HW verify**: not required.

---

### [P2-2] `NO_TAKEOFF_LANDING × fixed × PHOTO_CAPTURE × any` and the bookend variants

- **Severity**: P2 (the brief's `NO_TAKEOFF_LANDING × fixed × PHOTO_CAPTURE
  × any` specific cell)
- **Untested cell**: NTL scope with explicit photo capture. The
  `test_kmz_no_takeoff_landing_uses_point_to_point_and_goto_first_waypoint`
  test exercises the NTL scope shape but with `_make_flight_plan(3)` —
  no inspection / camera_action / measurement geometry. The
  `flyToWaylineMode=pointToPoint` + `finishAction=gotoFirstWaypoint` is
  asserted; nothing about the per-WP photo capture or the missing-
  takeoff/landing bookend behavior is asserted.
- **Code paths**: NTL adds at-transit-altitude TRANSIT bookends but
  no ground TAKEOFF/LANDING. The `_assemble_core` MH-boundary
  walk produces these transits with `camera_action=NONE`, but a photo
  measurement's `camera_action=PHOTO_CAPTURE` produces a
  reachPoint actionGroup with `takePhoto`. The NTL bookend behavior
  with a photo-capture inspection downstream is unpinned.
- **Why it's wrong**: an operator who plans a photo PAPI mission and
  exports as NTL (operator hand-launches, runs the photo capture, the
  drone parks above WP1, operator lands manually) gets a wayline whose
  in-air-handover entry transitions directly into a PHOTO_CAPTURE
  action. The exporter has no fixture asserting the action group fires
  on the first measurement after the entry bookend.
- **Concrete fixture to add**: an NTL-scope export with one PAPI photo
  inspection, asserting (a) `flyToWaylineMode=pointToPoint`, (b) the
  first PHOTO_CAPTURE reachPoint actionGroup references the correct
  zero-indexed wpml:index, (c) no goHome at finish.
- **HW verify**: required for the in-air-handover workflow.

---

### [P2-3] `capture_mode = None` (mission inherits from mission default OR the trajectory pipeline default) coverage is split

- **Severity**: P2 (gap visible only on the inheritance precedence)
- **Untested cell**: there are two tests
  (`test_vp_video_inherits_capture_mode_from_mission_default` and
  `test_vp_video_falls_back_to_video_when_no_default_anywhere`) that
  pin the VP+None inheritance, and one for HR (`test_hr_video_inherits_capture_mode_from_mission_default`).
  No test covers:
  - `MEHT_CHECK` with `capture_mode=None` (per the CLAUDE.md gotcha,
    the predicate treats None as VIDEO_CAPTURE — does this even apply to
    MEHT? Untested).
  - `APPROACH_DESCENT` with `capture_mode=None`.
  - `FLY_OVER` / `PARALLEL_SIDE_SWEEP` with `capture_mode=None` — these
    methods are non-video by design (row direction, gimbal frames each
    LHA at a snap), so what's the no-op behavior?
  - `HOVER_POINT_LOCK` with `capture_mode=None`.
- **Code paths**: `_resolve_inspection_camera_settings` fills in
  `mission.default_capture_mode` then the predicate
  `_is_vp_video_measurement` / `_is_hr_video_measurement` defaults
  capture_mode to VIDEO_CAPTURE if still null. For non-video-aware
  methods (FO/PSS/HPL/MEHT/AD), the predicates return False and the
  WP emits the standard per-WP snap — but the inheritance chain still
  runs and a bug there would silently flip a non-video method's
  resolved `cam.method` field, which downstream callers of
  `inspection_camera` could read.
- **Why it's wrong**: the predicate `_is_vp_video_measurement` /
  `_is_hr_video_measurement` *gate* on method, but the
  `_resolve_inspection_camera_settings` resolver is method-agnostic and
  fills in the cam dict for every inspection. Tests assume the gate
  works; no test confirms the gate works when the inspection method
  is *not* one of the smooth-turn methods.
- **Concrete fixture to add**: parametrize the inheritance test across
  every `InspectionMethod` value, asserting the smooth-turn plan is
  empty for non-VP, non-HR methods regardless of capture_mode.
- **HW verify**: not required.

---

## Upgrades (P3)

### [P3-1] No fixture exercises `len(waypoints) == 1`

- The `test_empty_waypoints_produces_valid_archive` test covers
  `len == 0`, but not `len == 1`. A single-WP mission is the
  HOVER_POINT_LOCK MO export edge case (per C4 P2-2). The
  `_emitted_distance_duration` returns `(0, 0)` for `len < 2`, and
  Pilot 2 may refuse the wayline at this shape. No regression net.

### [P3-2] No fixture exercises `mission.default_speed = None` end-to-end through KMZ

- The litchi tests cover this (`test_speed_falls_back_to_default_speed`),
  but no DJI KMZ test asserts the per-WP `waypointSpeed` emission when
  the per-WP `wp.speed` and the mission default are both null /
  zero. Per C4 P0-1, this is the worst-case `waypointSpeed=0` cell.

### [P3-3] No fixture combines drone profile axis with capture / method axes

- The drone parametrize test (`test_dji_enums_resolve_per_configured_drone`)
  only swaps the drone profile on a default `_make_flight_plan(1)` —
  no inspection, no method, no scope. A bug where the M300 RTK enum
  somehow interacts with the smooth-turn predicate (it doesn't today
  — the predicate is drone-agnostic) would be invisible. Adding one
  end-to-end fixture per supported drone (with a VP video pass) closes
  this gap.

### [P3-4] No fixture exercises the `dji_heading_mode_override` per-export kwarg

- The mission-level `dji_heading_mode` column is tested, but the
  `export_mission(..., dji_heading_mode_override=...)` parameter
  (per the CLAUDE.md "per-export override + persistence write-back"
  gotcha) is not. The write-back side effect (`mission.dji_heading_mode
  := override`) is the most fragile path because it sits inside the
  flush window of a service that otherwise reads from `mission`.

---

## Cross-cutting observations (no severity)

- **The "specific cells of interest" in the brief are all genuinely
  untested.** Cross-referencing:
  - `MEASUREMENTS_ONLY × towardPOI × VIDEO_CAPTURE × HR` — D2 P0-1
    (subsumed by the broader MO×HR gap).
  - `NO_TAKEOFF_LANDING × fixed × PHOTO_CAPTURE × any` — D2 P2-2.
  - `MEASUREMENTS_ONLY × any × any × HOVER_POINT_LOCK` — D2 P1-1.
  - `FULL × smoothTransition × VIDEO_CAPTURE × VP` — `T` (this is
    well-tested; the brief's "current default" is the most-covered
    cell).
  - Multi-inspection > 1 — D2 P1-5.

- **The error / clamp paths the brief calls out**:
  - **Below-takeoff clamp (B2-P0-3)** — pinned at FULL, NTL, and MO
    via `TestDjiBelowTakeoffClamp` (3 tests). Pinned with method-
    less geometry; not pinned per-method.
  - **`waypointTurnDampingDist` clamp under `nearest_leg`** — C2 P1-1
    flags the `nearest_leg=None` fall-through. The existing
    `TestDjiTurnDampingClamp` tests pin the `nearest_leg > 0` case
    but not the all-zero-legs case.
  - **`waypointSpeed=0`** — C4 P0-1's escalating finding has no test
    coverage anywhere in the suite.

- **Capture-mode = None path** — partially covered for VP and HR (two
  tests each), but not for any other method. The predicate gate is
  the safety net, and the gate is method-aware, so the non-tested
  cells are *almost certainly* fine — but "almost certainly" is the
  state every regression-net audit is designed to eliminate.

- **The test suite's structure mirrors the export code's structure.**
  `TestGenerateKmz`, `TestDjiZeroIndexedReferences`, `TestDjiUseGlobalFlags`,
  `TestDjiBelowTakeoffClamp`, `TestDjiSpecConformance`,
  `TestDjiActionGroupIdRange`, `TestDjiTurnDampingClamp`,
  `TestDjiRelativeHeightExport` — each pins one code-level invariant
  but none covers the *matrix*. A `TestDjiMatrixCoverage` class
  exercising every (heading, scope, method, capture) combination
  with a smoke-shape assertion (placemark count, action-group
  count, no negative heights, all positive speeds) would close the
  bulk of the gap in one fixture set.
