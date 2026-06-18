# TarmacView — Domain & UI Specification Reference

**Purpose:** Condensed reference for anyone implementing features. Contains the domain model, enum values, trajectory formulas, UI page specs, and status rules. Read this before implementing any issue.

---

## Domain Model (22 tables)

### Airport Infrastructure

**airport** — icao_code (VARCHAR 4, unique), name, elevation, location (PointZ 4326), terrain_source (TerrainSource enum, default FLAT), dem_file_path (nullable, local geotiff backing DEM elevation lookups)

**airfield_surface** — airport_id (FK), identifier (VARCHAR 10), surface_type (RUNWAY|TAXIWAY discriminator), geometry (LineStringZ 4326, derived centerline), boundary (PolygonZ 4326, nullable, the actual drawn polygon - source of truth for rendering), buffer_distance (Float, default `DEFAULT_BUFFER_DISTANCE_M` = 5.0 m, the no-go ring honored by both the planner and the 2D/3D renderer), paired_surface_id (UUID, nullable, opt-in self-FK to the reciprocal RUNWAY direction with `ON DELETE SET NULL`; partial unique index keeps the link symmetric), heading / length / width (Float, nullable, populated for both types). RUNWAY adds: threshold_position (PointZ), end_position (PointZ). Single-table inheritance.

TAXIWAY heading is server-derived when not explicitly provided: `create_surface` fills a missing heading from the centerline first→last bearing, and `update_surface` re-derives it when `geometry` changes without an explicit `heading` in the same payload — an explicit heading always wins, and RUNWAY behavior is unchanged. Migration `0014_taxiway_heading_backfill` filled pre-existing NULL-heading taxiway rows the same way; degenerate centerlines (<2 points) stay NULL.

When two RUNWAY surfaces are paired, the service layer enforces reciprocal geometry (centerline reversed, threshold/end swapped, heading within ±5° of opposite, equal length/width/buffer/boundary), propagates geometry edits across the pair, recomputes `agl.distance_from_threshold` on both sides after threshold/end edits, rejects identifier rename while coupled, and cascades DELETE through to the partner and its AGLs. The trajectory pipeline still sees two surfaces — pair-link is configuration metadata, not a planner construct.

**obstacle** — airport_id (FK), name, position (PointZ 4326), height, radius, geometry (PolygonZ 4326), buffer_distance (Float, default `DEFAULT_BUFFER_DISTANCE_M` = 5.0 m), type (ObstacleType enum)

**safety_zone** — airport_id (FK), name, type (SafetyZoneType enum), geometry (PolygonZ 4326), altitude_floor, altitude_ceiling, is_active

### AGL / PAPI Lighting

**agl** — surface_id (FK), agl_type (VARCHAR 30), name, position (PointZ 4326), side (VARCHAR 10), glide_slope_angle, distance_from_threshold, offset_from_centerline

**lha** (Light Housing Assembly) — agl_id (FK), unit_designator, sequence_number (Integer, dense 1..N within parent AGL), setting_angle, transition_sector_width, lamp_type (LampType enum), position (PointZ 4326), tolerance, lens_height_msl_m / lens_height_agl_m (Float, nullable, PAPI-only — surveyed PAPI lens optics height; MSL is the raw absolute altitude, AGL is MSL minus DEM terrain and stays null on a flat airport; migration `0010_lha_lens_height` adds both). `UNIQUE (agl_id, sequence_number)` and `CHECK (sequence_number > 0)`. For PAPI parents `unit_designator` is a presentation of `sequence_number` (1=A, 2=B, 3=C, 4=D — closest-to-runway is D=seq 4); for non-PAPI it is freeform text.

### Inspection Templates

**inspection_template** — name, description, default_config_id (FK → inspection_configuration), angular_tolerances, created_by, created_at

**insp_template_targets** — template_id (FK), agl_id (FK). Junction table.

**insp_template_methods** — template_id (FK), method (VARCHAR 30). Junction table.

**inspection_configuration** — altitude_offset, measurement_speed_override, measurement_density (INTEGER), custom_tolerances, density, hover_duration, horizontal_distance, sweep_angle, angle_source (VARCHAR 10, nullable, default `'CUSTOM'` — `'PAPI'` resolves the VP climb bookends from `setting_angles` ± offsets at compile; `'CUSTOM'` uses `angle_start` / `angle_end` directly), angle_start / angle_end (Float, nullable, the VP climb bookends in degrees, both clamped to `[1.0°, 16.5°]`; null falls back to legacy `1.9°` / `6.5°`), angle_offset_above / angle_offset_below (Float, nullable, PAPI-mode offsets added above `max(setting_angles)` and subtracted below `min(setting_angles)` for the VP climb top/start; `angle_offset_above` also drives the HORIZONTAL_RANGE arc-side angle), descent_start_distance (Float, nullable, APPROACH_DESCENT only — meters back of the runway touchpoint where the descent begins; null falls back to `DEFAULT_DESCENT_START_DISTANCE = 1000 m`), descent_glide_slope_override (Float, nullable, APPROACH_DESCENT only — operator-pinned descent angle in degrees that overrides the PAPI-derived glide slope; null uses the resolved PAPI angle), scan_surface_id (UUID FK → airfield_surface, ON DELETE SET NULL, SURFACE_SCAN only — the target surface; SURFACE_SCAN is AGL-agnostic and targets a surface, not an LHA), scan_length_mode (VARCHAR 20, nullable, `FULL | MAX_LENGTH | INTERVAL` — FULL scans the whole surface, MAX_LENGTH caps the far end at `scan_length_to`, INTERVAL trims both ends), scan_length_from / scan_length_to (Float, nullable — along-track window in meters measured from the surface origin; INTERVAL with `from >= to` is rejected at the schema boundary with 422), scan_width (Float, nullable — perpendicular band width in meters; null = full surface width centered on the centerline), scan_width_side (VARCHAR 10, nullable, `LEFT | RIGHT` — which side of the axis a narrowed band sits on), scan_height (Float, nullable — commanded AGL of the pass; null falls back to `DEFAULT_SURFACE_SCAN_HEIGHT = 10 m`), scan_run_count (Integer, nullable, ≥ 1 — number of serpentine runs; null auto-derives from the FOV footprint and sidelap), scan_run_orientation (VARCHAR 20, nullable, `LENGTH_WISE | WIDTH_WISE` — runs laid parallel to or across the axis), scan_sidelap_percent (Float, nullable, 0–80 — overlap between adjacent runs; null falls back to `DEFAULT_SURFACE_SCAN_SIDELAP_PERCENT = 20`), scan_frontlap_percent (Float, nullable, 0–80 — forward overlap between consecutive photos along each run; null falls back to `DEFAULT_SURFACE_SCAN_FRONTLAP_PERCENT = 0`, which reproduces the legacy footprint-spaced tiling). SURFACE_SCAN also reuses the existing `camera_gimbal_angle`, `capture_mode`, `measurement_speed_override`, `direction`, and `altitude_offset` columns. (CHECK constraints on the three scan enum columns + the FK are added by migration `0015_surface_scan_config`; the additive nullable `scan_frontlap_percent` column lands in `0016_surface_scan_frontlap`.) lha_ids (JSONB — array of UUID), lha_selection_rules (JSONB, NOT NULL, default `{}` — per-AGL helper rule keyed by `agl_id`; resolved at write time into the canonical `lha_ids` list above. Empty `{}` means "no rule recorded; treat as CUSTOM".)

### Mission & Inspection

**mission** — name, status (MissionStatus enum), created_at, updated_at, operator_notes, drone_profile_id (FK), date_time, default_speed, measurement_speed_override, default_altitude_offset, takeoff_coordinate (PointZ 4326), landing_coordinate (PointZ 4326), dji_heading_mode (`'smoothTransition' | 'towardPOI' | 'followWayline'`, default `'smoothTransition'` — operator's last-used per-export preference; only consumed by KMZ/WPML generators, NOT in TRAJECTORY_FIELDS so flipping it never regresses status), keep_inside_airport_boundary (Boolean, NOT NULL, default `true` - biases the A* transit pathfinder to stay inside the airport-boundary polygon and gates the boundary-egress safety warning; in TRAJECTORY_FIELDS so toggling regresses to DRAFT), constraints (via constraint_rule)

**drone_profile** — name, manufacturer, model, max_speed, max_climb_rate, max_altitude, battery_capacity, endurance_minutes, camera_resolution, camera_frame_rate (INTEGER), sensor_fov, weight

**inspection** — mission_id (FK), template_id (FK), config_id (FK → inspection_configuration), method (VARCHAR 30), sequence_order, lha_ids (JSONB — array of UUID, denormalized from config for quick access)

### Flight Plan & Output

**flight_plan** — mission_id (FK, unique), airport_id (FK), total_distance, estimated_duration, is_validated, generated_at

**waypoint** — flight_plan_id (FK), inspection_id (FK nullable), sequence_order, position (PointZ 4326), heading, speed, hover_duration, camera_action (CameraAction enum), waypoint_type (WaypointType enum), camera_target (PointZ 4326), gimbal_pitch, agl (nullable, rendering-only height above sampled ground), camera_target_agl (nullable, rendering-only)

**validation_result** — flight_plan_id (FK, unique), passed, validated_at

**validation_violation** — validation_result_id (FK), constraint_id (FK, ON DELETE SET NULL), category (violation/warning/suggestion, CHECK-constrained), message, waypoint_ids (JSONB nullable), violation_kind (nullable — structured kind set at emission, e.g. `surface_crossing` / `battery`; null on legacy rows persisted before #525, classified from `message` via the schema fallback). `is_warning` is a backwards-compat computed property (`category != "violation"`), not a column.

**export_result** — flight_plan_id (FK), file_name, format (ExportFormat enum), file_path, exported_at

**constraint_rule** — mission_id (FK, ON DELETE CASCADE), name, constraint_type (discriminator), is_hard_constraint. Subtypes: AltitudeConstraint (min/max_altitude), SpeedConstraint (max_horizontal/vertical_speed), BatteryConstraint (max_flight_time, reserve_margin), RunwayBufferConstraint (lateral/longitudinal_buffer), GeofenceConstraint (boundary PolygonZ 4326). Single-table inheritance. Operator-attached: rules survive flight-plan regeneration because ownership is on mission, not flight_plan.

### Media Return (field hub)

**drone_media_file** — one uploaded original, either hub-reported (`POST /api/v1/field-link/media-events`, shared-secret auth — see `docs/specs/FIELD-HUB.md` §4.3) or a manual per-inspection upload from the operator dialog. object_key, fingerprint (nullable — the hub idempotency key, a repost returns the existing row; null for manual uploads, so uniqueness is a **partial** unique index `uq_drone_media_file_fingerprint WHERE fingerprint IS NOT NULL` rather than a column UNIQUE), origin (MediaOrigin enum, CHECK-constrained, default `HUB`; `MANUAL` for dialog uploads), filename (upload-listing name), size_bytes (BigInteger), captured_at (device-reported capture time, never server receive time), capture_position (PointZ 4326, nullable), device_sn (indexed), mission_id (FK → mission, nullable, ON DELETE SET NULL, indexed — null while unmatched; set by mission matching or manual assignment), inspection_id (FK → inspection, nullable, ON DELETE SET NULL, indexed — attaches the file to one inspection in the upload form), order_index (Integer, dense 1..N within the parent inspection; both inspection_id and order_index are null until attached and set together — paired-null CHECK `ck_drone_media_file_order_inspection`, `order_index > 0` CHECK, `UNIQUE (inspection_id, order_index)`), status (MediaFileStatus enum, CHECK-constrained; hub rows arrive as `RECEIVED` and matching moves them to `MATCHED` / `UNASSIGNED`, manual rows arrive as `MATCHED`, ingest confirm to `INGESTED`), raw_callback (JSONB — hub callback payload verbatim), received_at (server default now()), updated_at (onupdate now() — the matching/reassignment audit trail). Migrations `0011_drone_media_file`, `0013_drone_media_updated_at`, `0016_drone_media_per_inspection`.

### Mission Dispatch (field hub)

**wayline_dispatch** — one mission's wayline in the field hub's route library (`POST /api/v1/missions/{mission_id}/dispatch` — see `docs/specs/FIELD-HUB.md` §4.2). mission_id (FK → mission, ON DELETE CASCADE, unique — a re-dispatch updates the existing row in place), wayline_id (UUID, the wayline uuid presented to DJI Pilot 2's route list; stable across re-dispatches so Pilot sees an updated route instead of a duplicate), device_sn (VARCHAR, nullable — null until a flight execution binds one; flight-task progress events aren't persisted yet, so media matching treats it as optional), status (VARCHAR 20, `DISPATCHED` today; flight-task tracking values land when progress events are persisted), dispatched_at (server default now(), bumped on re-dispatch). Migration `0012_wayline_dispatch`.

### Measurement (video processing)

The verification half of the plan→fly→measure loop: scores an inspection's flown PAPI footage against the snapshotted `LHA` ground truth, run by the Celery video-processing engine. Design: `docs/specs/TARMACVIEW-MERGE-PLAN.md` §6/§7.2/§8. The persistence-agnostic domain aggregate lives in `app/domain/measurement/` behind a `MeasurementRepository` port; the SQLAlchemy adapter in `app/infra/measurement/` is the only place ORM meets domain.

**measurement** — one inspection's measurement run. inspection_id (FK → inspection, ON DELETE CASCADE, indexed), status (MeasurementStatus enum, CHECK generated from the enum via `enum_check_values`), label (String, nullable — operator-supplied free-text run name; a blank/whitespace value clears it back to the inspection-label fallback `Inspection N · Method`), runway_heading (Float, nullable — parent runway heading for the horizontal-angle calc), reference_points (JSONB, default `[]` — the snapshotted LHA ground truth: light name, position, setting_angle, tolerance captured at create time; an audit record, NOT a live join, so a later LHA edit can't change a finished run's pass/fail), light_boxes (JSONB, default `[]` — confirmed first-frame light boxes in percentage coords; operator-confirmed on the manual `AWAITING_CONFIRM` path, detector-confirmed when a confident detection auto-confirms), summaries (JSONB, default `[]` — per-light PASS/FAIL rollup vs `setting_angle ± tolerance`), media_object_keys (JSONB, default `[]` — ordered input video object keys pulled from the inspection's media), first_frame_object_key (String, nullable — pointer to the extracted first-frame image in object storage), object_key (String, nullable — pointer to the gzipped per-frame results json; the heavy blob never lands in Postgres), annotated_video_keys (JSONB, default `{}` — annotated output videos keyed by light name + enhanced/combined), error_message (Text, nullable — set only on ERROR), created_at / updated_at (onupdate now()). Migration `0018_measurement` (**T3**); the additive nullable `label` column lands in `0019_measurement_label`. The PAPI light slots are `PAPI_A`..`PAPI_D` left-to-right.

A run is deletable and renamable from the Results list and the results page: `DELETE /api/v1/measurements/{id}` drops the aggregate and its object-storage artifacts (the gzipped results blob, the first frame, every annotated video) best-effort after commit; `PATCH /api/v1/measurements/{id}` sets/clears `label`.

---

## Enum Values

| Enum | Values |
|------|--------|
| MissionStatus | DRAFT, PLANNED, VALIDATED, EXPORTED, MEASURED, COMPLETED, CANCELLED |
| WaypointType | TAKEOFF, TRANSIT, MEASUREMENT, HOVER, LANDING |
| CameraAction | NONE, PHOTO_CAPTURE, RECORDING_START, RECORDING_STOP |
| ExportFormat | MAVLINK, KML, KMZ, JSON |
| InspectionMethod | VERTICAL_PROFILE, HORIZONTAL_RANGE, APPROACH_DESCENT, FLY_OVER, PARALLEL_SIDE_SWEEP, HOVER_POINT_LOCK, MEHT_CHECK, SURFACE_SCAN |
| ScanLengthMode | FULL, MAX_LENGTH, INTERVAL |
| ScanWidthSide | LEFT, RIGHT |
| ScanRunOrientation | LENGTH_WISE, WIDTH_WISE |
| SafetyZoneType | CTR, RESTRICTED, PROHIBITED, TEMPORARY_NO_FLY |
| ObstacleType | BUILDING, TOWER, ANTENNA, VEGETATION, OTHER |
| TerrainSource | FLAT, DEM_UPLOAD, DEM_API, DEM_SRTM |
| LampType | HALOGEN, LED |
| PAPISide | LEFT, RIGHT |
| LhaSelectionMode | ALL, RANGE, FROM_THRESHOLD, CUSTOM |
| ThresholdAnchor | START, END |
| MediaFileStatus | RECEIVED, MATCHED, UNASSIGNED, INGESTED |
| MediaOrigin | HUB, MANUAL |
| MeasurementStatus | QUEUED, FIRST_FRAME, AWAITING_CONFIRM, PROCESSING, DONE, ERROR |

---

## Mission Status State Machine

```
DRAFT → PLANNED → VALIDATED → EXPORTED → MEASURED → COMPLETED
                       │          │          │     → CANCELLED
                       └──────────┴→ MEASURED ┘
        (VALIDATED and EXPORTED both jump to MEASURED on measurement kickoff;
         VALIDATED → MEASURED skips EXPORTED)
```

**Transitions:**
- DRAFT → PLANNED: automatic after trajectory generation succeeds
- PLANNED → VALIDATED: operator clicks Accept
- VALIDATED → EXPORTED: operator triggers export
- VALIDATED → MEASURED: measurement kickoff on a never-exported mission (skips EXPORTED)
- EXPORTED → MEASURED: measurement kickoff after export
- MEASURED → COMPLETED: operator marks mission done
- MEASURED → CANCELLED: operator abandons mission

**MEASURED trigger:** the transition fires on *measurement kickoff* — the moment a mission's first measurement run is created (`measurement_service.create_measurement` calls `Mission.mark_measured()` before the flush). It is idempotent: a multi-inspection mission hits create more than once and only the first call (while still VALIDATED/EXPORTED) transitions; later calls no-op. MEASURED is intentionally NOT in `TERMINAL_STATUSES` or `POST_PLAN_STATUSES` — it lives only in the state machine, so it is reachable but does not change any status-set gate.

**Regression rules:**
- Any waypoint edit (move, add, delete) → status regresses to PLANNED
- Config change affecting trajectory (drone, framerate-related) → regresses to PLANNED
- Config change NOT affecting geometry → validate only, no regression
- Adding/removing inspections → regresses to DRAFT (trajectory is invalid)
- Changing drone profile → regresses to PLANNED (inspections still valid, trajectory needs regeneration)

**Modification rules:**
- DRAFT, PLANNED, VALIDATED, EXPORTED: inspections can be added/removed/reordered and the drone profile changed; the edit auto-regresses to DRAFT/PLANNED as above
- MEASURED: edit-locked. `Mission.invalidate_trajectory()` raises (services map `ValueError → DomainError(409)`), so add/remove inspection, drone swap, and trajectory-affecting config changes are all rejected. The footage was already scored against the planned LHA ground truth, so editing the plan afterward would orphan the measurement. The same lock covers the bulk path: the airport altitude renormalize (fired by a DEM upload / terrain-source change / DEM delete) skips MEASURED missions instead of rewriting their takeoff/landing coordinates, recording each skipped id in its return value rather than raising a 409 - a bulk terrain side-effect should not block the whole sweep for one locked mission. Only COMPLETED / CANCELLED stay reachable; the mission is still deletable.
- COMPLETED, CANCELLED: terminal states — no modifications allowed, user must duplicate the mission

**Duplication:**
- Duplicated missions always start in DRAFT status regardless of the original's status

**Status gating:**
- Export button: disabled until VALIDATED
- Complete/Cancel buttons: enabled once MEASURED - a mission must be measured before it can be completed or cancelled
- COMPLETED and CANCELLED are terminal states — no further actions

---

## Measurement Status State Machine

A measurement run (the video-processing aggregate, separate from the mission) drives the two-step operator flow:

```
QUEUED → FIRST_FRAME → AWAITING_CONFIRM → PROCESSING → DONE
                   └──── confident auto-confirm ────┘
   ↘          ↘              ↘                ↘
                          ERROR  (reachable from any non-terminal state)
```

- QUEUED → FIRST_FRAME: the worker extracts the first frame and detects/pre-places PAPI boxes
- FIRST_FRAME → AWAITING_CONFIRM: an uncertain detection (fallback / default positions) parks for operator confirmation
- FIRST_FRAME → PROCESSING: a confident detection (a coherent line of all four PAPI lights) auto-confirms, skips the manual gate, and the worker chains full processing
- AWAITING_CONFIRM → PROCESSING: operator confirms/adjusts boxes (`POST /measurements/{id}/confirm-lights`)
- PROCESSING → DONE: the worker runs the two-pass engine, writes the gzipped results + annotated videos to object storage, and rolls up per-light PASS/FAIL
- PROCESSING → ERROR (fail-loud guard): a video with no per-frame GPS telemetry, or one that yields zero measurable frames, routes to ERROR instead of finishing DONE with empty results - the per-frame drone position is required to measure transition angles. DJI footage carries that telemetry either as a `.SRT` sidecar or, on M4-era drones, an embedded subtitle track inside the mp4
- any non-terminal state → ERROR on engine/worker failure, recording `error_message`
- DONE and ERROR are terminal

`status` doubles as the progress phase the polling endpoint reports. The aggregate's `transition_to()` is the only legal way to advance — direct assignment bypasses validation. See `docs/specs/TARMACVIEW-MERGE-PLAN.md` §6.

---

## Trajectory Generation Algorithm (5 phases)

### Phase 1 — Load mission data
Load airport infrastructure, drone profile, resolve inspection configs (mergedefaults with operator overrides via `resolveWithDefaults()`).

### Phase 2 — Inspection loop
Iterate inspections by `sequenceOrder`. For each: resolve config, check `isSpeedCompatibleWithFrameRate()`, compute LHA center point (centroid of selected LHA positions).

### Phase 3 — Waypoint computation

**ANGULAR_SWEEP:**
```
xi = xc + r · sin(θi)
yi = yc + r · cos(θi)
```
Arc centered on LHA center point. Radius ≥ 350m. Sweep ±10° from extended centerline. Waypoints at angular steps: Δθ = 2α/n (n = measurement density). Constant altitude at glide slope.

**VERTICAL_PROFILE:**
```
hi = d · tan(φi)
```
Fixed horizontal distance d from LHA center. Climb bookended by `angle_start` → `angle_end` (resolved from `inspection_configuration.angle_source`: PAPI mode = `min(setting_angles) - angle_offset_below` → `max(setting_angles) + angle_offset_above`; CUSTOM mode = operator-supplied `angle_start` / `angle_end` with legacy `1.9°` / `6.5°` fallback when null). Both modes clamp into the Zephyr envelope `[MIN_VERTICAL_PROFILE_ANGLE_DEG, MAX_VERTICAL_PROFILE_ANGLE_DEG] = [1.0°, 16.5°]`. Waypoints at altitude steps by measurement density.

**APPROACH_DESCENT** (ZEPHYR procedure e — pilot's-eye final approach):
```
remaining_i = D · (1 - i / (n - 1))
alt_i       = touchpoint.alt + remaining_i · tan(α)
```
On-axis descent down the runway centerline. Starts `descent_start_distance` D (default `DEFAULT_DESCENT_START_DISTANCE = 1000 m`) back of the runway touchpoint along the approach axis, descends at angle α (`descent_glide_slope_override` if set, else the PAPI-derived glide slope), and terminates at the runway touchpoint (`alt = touchpoint.alt` at the last waypoint). Camera framed on the LHA center; the runway surface must have a complete touchpoint (`touchpoint_latitude` / `touchpoint_longitude` / `touchpoint_altitude` all set) or compile raises `TrajectoryGenerationError`. Counted as a PAPI method for terrain handling — terrain post-processing reuses `_apply_papi_glide_slope_terrain` anchored on the touchpoint (not the LHA), so commanded elevation angle survives terrain undulation.

**SURFACE_SCAN** (ground pavement-quality scan — AGL-agnostic, targets an `AirfieldSurface` not an LHA):
```
footprint      = 2 · (h / cos θ) · tan(HFOV / 2),  θ = 90° + gimbal
runs_auto      = ceil(W / (footprint · (1 − sidelap)))
along_spacing  = footprint · (1 − frontlap)
```
One serpentine (boustrophedon) pass that sweeps the surface at low altitude (`scan_height`, default 10 m) with a forward-tilted gimbal (default −70°) to image pavement. The scan **axis** is `surface.heading` when set, else the centerline first→last bearing (a reciprocal heading walks the centerline reversed — a no-op for runways). `scan_length_mode` resolves the along-track window (FULL / MAX_LENGTH / INTERVAL); `scan_width` + `scan_width_side` narrow the perpendicular band (null = full width centered on the centerline). The run count is `scan_run_count` when pinned, else `runs_auto` from the drone's `sensor_fov` footprint and `scan_sidelap_percent`; a single full-width run flies the centerline. `scan_run_orientation` lays runs parallel to the axis (`LENGTH_WISE`) or across it (`WIDTH_WISE`). Each run is centered in its strip, alternating direction; every waypoint is trailed back along its run by the fly-over offset `h · tan(90° + gimbal)` so the forward-tilted camera frames the intended strip. VIDEO mode keeps run endpoints + recording bookends; PHOTO mode tiles `PHOTO_CAPTURE` along each run at `along_spacing` (`footprint · (1 − scan_frontlap_percent)`; 0% frontlap reproduces the original footprint forward-spacing). The camera frame-rate / speed compatibility check reads the same `along_spacing` so a high-frontlap PHOTO scan is never flown too fast to capture every frame. Altitude follows terrain (PARALLEL_SIDE_SWEEP-style delta) so commanded AGL holds. One inspection = one pass (no inter-pass A* between runs). Compile raises `TrajectoryGenerationError` when `scan_surface_id` is unset, when the surface has no usable centerline, or when the run count must be auto-derived but `sensor_fov` is missing; a suboptimal run-count override emits a suggestion.

### Phase 4 — Validation
Check each waypoint against all constraints. Shapely `contains` for geofence (in WGS84 degree space, mirroring the prior `ST_Force2D(ST_Contains(...))`); per-waypoint `LocalProjection` distance-in-meters check for runway buffer (mirroring the prior `::geography` cast). Hard failure → terminate. Soft violation → add warning.

#### Safety-semantics stance

These six known cases were audited explicitly. Each has a recorded stance so reviewers know what the engine does *not* stop, and why that is acceptable:

1. **Airport-boundary egress is soft-only and toggle-gated** (`safety_validator._batch_check_boundary_zones`, `check_safety_zone`). Boundary-aware A* routing has landed: the per-mission `keep_inside_airport_boundary` flag biases the transit pathfinder to stay inside the boundary polygon (a per-meter outside-of-boundary edge penalty) and gates this warning. When the flag is on, transit / takeoff / landing waypoints that still sit outside the polygon emit a soft warning; measurement and hover waypoints are always exempt (inspections inherently sit at or just outside the boundary edge to frame the LHAs). When the flag is off, no boundary warning fires and the pathfinder skips the penalty branch entirely. It stays a soft warning rather than a hard geofence because a hard reject would kill otherwise valid takeoff/landing legs that briefly leave the polygon.
2. **`ConstraintRule`s are post-generation advisory.** The pipeline does not feed operator-defined ALTITUDE/SPEED/GEOFENCE/RUNWAY_BUFFER rules into trajectory generation; they only run as a validator pass after compile and surface as warnings on the validation tab.
3. **AGL minimum is split.** Measurement and hover waypoints stay soft (PAPI 3° glide-slope geometry inherently dips below 30 m AGL by design); transit waypoints below `MIN_TRANSIT_ALTITUDE_AGL_M` are hard violations because they imply the elevation provider failed after `_adjust_transit_altitude_for_terrain` was supposed to clamp them.
4. **Obstacle `base_alt = max(z)` of the boundary (high-corner stance).** `local_projection.obstacle_base_altitude_from_ewkb` uses the highest boundary corner so the modeled band `[base_alt, base_alt + height]` always covers the real roof on sloped terrain. Over-conservative on a slope (treats the whole footprint as resting on the highest corner) but always safe; flat boundaries are unaffected. Per-vertex `base_alt` with an explicit `top_alt` override is the right long-term model and remains a deferred follow-up - it needs a column-shape change and surveyor data we do not yet collect.
5. **Battery check on unknown endurance emits a suggestion.** When `drone.endurance_minutes is None`, `check_battery` returns a soft `Violation` saying the check was skipped, instead of silently no-op'ing.
6. **PAPI methods preserve the elevation angle, not commanded AGL.** `_apply_terrain_delta` (used for non-PAPI methods) bumps every waypoint by `terrain_at_wp - terrain_at_center` so commanded AGL survives terrain undulation. PAPI methods (`HORIZONTAL_RANGE`, `VERTICAL_PROFILE`, `APPROACH_DESCENT`) instead route through `_apply_papi_glide_slope_terrain`, which rebuilds each MEASUREMENT/HOVER altitude geometrically from the elevation angle to the geometry anchor (`anchor.alt + horiz_dist * tan(angle) + altitude_offset`). The anchor is the LHA center for HR/VP and the runway touchpoint for APPROACH_DESCENT (its glide slope is anchored on the touchpoint, not the PAPI). `HORIZONTAL_RANGE` uses the orchestrator-resolved constant `glide_slope` (= `max(setting_angles) + angle_offset_above`); `APPROACH_DESCENT` uses `descent_glide_slope_override` if set else the same resolved PAPI glide slope; `VERTICAL_PROFILE` recovers the per-waypoint commanded angle from the pre-shift altitude. The operator's `altitude_offset` is re-added on the geometric rebuild branch only (the VP fallback / zero-horiz branch reads `wp.alt` verbatim where the offset already rides through). If the geometric altitude would put a waypoint below `MIN_TRANSIT_ALTITUDE_AGL_M` over local terrain, the helper clamps upward and the angle invariant breaks for that one waypoint. Gimbal pitch is recomputed toward each waypoint's own `camera_target` (which is the LHA center for every PAPI method). The post-recompute regression nets are split by method: `validate_papi_angle_band` runs on every HORIZONTAL_RANGE measurement, while `validate_vertical_profile_angle_band` checks each VP climb at the resolved bookends (`angle_start` / `angle_end`) plus a soft "band not fully covered" warning when PAPI mode does not span `[min, max]` of setting_angles. The VP climb intentionally sweeps below the all-white edge, so the HR-style every-measurement check no longer applies there.

7. **Vertical profile climbs are bookended by `angle_start` / `angle_end`.** `inspection_configuration.angle_source` selects between PAPI (`min(setting_angles) - angle_offset_below` → `max(setting_angles) + angle_offset_above`) and CUSTOM (operator supplies `angle_start` / `angle_end` directly, with `1.9°` / `6.5°` legacy fallbacks when null). Both modes clamp into the Zephyr `[1.0°, 16.5°]` envelope (`MIN_VERTICAL_PROFILE_ANGLE_DEG` / `MAX_VERTICAL_PROFILE_ANGLE_DEG` in `app.core.constants`). `inspection_service.add_inspection` and `update_inspection` reject PAPI-mode saves with 422 when any selected LHA is missing `setting_angle`. Schema-level `angle_start >= angle_end` is rejected at the boundary by a `model_validator`.

### Phase 5 — Final assembly
Layered assembler. The *core* is scope-agnostic: per-pass `MEASUREMENT`/`HOVER` waypoints interleaved with inter-pass A* transits. Bookends are added per `flight_plan_scope`:

- `MEASUREMENTS_ONLY` — core only. First and last waypoints stay `MEASUREMENT`/`HOVER`; no `TAKEOFF`/`LANDING` ever appear.
- `FULL` (airborne) — core wrapped with at-transit-altitude `TRANSIT` bookends from above-takeoff to first MH and from last MH to above-landing. No ground `TAKEOFF`/`LANDING` waypoints; the operator hand-launches the drone and triggers the wayline mid-air.

The legacy ground-takeoff/landing `FULL` scope (descended to WP1 at `executeHeight=0`) and the legacy `NO_TAKEOFF_LANDING` value were collapsed into the current airborne `FULL` in #755; the enum now has exactly two values.

Inter-pass transits use a unified convex-hull visibility graph (`compute_inter_pass_transits`): hull of all pass start/end points, dilated to enclose buffered obstacles that intersect, single A* per transit, with bounded dilation fallback (max 2 expansions). Single-pass missions emit no inter-pass transit. Takeoff-leg and landing-leg transits in `FULL` bookends still use the per-segment `compute_transit_path`. Surface no-go regions are pre-inflated by `surface.buffer_distance` when `LocalSurface` is built, and perpendicular candidate-node spacing in `_collect_graph_nodes_in_circle` is `width/2 + buffer_distance + vertex_buffer_m` - the runway-crossing penalty and graph node placement see the same buffered footprint that the renderer paints. Per-pass A* and `compute_inter_pass_transits` share the same node sources via the `_runway_crossing_node_pairs` helper and `_grid_fill_in_region`: surface edge nodes, a perpendicular crossing pair on the from->to line so A* always has a short crossing edge available, and `GRID_NODE_SPACING` grid fill inside the dilated hull, with buffered surfaces / obstacles / hard zones treated as no-go (no grid node is placed inside them). The `RUNWAY_CROSSING_PENALTY_PER_METER` constant (15) is calibrated so a perpendicular crossing through the buffered region (~75 m incl. `vertex_buffer` each side) costs ~1125 m equivalent: detours under ~1 km still beat crossing, longer perimeter walks lose, and a parallel run of a long runway is effectively forbidden. Compile `FlightPlan` with `totalDistance`, `estimatedDuration`. Set status to PLANNED.

**Camera heading:** MEASUREMENT waypoints point at LHA center. TRANSIT/TAKEOFF/LANDING point in direction of travel.

### Heading direction (inherit + AUTO mission default)

Direction is modeled as a config-only setting. There is no dedicated endpoint — the solver runs as a pre-pass inside trajectory compile.

- **Mission column** `mission.direction` (`AUTO | NATURAL | REVERSED`, NOT NULL, default `AUTO`).
- **Inspection columns** `inspection_configuration.direction` (`NATURAL | REVERSED | NULL`) and `inspection_configuration.resolved_direction` (`NATURAL | REVERSED | NULL`, written by the trajectory pipeline; never accepted on inbound writes).
- **Resolution rule** (per inspection, in order):
  1. If `inspection.config.direction` is `NATURAL` or `REVERSED`, use it.
  2. Else if `mission.direction` is `NATURAL` or `REVERSED`, use it.
  3. Else (mission `AUTO` + inspection inherits) the solver picks for the inspection.
- **Solver**: brute-force over `2^k` assignments for `k` auto inspections (cap `k ≤ 10 = MAX_AUTO_INSPECTIONS`). Only `HORIZONTAL_RANGE`, `FLY_OVER`, `PARALLEL_SIDE_SWEEP`, and `SURFACE_SCAN` flip geometry (REVERSED flips the surface-scan snake start); other methods are unaffected.
- **Persistence**: each compile writes the chosen direction back into `inspection_configuration.resolved_direction`. The UI shows `direction` if pinned, otherwise falls back to `resolved_direction` (e.g. "Inherit (Reversed)").
- **Regression**: changing `inspection.config.direction` or `mission.direction` regresses the mission to `DRAFT` via the standard update flow (both fields are trajectory-affecting).

---

## UI Pages — Wireframe Summary

### Page 01 — Login (`/login`)
Email + password. JWT with refresh tokens. Wrong credentials: inline error. After login: load last airport → dashboard. No airport → airport selection.

### Page 02 — Airport Selection (`/airport-selection`)
Search by ICAO + name. List: name, ICAO, city, country. Click selects → loads ALL airport data → dashboard. Users see only their assigned airports.

### Page 03 — Dashboard (`/operator-center/dashboard`)
Left: mission list (searchable, clickable), statistics placeholder, drone profile read-only, "+ New Mission" button. Right: read-only MapLibre map with airport assets, layer toggles, PoI info panel, legend.

### Page 04 — Mission Overview (`/operator-center/missions/:id/overview`)
Tabs: **Overview** | Configuration | Map | Validation & Export. Left (read-only): mission info, warnings ("Compute trajectory to see warnings" before generation), estimated stats, validation status. Right: interactive but read-only map preview, "Modify Parameters" → Config tab, "Open Map" → Map tab.

### Page 05 — Mission List (`/operator-center/missions`)
Filters: status, date, drone, operator. Columns: ID, name, airport, status, drone, created, updated. Pagination 10/20/50/200. Row actions: duplicate, rename, delete. "Add New" → creation flow (name, template, drone).

### Page 06 — Mission Map (`/operator-center/missions/:id/map`)
Full-screen MapLibre. Toolbar: undo/redo (10 max, per-session), save, recompute, validate trajectory. Left: layers, inspection filter (multi-select), waypoint list (click=info, double-click=fly to), waypoint info editor. Right: legend, warnings (clickable), stats.

**Waypoint editing:** Waypoint mode (default): move, add transit between existing (hover segment → "+"), delete. Camera mode (toggle): edit camera heading targets. Only TRANSIT addable by operator. START/END placement via toolbar. Any edit → PLANNED.

**Recompute logic:** Waypoint-only edits → validate only. Config changes → full 5-phase regeneration. The "Validate Trajectory" button (visible only when a flight plan exists, disabled while there are dirty waypoint edits or unsaved map changes) calls `POST /api/v1/missions/{id}/revalidate` — re-runs the safety pipeline against the persisted plan without regenerating waypoints, replaces the prior `ValidationResult`, and preserves waypoint UUIDs / lon-lat-alt byte-identical pre/post.

**Map layers:** Runway polygons, safety zones (color by type), obstacles (point + buffer circle), AGL markers, waypoint path (polyline + arrows), waypoints (numbered, colored by type + inspection), transit segments (dashed).

**3D View:** CesiumJS separate viewer toggle. Orbit from any angle. Altitude native. View-only (editing is 2D only).

### Page 07 — Mission Configuration (`/operator-center/missions/:id/configuration`)
Two-column layout. Left scrollable panel: MissionConfigForm (drone profile select, default speed, altitude offset, takeoff/landing CoordinateInputs with pick-on-map, operator notes), InspectionList (reorderable, add via TemplatePicker modal, remove, visibility toggle, count badge X/10), InspectionConfigForm (template name, method read-only, per-AGL LHA section collapsed by default under a clickable header with helper-mode toggle (All / Range / From-threshold / Custom) above the LHA checkboxes when expanded, method-specific fields for FLY_OVER, PARALLEL_SIDE_SWEEP, and APPROACH_DESCENT rendered before the direction section, altitudeOffset, speedOverride, measurementDensity, hoverDuration — with speed/framerate warning), StatsPanel (distance, duration, waypoint count, battery % — post-computation only), WarningsPanel (severity-grouped: Violations / Warnings / Suggestions sections, each collapsible with a count badge, rows deduped by `violation_kind` — falling back to `constraint_name` then message for legacy null-kind rows — post-computation only). Right: AirportMap with flight path visualization (direction arrows on path segments, blue transit paths #7eb8e5, per-inspection colored measurement segments, overlapping paths offset ~5m left of heading for visibility, blue ring around the selected inspection's measurement waypoints), WaypointListPanel (sortable list), PoiInfoPanel (the single feature-info panel for any clicked feature, waypoints included). "Compute Trajectory" button in MissionTabNav bar. Schema uses `config` (not `config_override`) in InspectionCreate/InspectionUpdate.

### Page 08 — Validation & Export (`/operator-center/missions/:id/validation-export`)
Left: per-constraint breakdown (pass/fail/warning), "Edit Configuration" → Config tab, "Accept" → VALIDATED. Right: map + export section (KML/KMZ/JSON/MAVLink checkboxes, download button). Export disabled until VALIDATED. Complete/Cancel enabled once MEASURED. Delete available always. The *Upload Drone Media* button in the MissionTabNav header opens the drone-media dialog — see "Drone media matching + upload dialog" below.

#### Geozone bundle option

`POST /api/v1/missions/{id}/export` accepts two opt-in flags:

- `include_geozones: bool = false` — bundle the airport's keep-out polygons (active safety zones, obstacles) into the export.
- `include_runway_buffers: bool = false` — additionally bundle runway/taxiway buffer polygons. Only meaningful when `include_geozones=true`; rejected with HTTP 400 otherwise.

Both flags are gated server-side by format and by `DroneProfile.supports_geozone_upload`. The export panel mirrors the gate so the checkbox is greyed out (with an i18n tooltip) when the combination is unsupported.

##### Capability matrix

| Format / target | Keep-out support | How it travels |
|---|---|---|
| **MAVLINK** (QGC `.plan` / ArduPilot / PX4) | **Native** | `geoFence.polygons[]` with `inclusion: false` in the same `.plan` JSON. `include_runway_buffers=true` adds `inclusion: true` polygons in the same array. When the flag is on, MAVLINK switches from WPL 110 plain text to QGC `.plan` JSON (extension `.plan`, content type `application/json`). |
| **JSON** (TarmacView schema) | **Native** | Top-level `geozones.{safety_zones, obstacles, runway_buffers}` alongside `waypoints`. Output is byte-identical to today when the flag is off. |
| **UGCS** | **Native** | Sets `route.checkCustomNfz=true` and emits a sibling top-level `customNfzList[]` array with each polygon as `{name, type, polygon: { points: [{latitude, longitude}] }}` (radians). |
| **KMZ / KML** | **Advisory only** | Adds a `<Folder name="Keep-out zones">` with one `<Polygon>` placemark per zone/obstacle/buffer; every placemark `<description>` calls out that DJI Pilot 2 renders but does NOT enforce these polygons. |
| **WPML** | **Not supported** | DJI WPML has no fence schema. Geofencing for DJI enterprise fleets is server-side (FlySafe / FlightHub 2 "Custom Flight Area"). Gate rejects the flag for WPML. |
| **GPX, LITCHI, CSV, DRONEDEPLOY** | **Not supported** | Pure waypoint formats with no fence concept. Gate rejects the flag. |

Excluded from every payload: `SafetyZone` rows where `is_active=False` and rows of type `AIRPORT_BOUNDARY` (the boundary defines where the airport is, not a keep-out). Empty airports (zero zones, zero obstacles) yield empty arrays, not an error. See `docs/adr/2026-05-03-geozone-export.md` for the full design rationale.

#### DJI heading mode picker

`POST /api/v1/missions/{id}/export` also accepts an optional `dji_heading_mode_override` (`'smoothTransition' | 'towardPOI' | 'followWayline' | null`). The resolver order is per-export override → persisted `mission.dji_heading_mode` → `'smoothTransition'` default. The override threads into the KMZ / WPML generators only — every other format ignores it. When the override differs from the persisted column, the export endpoint writes it back as a side effect inside the same flush window so the picker pre-fills with the operator's last choice on the next export. The write is a direct attribute assignment (NOT via `regress_if_trajectory_changed`); `dji_heading_mode` is deliberately not in `TRAJECTORY_FIELDS` so flipping the export shape never regresses status to DRAFT. The chosen override is captured in the `EXPORT` audit row's `details` alongside the geozone flags; no separate UPDATE row is emitted.

- `smoothTransition` (default, recommended) — per-WP `waypointHeadingAngle = bearing(wp -> camera_target)` for aimed waypoints whose body is already pointed at the LHA (`_body_tracks_target` predicate, 5° tolerance). HORIZONTAL_RANGE / VERTICAL_PROFILE / HOVER_POINT_LOCK / MEHT_CHECK set the heading to that bearing directly, and FLY_OVER back-offsets each waypoint axially along the row so the LHA sits dead ahead (`wp.heading == bearing(wp -> target)`) — all of these emit smoothTransition. Only PARALLEL_SIDE_SWEEP falls through to followWayline: its lateral offset leaves the body flying the row direction (~90° off the bearing-to-LHA), so the predicate fails. Firmware interpolates body yaw between the two static numbers — no runtime POI math. Pinned by `test_smoothtransition_*` plus the real-generator seam `test_real_fly_over_emits_smooth_transition`.
- `towardPOI` (experimental) — per-WP `waypointPoiPoint = camera_target.lat,lon,0.000000` (alt pinned to zero per `common-element.md`'s towardPOI scoping; decouples the POI from `camera_target.alt` so a below-takeoff target cannot trip Pilot 2's POI geometry pre-flight check), firmware drives continuous POI tracking. Hardware-dependent; pick only when `smoothTransition` shows visible jerk on the airframe.
- `followWayline` (reliable fallback) — pre-#447 shape. Body snaps at each WP and a per-WP `rotateYaw` action restores aim. Trajectory is correct on every documented model.

The picker lives on `ExportPanel`; it is hidden unless `(KMZ || WPML) ∈ selectedFormats` AND `activeDroneProfile.manufacturer === 'DJI'`. Non-DJI operators never see it.

#### DJI WPML drone enum table + M4T fallback

DJI's WPML schema requires every wayline to declare a `droneInfo` + `payloadInfo` enum quartet identifying the aircraft. TarmacView resolves it per-mission from `drone_profile.model` via the `DJI_WPML_ENUMS` table in `app.core.constants`:

| Drone model | `droneEnumValue` / `droneSubEnumValue` | `payloadEnumValue` / `payloadSubEnumValue` |
|---|---|---|
| Matrice 4T | 99 / 1 | 89 / 0 |
| Matrice 300 RTK | 60 / 0 | 43 / 0 |
| Matrice 350 RTK | 89 / 0 | 43 / 0 |
| Mavic 3 Enterprise | 77 / 0 | 66 / 0 |

These four mappings are confirmed against DJI's published Enumeration-Values-of-Aircraft/Camera page, reproduced in [dji-wpml-reference.md](dji-wpml-reference.md) — the structured DJI WPML field reference, which also carries the doc-confirmed value ranges the KMZ/WPML export targets.

Drones outside the table — Mavic 2 Pro and other unmapped DJI airframes, non-DJI drones (Skydio, Autel, Freefly, eBee), and missions with no drone configured — fall back to the M4T tuple (`99/1/89/0`). Firmware drives flight; the enum is only a file label, so the fallback produces a renderable KMZ/WPML archive instead of a 422. `DroneProfileResponse` exposes two derived flags so the frontend can branch the export UI:

- `supports_dji_wpml: bool` — true when `model` has an entry in `DJI_WPML_ENUMS`.
- `is_dji: bool` — case-insensitive `manufacturer == "DJI"`.

`ExportPanel` intercepts KMZ/WPML downloads when `supports_dji_wpml === false` and surfaces a pre-export confirm modal whose body branches on the drone category — unmapped DJI ("tagged as Matrice 4T fallback; firmware still flies correctly, preview may show the wrong aircraft icon"), non-DJI ("KMZ/WPML is DJI-proprietary; generated for archival but the aircraft cannot read it — consider LITCHI or KML instead"), and no drone configured ("tagged as Matrice 4T fallback; assign a drone before flight"). Mapped DJI drones export silently with their own enum and skip the modal. Adding a new mapped model is one entry in `DJI_WPML_ENUMS`; the schema flag flips automatically and the modal stops firing.

#### DJI altitude clamp acknowledgment

DJI KMZ / WPML wayline altitude is takeoff-relative (`executeHeightMode=relativeToStartPoint`), so any placemark whose MSL falls below the takeoff reference would emit a negative relative height. `_append_placemark` clamps the value to `0` and now appends one record per clamped waypoint (`{waypoint_index, intended_alt, clamped_alt, reason: "below_takeoff"}`) to an optional collector threaded down by the orchestrator. Previously the clamp only logged a warning and the operator received a silently-modified file.

`POST /api/v1/missions/{id}/export` accepts an `acknowledge_altitude_clamps: bool = false` flag. When the KMZ / WPML pass collects any clamp record and the flag is false, `export_mission` raises `DomainError(status_code=409, extra={"altitude_clamps": [...]})` *before* the VALIDATED → EXPORTED transition runs. Nothing is committed by the route on this branch — mission status, the `dji_heading_mode` write-back, and the audit row all roll back with the uncommitted session. When the flag is true the file ships and the operator's acknowledgment rides on the `EXPORT` audit row's `details` (`acknowledge_altitude_clamps` + `altitude_clamps_count`). Non-DJI formats never collect clamps; KMZ + WPML each append one record per waypoint, deduped by the waylines-only emit so a single mission cannot generate two records for the same placemark.

Frontend (`exportMissionFiles`) parses the 409 blob body and returns `{kind: "clamp_warning", clamps}` to `useMissionValidation`, which stores the list and surfaces `AltitudeClampWarning` (waypoint / intended / clamped table + acknowledge checkbox) in `ExportPanel`. Ticking the checkbox unblocks the Download button; the panel re-fires `exportMissionFiles` with `acknowledge_altitude_clamps: true`, and fresh clamps in a later response reset the acknowledgment so the operator cannot silently re-confirm a different set.

#### Field-link status chip

`GET /api/v1/field-link/status` (operator JWT) reports the field hub link as `{hub_online, broker_connected, devices: [{sn, model_name, model_key, domain, online, bound, gateway_sn}], connect_url, public_host}`. The backend proxies the hub's shared-secret internal status endpoint (`X-Hub-Secret`); an unset `FIELDHUB_URL` means "no hub in this deployment" and returns `hub_online=false` without a network attempt, and a down/unreachable/malformed hub degrades to the same shape — the route never 500s over hub state. `connect_url` / `public_host` (added in #28) carry the device-facing connect address and are `null` on the degraded / no-host shape.

`ExportPanel` owns the poll via `useFieldLinkStatus` (10 s while mounted) and shares the one result three ways — the chip, the *Send to drone* dispatch gate, and the *Field hub connection dialog* below; `FieldLinkStatusChip` is presentational (takes the poll result as a `status` prop) and stays hidden until the first response. Three states: no hub (grey), RC offline (red), RC connected (green — aircraft model preferred in the label over the RC gateway).

#### Send to drone (mission dispatch)

`POST /api/v1/missions/{id}/dispatch` pushes the mission KMZ into the field hub's wayline library, which DJI Pilot 2 syncs into its route list over the local network (`docs/specs/FIELD-HUB.md` §4.2). The route reuses the export pipeline (`export_mission(db, id, ["KMZ"])`), so dispatch inherits the VALIDATED/EXPORTED gate, the VALIDATED → EXPORTED transition, and the 409 altitude-clamp gate — the request body mirrors `acknowledge_altitude_clamps`. The service posts the KMZ + metadata to the hub's shared-secret internal endpoint, then upserts a `wayline_dispatch` row keyed on the unique `mission_id`, so a re-dispatch updates the existing record with a stable wayline uuid and Pilot sees an updated route instead of a duplicate. `drone_model_key` / `payload_model_keys` derive from `DJI_WPML_ENUMS` (M4T fallback for unmapped drones) so Pilot's connected-aircraft filter matches the enums baked into the KMZ; `sign` is the KMZ md5. An unreachable or unconfigured hub raises 502 and nothing persists — the status transition and the dispatch row roll back with the uncommitted session. Each successful dispatch commits a `DISPATCH` audit row in the same transaction.

Frontend: `SendToDroneSection` card in the export panel. The button is gated on hub online + at least one device online + status ∈ {VALIDATED, EXPORTED} (a tooltip explains the blocker), shows inline success/error feedback (the backend `detail` message is surfaced verbatim), and a clamp 409 turns the button into an explicit "Acknowledge clamps and send" retry. The page refetches after a successful dispatch because status may have moved to EXPORTED. Strings under `mission.sendToDrone.*` (EN + SK). The card header also carries a *Field Hub* button that opens the connection dialog below.

#### Field hub connection dialog

`FieldHubDialog` (opened from the *Field Hub* button beside the link chip in `SendToDroneSection`, open state owned by `ExportPanel`) helps the operator point DJI Pilot 2 at the hub without reading the address off a terminal. It consumes the parent's single `useFieldLinkStatus` poll result — no second poll — and shows, in one place: the device-facing **connect address** (`https://<host>:8443`, from `status.connect_url`) with a copy button; an **inline-rendered QR** of that address for scanning on the RC, generated by a vendored dependency-free encoder (`frontend/src/utils/qrcode.ts`, exporting `encodeQrMatrix` / `qrMatrixToPath`), so `package-lock.json` stays untouched; live **hub online** + **MQTT broker connected** state; the **connected-device list** (model + serial + online state, with an empty state); and a **CA-certificate download** (`GET /api/v1/field-link/ca-cert` through the JWT client, since a plain `<a href>` can't carry the bearer) with an "install on each RC once" hint. Graceful states: hub offline → an offline troubleshooting hint; online but no host configured → "hub address not configured"; before the first poll (`status === null`) → a connecting state. EN + SK strings under `mission.fieldHub.*`. See `docs/specs/FIELD-HUB.md` (top status + §6).

#### Drone media matching + upload dialog

`/api/v1/drone-media` (operator JWT) is the mission↔media surface over the `drone_media_file` rows the field hub reports (`docs/specs/FIELD-HUB.md` §5). Matching runs server-side in `drone_media_service`: a `RECEIVED` file's candidates are missions with a `wayline_dispatch` whose `dispatched_at <= captured_at` (device-reported capture time; flight-progress events aren't persisted yet, so the window has no close), with `device_sn` equality enforced when both sides carry one, narrowed by GPS containment of the capture position in the mission's flight-plan waypoint bbox grown by `MEDIA_MATCH_AREA_BUFFER_M` (100 m, `app.core.constants`). Multiple hits tie-break on the nearest inspection target (template-AGL LHA centroids via `AGL.calculate_lha_center_point()`); no candidate, a null capture time, or null GPS → `UNASSIGNED`. Matching fires on each new row inside the media-events ingest and is failure-safe — an internal error leaves the row `RECEIVED`, and the sweep inside the listing retries it whenever the dialog opens.

`GET /api/v1/drone-media` returns mission groups plus the unassigned bucket (`INGESTED` excluded; `mission_id IS NULL` rows bucket as unassigned regardless of status, covering mission-delete SET NULL). `POST /{media_id}/assign` manually moves one file to a mission or — on a null `mission_id` — back to the unassigned bucket (audited `UPDATE`; reassignment after ingest is 409). `POST /confirm-ingest` marks a mission's rows `INGESTED` (audited `STATUS_CHANGE`, idempotent — a repeat returns `ingested_count: 0`); the hand-off into the processing pipeline behind it is still a stub. Status transitions live on the `DroneMediaFile` model (`assign_to_mission` / `mark_unassigned` / `mark_ingested` — never direct `status` writes), and `updated_at` (migration `0013_drone_media_updated_at`) audits every move.

Per-inspection manual upload (Phase 1 of the merge): the operator can upload footage straight from the browser into a specific inspection, scoped to one mission. Media + result artifacts live in S3-compatible object storage (MinIO locally, S3 in the cloud); `app.services.object_storage` mints presigned PUT/GET urls (signed against `s3_public_endpoint` so the browser can reach the bucket directly), and `boto3` is imported lazily so the app still imports on a backend pinned to `requirements.txt` only. The browser flow is: `POST /api/v1/drone-media/upload-url` mints a presigned PUT target + object key (no row yet) → the browser PUTs the file straight to the bucket → `POST /api/v1/drone-media/complete-upload` records the `origin=MANUAL` row at the inspection's `max(order_index)+1`. `GET /api/v1/missions/{mission_id}/drone-media` returns the inspection-grouped view (each inspection's media ordered 1..N) plus the mission-level unassigned bucket. `PUT /api/v1/drone-media/{media_id}/move` reassigns a file to another inspection/position (or null to detach it), `PUT /api/v1/drone-media/inspections/{inspection_id}/reorder` renumbers one inspection's media to a supplied id order, and `DELETE /api/v1/drone-media/{media_id}` removes a manual upload and drops its stored object. Dense 1..N ordering is service-owned (sentinel-shift renumber under a parent-**mission** row lock, mirroring the LHA `sequence_number` protocol); delete and move re-densify the affected groups. Guards: a target inspection must belong to the file's mission (422), only `MANUAL`-origin rows are deletable (422 otherwise — hub footage is never deletable here), and any reassignment/delete is blocked once the row is `INGESTED` (409). No video processing yet — that is Phase 2.

Frontend: the *Upload Drone Media* header button on the Validation & Export page (the MissionTabNav action slot) opens `UploadDroneMediaDialog`, scoped to the current mission. The dialog lists the mission's inspections (labelled `Inspection {order} · {method}`) plus an *Unassigned* bucket, each with a file-count badge. Each inspection group has a drop-or-browse zone that uploads video files (presigned PUT → complete-upload); files can be reordered within an inspection and dragged between inspections (`@dnd-kit`), and manual rows carry a trash button that deletes them. Inspection assignment + order survive a reload. Empty states: "This mission has no inspections yet. Add an inspection before uploading media." when the mission has none, "No files yet" per empty group. Load/upload/move/reorder/delete failures surface as an inline error line. A single footer **Confirm** button fires one measurement per inspection-with-media at once (`Promise.allSettled` over `createMeasurement` → `POST /api/v1/inspections/{inspection_id}/measurement`) — skipping empty groups and the unassigned bucket, settling every call so one failure can't abort the rest. It registers the started run ids with the measurement-progress context (the corner progress toast), navigates to the measurements list (`/operator-center/measurements`), and closes; if every run fails to start it shows an inline error and stays open. There is no per-inspection measure button anymore — `MeasurementFlowDialog` is review-only and opens from the list for an `AWAITING_CONFIRM` run. Strings under `mission.uploadDroneMediaDialog.*` plus the button label `mission.validationExportPage.uploadDroneMedia` (EN + SK); types in `frontend/src/types/droneMedia.ts` mirror `backend/app/schemas/drone_media.py` + the media shapes in `schemas/field_link.py`.

### Page 09 — Airport (Operator) (`/operator-center/airport`)
Read-only full airport view. All infrastructure on map. Left: surface list, AGL/PoI list. Everything clickable.

### Page 10 — Coordinator: Airport Editing (`/coordinator-center/airports/:id`)
Left: collapsible CRUD sections for Ground Surfaces, Obstacles, Safety Zones, AGL+LHA. Map: editable via Leaflet.draw (polygons, circles, rectangles, point placement, vertex dragging, GeoJSON text editing). Undo/Redo + Save.

### Page 11-14 — Coordinator: Lists + Editors
Airport list, inspection template editor (AGL selector, per-AGL helper-mode toggle (All / Range / From-threshold / Custom) above the LHA checkboxes, default config, method), drone profile editor (12 fields), inspection template list. All follow same list pattern: search, filters, pagination, add/duplicate/delete.

---

## Map Architecture

- **2D editing:** MapLibre GL JS — satellite tiles (ESRI World Imagery), pitch/bearing via middle mouse
- **3D visualization:** CesiumJS — separate viewer tab, orbital view, altitude native
- **Coordinator drawing:** Leaflet.draw for geometry editing
- **Coordinate system:** WGS84 / SRID 4326
- **Performance target:** 250 waypoints comfortable, 500 max

## Global UI Patterns

- **Save:** manual via Save button. Unsaved changes guard on navigation.
- **Undo/Redo:** waypoint edits only, max 10, per-session, resets on param changes
- **List Item Actions:** row end: duplicate/rename/delete. Dropdown: same + deselect.
- **Delete:** always confirmation dialog with impact description
- **Max 5 inspections per mission.** Fixed color per inspection order.
- **Desktop only** — no mobile optimization

---

## DDD-Lite Patterns

### Aggregate Roots

- **Mission** — owns inspections, controls status transitions via `transition_to()`. Inspection add/remove/reorder works from any non-terminal status (auto-regresses to DRAFT). Max 10 inspections. Trajectory-affecting field changes (drone, speed, coordinates, transit_agl, direction) regress the mission to DRAFT and set `has_unsaved_map_changes = True`. The existing flight plan row is intentionally kept so the frontend can render it as a stale reference until the operator triggers a fresh recompute. Terminal statuses are `COMPLETED` and `CANCELLED` only — `EXPORTED` is non-terminal and can still be deleted, measured (-> MEASURED), or duplicated; completion/cancellation is reachable only from MEASURED, never directly from EXPORTED.
- **Airport** — owns surfaces, obstacles, safety zones via `add_surface()`, `add_obstacle()`, `add_safety_zone()`. Sets `airport_id` on child entities.
- **Measurement** (`backend/app/domain/measurement/entities.py`, NOT the ORM model) — persistence-agnostic aggregate for one measurement run. Owns the status machine via `transition_to()` / `fail(msg)`, snapshots reference points off the inspection's LHAs at create, confirms operator light boxes (`confirm_boxes()`), and rolls measured transition angles up to PASS/FAIL (`score_light()` / `with_summaries_from()`). Persisted behind the `MeasurementRepository` port; the heavy per-frame results blob lives in object storage, referenced only by `object_key`.

### Value Objects (`backend/app/models/value_objects.py`)

- **Coordinate** — immutable (lat, lon, alt) with range validation, `to_wkt()` method
- **Speed** — non-negative float value
- **AltitudeRange** — min <= max invariant, `contains()` method
- **IcaoCode** — exactly 4 uppercase alpha characters

### Business Methods on Entities

- `Mission.transition_to(target_status)` — enforces state machine
- `Mission.mark_measured()` — VALIDATED/EXPORTED -> MEASURED on measurement kickoff; idempotent, no-ops outside `POST_PLAN_STATUSES` so repeat create-measurement calls (multi-inspection missions) neither re-transition nor raise
- `Mission.invalidate_trajectory()` — PLANNED/VALIDATED/EXPORTED -> DRAFT on trajectory changes; sets `has_unsaved_map_changes = True` and resets computation status. Raises on terminal statuses and on MEASURED (the footage was already scored against the planned LHA ground truth, so editing the plan afterward would orphan the measurement — only COMPLETED / CANCELLED stay reachable). The existing flight plan row is intentionally kept as a stale reference; deletion is wired at the DB level via the CASCADE on `flight_plan.mission_id` (relationship uses `passive_deletes=True`).
- `Mission.has_trajectory_changes(data)` — returns True when `data` touches a `TRAJECTORY_FIELDS` member
- `Mission.regress_if_trajectory_changed(data)` — invalidates trajectory when needed; returns True on regression. Does NOT apply field values — callers still own field assignment via `apply_schema_update` / `setattr`.
- `Mission.modify_inspections(callback)` — runs an inspections mutator and invalidates the trajectory atomically. Keeps the existing flight plan as stale.
- `Mission.assert_deletable()` — raises when status is `COMPLETED` or `CANCELLED`; only those two are terminal
- `Mission.duplicate()` — returns a detached DRAFT copy with cloned inspections and configs; caller adds the copy to the session and flushes
- `Mission.add_inspection(inspection)` / `remove_inspection(id)` — invalidates trajectory, max 10
- `Mission.change_drone_profile(id)` — invalidates trajectory
- `Mission.TERMINAL_STATUSES` — `frozenset({MissionStatus.COMPLETED, MissionStatus.CANCELLED})`; the canonical guard for "no further mutation". `MissionStatus(str, Enum)` keeps both string-keyed and enum-keyed comparisons working at every existing call site.
- `Mission.NON_DRAFT_WITH_PLAN_STATUSES` — `frozenset({PLANNED, VALIDATED, EXPORTED})`; mission has a persisted flight plan but is not yet terminal. Used by `invalidate_trajectory()` and the airport renormalize loop to decide when to regress to DRAFT. The renormalize loop skips TERMINAL and MEASURED missions before any coord `setattr` - a MEASURED mission's takeoff/landing coords and status are left untouched and its id is recorded in the returned `skipped["missions"]` list, so a DEM upload / terrain shift cannot silently drift a scored mission's plan away from the footage (MEASURED is absent from this frozenset, so it would never regress anyway, but the explicit skip stops the coord rewrite that the lock would otherwise miss).
- `Mission.POST_PLAN_STATUSES` — `frozenset({VALIDATED, EXPORTED})`; export gate (`export_mission` rejects anything else) and the auto-regress branch in `generate_trajectory`.
- `Mission.PRE_EXPORT_EDITABLE_STATUSES` — `frozenset({DRAFT, PLANNED, VALIDATED})`; waypoint edit gate for `batch_update_waypoints` / `insert_transit_waypoint` / `delete_transit_waypoint`.
- `Mission.PRE_PLAN_STATUSES` — `frozenset({DRAFT, PLANNED})`; trajectory-generation gate and the bulk-drone-change SQL filter (`Mission.status.in_(Mission.PRE_PLAN_STATUSES)`).
- `Airport.add_surface/obstacle/safety_zone()` — sets airport_id on child
- `InspectionConfiguration.resolve_with_defaults(template_config)` — merges overrides
- `AGL.calculate_lha_center_point()` — centroid of LHA positions
- `LHA.validate_sequence_target(target, n_lhas)` — guards 1..N range; `airport_service.create_lha` / `update_lha` / `delete_lha` lock the parent AGL with `SELECT ... FOR UPDATE`, then shift sibling `sequence_number`s by ±1 to keep the per-AGL ordinal dense and unique. PAPI parents go through `_apply_papi_invariant` after every shift to rewrite letters from sequence (1=A..4=D) using a two-pass lowercase→uppercase sentinel that dodges the `(agl_id, unit_designator)` unique constraint mid-rewrite
- `Inspection.is_speed_compatible_with_frame_rate(drone, speed)` — speed/framerate check
- `FlightPlan.compile(total_distance, estimated_duration)` — sets metrics and timestamp

### LHA selection helper modes

`InspectionConfiguration.lha_selection_rules` is a per-AGL dict (`{agl_id: {mode, params}}`) that records the operator's high-level intent for which LHAs to inspect. The canonical selection still lives in the flat `lha_ids` array; rules are resolved into that array at write time by `app.services.lha_selection.apply_lha_selection`. The trajectory pipeline reads `lha_ids` only — it never sees the rules. The frontend mirror is `frontend/src/utils/resolveLhaSelection.ts` and the two implementations are kept in lockstep by the parity test pair.

Modes:

- **ALL** — every LHA on the AGL.
- **RANGE** — LHAs whose `sequence_number` lies in `[from, to]` (either bound may be `null` to mean "open"; resolver requires `from <= to` and `from, to >= 1`).
- **FROM_THRESHOLD** — LHAs whose along-track projection from the chosen runway endpoint (`START` = threshold, `END` = end of runway) is in `[0, distance_m]`. Requires the AGL's parent surface to expose both `threshold_position` and `end_position`.
- **CUSTOM** — free-form; the resolver returns the empty set and the canonical `lha_ids` list owns the truth.

Save-time semantics (`apply_lha_selection`): the resolver is fed every AGL named in the rules dict plus every AGL that owns any pre-existing entry in `lha_ids`, so a partial rules dict from the form cannot silently drop selections on AGLs the user did not edit. CUSTOM-mode and untouched AGLs preserve their portion of the pre-existing `lha_ids` (intersected with the AGL's lhas); other modes are evaluated and unioned. The resolved set is then written back to `lha_ids`.

### Shared Constants

Canonical numeric thresholds live in `backend/app/core/constants.py` (e.g. `MIN_TRANSIT_ALTITUDE_AGL_M = 5.0`, `DEFAULT_BUFFER_DISTANCE_M = 5.0`). Models, schemas, and services import from there. `app.services.trajectory.types.MINIMUM_ALTITUDE_THRESHOLD` is kept as an alias for trajectory consumers; tests assert the alias and the canonical value stay in sync.

### Enum Source of Truth

Backend enums live in `backend/app/core/enums.py`. Frontend literal unions in `frontend/src/types/enums.ts` must stay in lockstep — `backend/tests/test_enum_parity.py` enforces parity for `ConstraintType`, `MissionStatus`, and `WaypointType` to guard against drift. When adding/renaming an enum member, update both files in the same change.
