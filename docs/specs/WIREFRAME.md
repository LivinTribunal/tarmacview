# TarmacView — Wireframe Specification & Design Decisions

**Project:** Design and Implementation of a Drone Mission Planning Module for Airport Lighting Inspection
**Author:** Štefan Moravík
**Last Updated:** 2026-03-14
**Status:** Complete — ready for GitHub issue creation

---

## Architecture Decisions

### Tech Stack
- **Frontend:** React 18 + TypeScript + Vite
- **2D Map:** MapLibre GL JS (free open-source fork of Mapbox)
- **3D Map:** CesiumJS (separate 3D viewer for flight plan visualization)
- **Drawing Tools:** Leaflet.draw (for Coordinator map editing)
- **Satellite Tiles:** ESRI World Imagery (free for academic use)
- **Coordinate System:** WGS84 for display and storage. Geometry persisted as ISO WKT strings (`POINT Z (lon lat alt)`, etc.); spatial operations run via Shapely.
- **Backend:** Spring Boot 3 + Java 21 + Spring Data JPA
- **Database:** PostgreSQL 16 on Amazon RDS
- **Auth:** JWT with refresh tokens stored in localStorage, Spring Security custom JWT filter
- **Deployment:** Spring Boot on AWS Lambda via SnapStart (`aws-serverless-java-container-springboot3`), React on AWS Amplify Hosting, PostgreSQL on Amazon RDS

### Application Structure
- Single React app with two route trees: `/operator-center` and `/coordinator-center`
- Role-based routing: login response includes user roles, Operator sees Mission Control Center nav, Coordinator sees Configurator Center nav
- Admin manages user accounts and role assignments — outside thesis scope

### Map Architecture
- **2D editing:** MapLibre GL JS — supports pitch/bearing tilt, satellite tiles, drawing tools via terra-draw
- **3D visualization:** CesiumJS — separate viewer tab for orbital 3D flight plan review, altitude shown natively, no separate elevation panel needed in 2D
- **Coordinator drawing:** Leaflet.draw for polygons, circles, rectangles, point placement, vertex dragging, GeoJSON text editing
- **Middle mouse button:** Changes 3D pitch/bearing view in MapLibre
- **Satellite imagery:** ESRI World Imagery via MapLibre raster source
- **Performance target:** 250 waypoints comfortable, 500 max, SVG renderer (no marker clustering)

---

## Global Patterns

### List Item Action Pattern
Referenced throughout the app. Every list item (missions, airports, inspections, drones) follows this pattern:
- **Row actions (end of row):** Duplicate, Rename, Delete
- **Dropdown header actions (in the selection dropdown):** Pencil (rename), Deselect (x), Dropdown (v)
- **Dropdown list items:** Rename, Duplicate, Delete
- **Role restrictions:** Operators cannot delete/edit airport infrastructure, safety zones, obstacles, AGL systems
- **Delete always triggers confirmation dialog:** "Are you sure you want to delete [item name]?" with mission/reference listing if the item is in use

### Save & Unsaved Changes
- **Save is manual** via Save button
- **Unsaved changes guard:** When navigating away from a dirty form, dialog appears: "You have unsaved changes. Save / Don't Save / Cancel"
- **"Saved Status Last Updated"** timestamp shown next to save button on all editing pages

### Undo/Redo
- **Scope:** Waypoint edits only (on Map tab and Coordinator map)
- **Resets:** When parameters or AGL changes are made, undo stack clears
- **Max depth:** 10 actions per session
- **Not persisted** across sessions or page navigations

### Error Handling
- Deferred to implementation phase — not specified in wireframes
- Generic error states will be handled globally

### Loading States
- Login: loading indicator during authentication
- Trajectory computation: blocks UI, button shows progress indicator, expected runtime in seconds
- All API calls: appropriate loading indicators (implementation detail)

### Confirmation Dialogs
- Required before: deleting any entity, cancelling a mission, completing a mission
- Format: modal dialog with item name and impact description
- For drone deletion: shows list of missions referencing that drone

### Notifications
- Low priority — toast notifications in upper right corner
- Triggers: flight plan generated, export successful, validation failed
- Not a blocking requirement for initial implementation

### Responsive Behavior
- Desktop web app — no mobile optimization
- Minimum supported viewport: to be determined during implementation

### Theme & Language
- Light and dark mode supported
- English and Slovak supported (`en`, `sk`); the architecture is open to additional locales by dropping a new `frontend/src/i18n/locales/{lang}.json` and registering it in `SUPPORTED_LANGUAGES`
- Language switcher lives in the user-menu dropdown as an EN / SK pill group; choice persists in `localStorage` under `tarmacview_language` and falls back to `en`

### Account Settings
- "Settings" entry in the user-menu dropdown opens an Account Settings modal (any role, any page)
- Shows email, role, and assigned airports as read-only; lets the user rename themselves and change their password
- Password change requires current + new + confirm; new password is min 8 chars and must match confirm
- Backed by `GET` / `PUT /api/v1/auth/me`; a successful name update triggers `AuthContext.refreshUser()` so the navbar reflects the new name immediately
- Wrong current password surfaces a translated error; password fields are never logged; closing the modal resets all form and feedback state
- App preferences (language, theme, units) are not in this modal - language and theme live elsewhere in the user-menu dropdown

---

## Page Specifications

---

### Page 01 — Login

**Route:** `/login`

**Authentication:**
- JWT with refresh tokens
- Refresh token stored in localStorage
- Spring Security with custom JWT filter
- Login response includes user roles (Operator, Coordinator, Admin)

**Behavior:**
- Submit: click Login or press Enter in the email/password field — both run the same HTML5 validation and submit path
- After successful login: loads last remembered airport, forwards to dashboard
- If no airport remembered: forwards to Airport Selection
- Wrong credentials: inline error message "Wrong login credentials. Try again."
- Loading indicator shown during authentication
- Inputs carry `autoComplete` (email / current-password) so password managers recognize the form

**Out of Scope:**
- Forgot password flow
- Account creation (admin-only, outside thesis)
- Registration

---

### Page 02 — Airport Selection

**Route:** `/airport-selection`

**When shown:**
- No airport currently selected
- No airport remembered from previous session
- User clicks X on "Selected Airport" in nav bar

**Airport Row Info:**
- Airport Name
- ICAO Code
- City and Country

**Search:** Filters by ICAO code, name, and city simultaneously

**Filters (inline in search bar):**
- Country select - dropdown populated from the airports' distinct country values
- "Has AGL" checkbox - hides airports with zero AGL systems
- Filters compose with search; same shape as the coordinator airport list

**Data Loading:** Selecting an airport loads ALL airport data (runways, safety zones, AGL targets, obstacles) for smooth experience

**Access Control:** Each user has assigned Airport Code(s). User sees only airports assigned to them. Admin sees all.

**Empty State:** "No Airports Available" message in the list area

**Airport Switching:** Also available via "Selected Airport" dropdown in nav bar on any page

---

### Page 03 — Mission Dashboard

**Route:** `/operator-center/dashboard`

**Layout:**
- Top nav: TarmacView Mission Control Center | Dashboard | **Missions** | Airport | Drones | Field Ops | Selected Airport dropdown | Username dropdown
- Results moved into the mission workspace as an inspection-scoped tab (Page 15/16); the old airport-wide "Results" top-nav entry was removed. Old `/operator-center/measurements*` deep-links redirect to the owning mission's Results tab
- "Field Ops" tab: live — routes to `/operator-center/field-ops`, the field-hub cloud-mission + drone-media management page (Page 17)
- "Configurator" access: only in Username dropdown menu, visible only to Coordinators
- Light/Dark mode toggle and EN/SK language switcher live inside the username dropdown menu

**Left Panel:**
- Mission List: clickable, searchable list of missions for selected airport
- Statistics: filler content (avg inspection time, inspections done, etc.)
- Drone Profile: read-only display of drones available to this airport. If only one drone: show that drone's basic info (name, endurance, missions done). Not editable from dashboard.
- **"+ New Mission" button** below mission list

**Right Panel:**
- Map Preview: **read-only**, shows all airport assets by default (runways, obstacles, safety zones, AGLs)
- Layers panel: runways, obstacles, safety zones, AGLs
- Waypoint/PoI Info panel: displays info about any map object the user clicks (AGL, obstacle, safety zone — anything stored in DB)
- Legend

**Removed from wireframe (mistake):** "Modify Parameters" and "Open Map" buttons do NOT appear on dashboard

**Log out:** In username dropdown, forwards to login page (no confirmation needed)

---

### Page 04 — Missions Overview (Mission Selected)

**Route:** `/operator-center/missions/:id/overview`
**Tab:** Overview | Configuration | Map | Validation & Export

**Mission Selection Header:**
- "Mission ID - Name" with actions: pencil (rename), x (deselect → forward to mission list), v (dropdown with mission list showing IDs and names for quick switching, includes rename/duplicate/delete per item)

**Left Panel (all read-only on Overview):**
- **Mission Info:** name, created date, airport, runway, AGLs (comma-joined names of all AGL systems on the mission's surfaces; em dash if none), drone profile, status, operator notes
- **Warnings:** Empty with note "Compute trajectory to see warnings" before trajectory exists. After computation: three collapsible severity sections — Violations / Warnings / Suggestions — each with a count badge. Rows collapse by `violation_kind` (falling back to `constraint_name`, then message, for legacy null-kind rows) into one row with deduped waypoint chips, so two same-kind warnings merge regardless of message wording. Default expand state: violations open, warnings open when ≤5 / collapsed beyond, suggestions collapsed; resyncs on recompute. Empty state shows a check icon + "No issues found" + hint instead of bare text.
- **Mission Estimated Stats:** total distance, estimated time, battery consumption, number of inspections. Empty before trajectory computation.
- **Validation Status:** Empty with note "Trajectory needs to be computed" before computation. After computation: minimal validation stats and status.

**Right Panel:**
- Map Preview: **interactive but read-only** (user can pan, zoom, click objects for info but cannot edit)
- Shows airport assets by default. After trajectory generation: also shows waypoints and trajectory for this mission
- Default display: waypoints and AGLs specific to this mission + all safety zones and obstacles
- Layers panel, PoI Info panel, Legend
- **"Modify Parameters"** button → navigates to Configuration tab
- **"Open Map"** button → navigates to Map tab
- Map preview updates automatically when changes are made and new trajectory is generated

**Version System:** NO version system. Only one flight plan per mission with "Last Updated" timestamp.

**Status-dependent behavior:** Page layout is the SAME for all statuses. Difference is only in content:
- Before trajectory: map shows no waypoints, warnings/validation/stats panels show placeholder notes
- After trajectory (PLANNED+): all panels populated with data

---

### Page 05 — Missions List (No Mission Selected)

**Route:** `/operator-center/missions`

**Filters:** Status, date range, drone profile, operator name

**Columns:** ID, Name, Airport, Status, Drone, Created, Last Updated

**Sorting:** Click column header to toggle ASC/DESC. Available on all columns (alphabetical or numeric).

**Pagination:** 10 items default. Options: 10, 20, 50, 200.

**Row Actions:** Duplicate, Rename, Delete (List Item Action Pattern)

**Bulk Actions:** Bulk Delete, Archive

**"Add New" button:** Opens mission creation flow. Minimal required fields for DRAFT:
- Name
- Inspection (template selection)
- Drone profile
- All other configuration pre-filled from templates
- Before trajectory computation: operator must provide takeoff/landing waypoint (can be the same point)

**Empty State:** Same pattern as empty airport list — "No Missions Available"

**Click Row:** Opens Missions Overview tab with that mission selected

---

### Page 06 — Missions Map (Full Map View)

**Route:** `/operator-center/missions/:id/map`
**Tab:** Overview | Configuration | **Map** | Validation & Export

**Toolbar:**
- Undo / Redo (waypoint edits only, max 10, per-session, resets on param/AGL changes)
- Save (manual save only)
- "Saved Status Last Updated" timestamp
- Recompute Trajectory button: replaces "Save & Validate", triggers save + recomputation. Grayed out / not clickable when no changes made and trajectory is current. If saved but validation not current: exclamation mark + note in saved status area.
- Validate Trajectory button: visible only when a flight plan exists. Disabled while there are dirty waypoint edits or `has_unsaved_map_changes` is set (those require Recompute). Calls `POST /api/v1/missions/{id}/revalidate` — re-runs the safety pipeline against the persisted plan, replaces the prior `ValidationResult`, and surfaces refreshed warnings/violations. Waypoint UUIDs and positions stay byte-identical.

**Left Panel:**
- Layers (same as overview + mission-specific: waypoint path, waypoints by type/inspection, transit segments)
- Inspection Select: dropdown with checkboxes — filters which inspections' waypoints are visible and editable. "Select All" button included. Selecting a single inspection in the list draws a blue ring around its measurement waypoints on the map (registered in the `trajectory` layer group, hidden by the trajectory toggle).
- Waypoint List: scrollable table. Single click → show waypoint info + highlight on map. Double click → map flies/centers to that waypoint. Measurement bundles collapse into one row labeled `Inspection N (count)` using the same 1-based index painted on the map; bundles break on `inspection_id` change so each row maps 1:1 to an inspection. Recording-bookend MEASUREMENTs stay inside the bundle and render with a play/stop icon + "Recording start/stop" row label when expanded.
- Waypoint Info panel (`PoiInfoPanel`): lat, lon, alt, speed, heading, action, type, inspection reference, camera heading. Read-only. Lat/lon shown at 9 dp; coordinate and altitude readouts are click-to-copy (copies the raw number, no units). Altitude row reads `X.X m MSL / Y.Y m AGL` when AGL is known (camera-target block likewise). For recording-bookend MEASUREMENTs (`camera_action = RECORDING_START` / `RECORDING_STOP`) the Type row reads `Measurement - Recording start/stop` and the Hover-duration row surfaces the recording dwell. The stacked variant (vertical profile column) drops Type / Camera Action / Hover Duration and renders altitude + gimbal pitch as ranges (`100.00 → 140.00 m MSL`, `-7.9° → -3.3°`) inside the coords block.

**Right Panel:**
- Legend
- Warnings: same content as Overview (severity-grouped, collapsible sections). When a warning row is obstacle/waypoint-based: clicking shows waypoint info, highlights every affected waypoint on the map, and the detail panel header reads "Violation Details" / "Warning Details" / "Suggestion Details" with a severity-tinted title border.
- Estimated Stats / Summary: duplicate of overview but reacts to which inspections are currently selected in dropdown.

**Map Controls:** Select, Move, Measure Distance, Zoom, Zoom Reset, Add START waypoint, Add END waypoint. There is no separate Pan tool — empty-canvas drag pans the map under any tool, and Move is a superset of Select (click-to-select + edit + pan).

**Waypoint Editing Workflow — NOT YET IMPLEMENTED (future work):**
- **Toggle modes:** Camera edit mode vs. Waypoint edit mode
  - **Waypoint mode:** user can move waypoints on map, hover over line between two waypoints shows "+" to insert a new transit waypoint between them
  - **Camera mode:** user can edit camera heading target points for each waypoint. All waypoints have camera heading points (for PAPI: the LHA center point). This requires adding a `cameraTarget` field to the Waypoint entity.
- **Operator restrictions:** Can only add TRANSIT waypoints between existing ones. Cannot add MEASUREMENT waypoints. Can change waypoint density for measurement and arc radius (ANGULAR_SWEEP) / climb angle bookends `angle_start` / `angle_end` (VERTICAL_PROFILE) — these are overrides from the config.
- **START/END waypoints:** User places on map → writes to `MissionConfiguration.takeoffCoordinate` / `landingCoordinate`. Also visible in Configuration tab (coordinates only, editable there too). Can use same point for both. Automatically connects to first/last waypoint.
- **Waypoint deletion:** Click waypoint once → delete button appears. On deletion: previous and next waypoints relink (linked list behavior).
- **Type changes:** Only TRANSIT can be added by operator. Operator cannot change MEASUREMENT, START, or END types. This keeps thesis scope manageable.

**Current implementation:** Map is read-only for waypoints. Takeoff/landing coordinates set via CoordinateInput fields or pick-on-map in Configuration tab. Waypoint selection (click) shows details in PoiInfoPanel (read-only; coordinate/altitude readouts are click-to-copy). No drag/add/delete of waypoints on map.

**Status effects:** ANY manual waypoint edit (add, move, delete, change) sets mission status back to PLANNED (invalidates VALIDATED status). User must revalidate.

**Map Layers Detail:**
- Runway geometry: polygon
- Safety zones: colored polygons with labels, color-coded by SafetyZoneType. 2D: polygons only. 3D: objects with opacity.
- Obstacles: point + height + bufferRadius (cylinder in 3D, circle in 2D), color-coded by ObstacleType with per-type icons (triangle/tower/antenna/tree)
- AGL targets: rounded square markers (#e91e90), LHA units as smaller circles
- Waypoint path: solid polyline colored by segment type, with repeating chevron direction arrows every ~80px along each segment (`symbol-placement: "line"`)
  - Transit/takeoff/landing segments: solid blue (#7eb8e5)
  - Measurement segments: solid, colored by inspection (5 fixed colors cycling for inspections 1-5)
  - Camera target lines: dashed white from measurement waypoints to camera_target position
- Waypoints: numbered circles, color-coded by type — green (#3bbb3b) for MEASUREMENT, white with gray stroke for TRANSIT, blue square (T) for TAKEOFF, red square (L) for LANDING, orange circle with pause bars for HOVER. Vertical stacks collapsed with x-count label. Recording-bookend MEASUREMENTs (first/last of a video pass — `camera_action = RECORDING_START` / `RECORDING_STOP`) get an extra orange ring around the green dot to mark the recording seam. The simplified-trajectory view paints the same seam waypoints as a green measurement dot (no orange affordance — the simplified view is for "where the measurement nodes are", not seam editing).
- Takeoff/landing markers + their legs only render for `FULL` (or absent) `flight_plan_scope`. The backend omits TAKEOFF/LANDING waypoints for `MEASUREMENTS_ONLY` / `NO_TAKEOFF_LANDING`, and the T/L symbol layers are hidden for non-`FULL` scopes so 2D and 3D stay consistent.
- LHA arc center point: different color and icon, measurement waypoints point at it and connected to it
- **Overlapping path separation:** when two segments share the same ground path (e.g. transit to inspection and transit from inspection), both are offset ~5m to the left of their heading direction via arc midpoints — opposing directions naturally split apart, making both paths and their arrows visible
- **NOT YET IMPLEMENTED:** Simplified trajectory toggle (Bezier curve), waypoint editing on map, undo/redo

**3D View (Cesium):**
- Separate viewer toggled from `MapControlsToolbar` (2D / 3D pill); persists across tab switches.
- User can orbit, pan, and zoom freely; altitude is shown natively (no separate elevation panel).
- 3D safety zones and obstacles render with opacity; obstacles as cylinders, surfaces as draped polygons.
- Trajectory polyline + waypoint markers + camera-target lines mirror the 2D layers, sampled per-WP against world terrain.
- The 3D pipeline never synthesizes takeoff/landing geometry from `mission.takeoff_coordinate` / `mission.landing_coordinate`; both surviving scopes (airborne `FULL` and `MEASUREMENTS_ONLY`) carry no ground TAKEOFF/LANDING waypoints, so 2D and 3D both render only what the backend emits.
- **Fly-along playback** (visible only in 3D once a flight plan exists): play / pause / stop buttons plus a 1×/2×/4×/8× speed selector and a progress bar in the toolbar. Drone .glb glides smoothly along the trajectory (driven by Cesium's clock + a sampled position property), yawing toward `camera_target` during HR / VP / HPL / MEHT measurements and toward travel direction on transit / takeoff / landing / inspection-exit segments. Pitch interpolates between adjacent `gimbal_pitch` values. The camera is free during playback — fly-along never moves it. Auto-stops on switching back to 2D, on flight-plan reload, and on unmount.
- Waypoint editing: 2D only. 3D is for visualization.
- **NOT YET IMPLEMENTED:** waypoint height editing (line with draggable dot for up/down movement).

**Map Interaction:**
- Scroll wheel: zoom
- Empty-canvas left click + drag pans the map under any active tool. OR right button held = pan.
- Middle mouse button held: change 3D pitch/bearing view (MapLibre tilt)
- WASD / arrow keys: pan map (80px step)
- Click waypoint: highlight ring + show info in PoiInfoPanel
- Click map feature (surface, obstacle, zone, AGL, LHA): show info in PoiInfoPanel (the single feature-info panel for every clicked feature, waypoints included)
- Click empty area: deselect
- Double-click any feature (waypoint, surface, obstacle, zone, AGL, LHA): selects and recenters the camera on it. Works the same in 2D MapLibre and 3D Cesium, and from the side list panels (single click = select, double click = recenter).
- **NOT YET IMPLEMENTED:** hover line "+" to add transit waypoint

**Recompute Trajectory Logic:**
- When triggered from Config tab ("Compute Trajectory"): full 5-phase pipeline, regenerates ALL waypoints from scratch (`POST /api/v1/missions/{id}/generate-trajectory`)
- When triggered from Map tab ("Recompute Trajectory") after config changes (framerate, drone change): full recomputation needed because density/constraints change
- When triggered from Map tab after waypoint-only edits (move, add transit point): VALIDATE only — runs SafetyValidator on current waypoints without regenerating. Does not overwrite manual edits. ("Validate Trajectory" button → `POST /api/v1/missions/{id}/revalidate`)
- When config changes NOT connected to trajectory geometry are made: validate only

---

### Page 07 — Missions Configuration

**Route:** `/operator-center/missions/:id/configuration`
**Tab:** Overview | **Configuration** | Map | Validation & Export

**Left Panel:**
- **Edit controls lock when the mission is MEASURED or terminal (COMPLETED/CANCELLED).** Reorder, add/remove inspection, and the config inputs all go read-only (`canModify` off). For MEASURED this mirrors the backend lock — editing the plan after the footage was scored against the planned LHA ground truth would orphan the measurement, so the UI blocks it rather than eating a 409.
- **Inspection numbered list:** Reorderable (changes `sequenceOrder` = physical flight sequence). Checkboxes for selection. "Add Inspection" button opens list of available inspection templates for this airport.
- When inspection selected: shows configuration parameters for that inspection. When none selected: shows whole mission config and overrides.
- **Inspection configuration parameters (per selected inspection):** altitudeOffset (m), speedOverride (m/s), measurementDensity (pts), customTolerances (°), hoverDuration (s). All with units and valid ranges from drone profile limits.
- **Inline warning** for `isSpeedCompatibleWithFrameRate()` when speed override is too high
- **VERTICAL_PROFILE angle source (per inspection):** a `PAPI / CUSTOM` `ToggleGroup` selects how the climb bookends are resolved (persists to `inspection_configuration.angle_source`).
  - **PAPI** — two offset inputs: `angle_offset_below` (subtracted from `min(setting_angles)`) and `angle_offset_above` (added to `max(setting_angles)`). Disabled with an inline message when any selected LHA is missing `setting_angle`; saving in PAPI mode without all setting angles returns 422.
  - **CUSTOM** — two angle inputs `angle_start` / `angle_end`, both constrained to `[1.0°, 16.5°]`. Inline error when `angle_start >= angle_end` (rejected by the schema-level `model_validator`); empty inputs fall back to the legacy `1.9°` / `6.5°` defaults.
  - A read-only "Climb scans X° - Y°" preview line shows the resolved effective range under both modes.
- **AGL targets for selected inspection:** the LHA selection block starts collapsed under a clickable header (chevron toggles open/closed). When expanded, for each AGL the inspection targets, a four-mode segmented toggle (`LhaSelectionModeToggle`) sits above the LHA checkboxes:
  - **All** — every LHA on this AGL.
  - **Range** — `from`/`to` numeric inputs over `sequence_number` (`LhaRangeSelector`); blank bounds are open. Invalid `from > to` is held in a draft state.
  - **From threshold** — `START`/`END` anchor + `distance_m` (`LhaFromThresholdSelector`); only enabled when the parent surface exposes both `threshold_position` and `end_position`. Disabled with a hint when it does not.
  - **Custom** — checkboxes drive `lha_ids` directly (the legacy behaviour).
  Switching mode previews the resolved checkbox set live; saving persists the rule on `inspection_configuration.lha_selection_rules` (per-AGL) and the backend resolver writes the canonical `lha_ids`. Operator still cannot change which AGL system the inspection uses (set by template).
- **Method selection:** Defined by the inspection template (e.g., "PAPI Inspection - Vertical Sweep"). Method is implicit from template type — not a separate dropdown.
- **Method-specific fields:** `FLY_OVER` (height above lights, gimbal angle), `PARALLEL_SIDE_SWEEP` (lateral offset, height above lights), `APPROACH_DESCENT` (descent start distance, glide-slope override), and `SURFACE_SCAN` (the `SurfaceScanFields` block) appear in the main config flow above the direction section, not after the camera-settings block. `FLY_OVER` default gimbal pitch is -70° (forward-down) — operator can override per inspection. `APPROACH_DESCENT` defaults to a 1000 m start distance and the PAPI-derived glide slope; both are operator-overridable per inspection.
- **SURFACE_SCAN fields (`SurfaceScanFields`):** SURFACE_SCAN is AGL-agnostic — it targets an `AirfieldSurface`, so the LHA-selection block is hidden and the **measurement density** + **hover duration** inputs are suppressed (a serpentine snake has no hovers; video dwell rides on the recording bookends). Fields: surface picker (runway/taxiway dropdown), length-mode toggle (`FULL / MAX_LENGTH / INTERVAL`) with `from`/`to` inputs revealed for INTERVAL, a length-anchor toggle (`THRESHOLD / ENDPOINT`, shown only when length mode is not FULL - which runway end the `MAX_LENGTH` cap / `INTERVAL` window is measured from; orthogonal to the direction toggle), scan width + side toggle (`LEFT / RIGHT`, enabled only when a width is set), scan height, camera gimbal, run orientation (`LENGTH_WISE / WIDTH_WISE`), run count (with a computed-optimal hint derived from the drone FOV footprint + sidelap), sidelap percent, and frontlap percent (forward overlap between consecutive photos along each run; drives the PHOTO along-track capture spacing, default 0%). The direction toggle is shown (REVERSED flips the snake start). The method label renders "Surface Scan".
- **PAPI Center Height Reference (per PAPI inspection):** for HORIZONTAL_RANGE / VERTICAL_PROFILE / APPROACH_DESCENT a `PapiCenterHeightSection` (a three-option `Ground / Lens / Custom` segmented toggle matching the camera-mode control) sets where the camera aims relative to the LHA centroid. **Ground** keeps the unchanged default (aim at the centroid at ground level); **Lens** raises the aim altitude by the average surveyed `lens_height_agl_m` of the selected LHAs (falls back to Ground when none are configured); **Custom** reveals a height input (m, floored at 0) and raises the aim by that many meters. Renders through `MethodSpecificSections` (hidden for every other method) and persists to `inspection_configuration.papi_center_height_reference` / `papi_center_height_custom_m`. APPROACH_DESCENT retargets only the camera/gimbal - its descent path stays anchored on the runway touchpoint. EN + SK strings under `mission.config.papiCenterHeight.*`.
- **Drone Selector:** Changing drone invalidates validation status for existing trajectory, triggers warning that validation is not current.
- **Planner toggles (whole-mission config, no inspection selected):** a `Toggle` for "keep inside airport boundary" sits beside the "perpendicular runway crossing" toggle. Default on; persists to `mission.keep_inside_airport_boundary`. When on, the A* transit pathfinder is biased to stay inside the airport-boundary polygon and the boundary-egress warning is armed; when off, neither applies. In TRAJECTORY_FIELDS, so flipping it regresses the mission to DRAFT. Replaced the earlier three-option boundary-preference `<select>`.
- **Flight plan scope picker (whole-mission config):** `FlightPlanScopeSelector` radio group with two options - `FULL` (airborne: transit-altitude bookends, no ground takeoff/landing waypoints) and `MEASUREMENTS_ONLY` (core measurements only). Picks `mission.flight_plan_scope`, which drives backend bookend assembly (see SPEC.md "Phase 5 - Final assembly"). Both options reveal the inline airborne precondition note (`data-testid="airborne-start-note"`) reminding the operator that the drone must already be airborne before the mission starts - hand-launch, fly up, then start the mission. (Pre-#755 there was a third `NO_TAKEOFF_LANDING` option and the legacy `FULL` was a ground-takeoff scope; both were collapsed into the current airborne `FULL`.)
- **Warnings:** Post-computation only. Before trajectory: note that computation is needed.
- **Estimated Stats:** Post-computation only.

**Right Panel:**
- Map Preview + Layers: before generation shows airport + AGL targets. After generation: full trajectory.
- Operator can click AGL targets on map preview to select/deselect LHAs (when inspection is selected). When no inspection selected: whole AGL system shown.
- Waypoint List and Waypoint Info (after trajectory exists)
- Legend

**Compute Trajectory button:** Blocks UI with progress indicator in button. Expected runtime: seconds. Triggers full 5-phase pipeline.

**Edit Waypoints button:** Navigates to Map tab. If unsaved changes exist: triggers save warning dialog.

**Takeoff/Landing:** Visible as coordinates from `MissionConfiguration`. Editable here as coordinate input fields. Also settable on Map tab by placing START/END waypoints.

- The two `CoordinateInput`s are stacked vertically (full-width rows) so long lat/lon/alt floats don't get clipped in the left config panel.
- A "Use takeoff as landing" toggle sits with the coordinate fields. When on, the landing row is unmounted and a single combined `CoordinateInput` labelled "Takeoff and Landing Coordinate" mirrors edits into both `takeoff_coordinate` and `landing_coordinate`; pick-on-map with the toggle on still mirrors via the same path. Flipping the toggle off restores the prior landing value into a remounted row.
- Toggle initial state is derived from the loaded mission via epsilon-based equality on `takeoff_coordinate` vs `landing_coordinate` (`frontend/src/utils/coordinateEquality.ts`), re-derived only when the mission id changes — so the choice persists across reloads with no schema change and the effect doesn't fight a mid-edit toggle flip.

**Missing from wireframe but needed:**
- "Add Inspection" button in the numbered list

---

### Page 08 — Missions Validation & Export

**Route:** `/operator-center/missions/:id/validation-export`
**Tab:** Overview | Configuration | Map | **Validation & Export**

**Header action:**
- **"Upload Drone Media" button** — secondary button with an upload icon in the MissionTabNav action slot. Opens the **Upload Drone Media dialog**, scoped to the current mission: a per-inspection upload form for attaching flown footage to each inspection. The dialog lists the mission's inspections (each labelled `Inspection {order} · {method}`) plus an *Unassigned* bucket, each with a file-count badge. Each inspection group shows its media ordered 1..N (order badge + filename + size) and a **drop-or-browse** zone — dropping or picking video files uploads them straight to object storage via a presigned PUT, then records the row against that inspection. Files can be **reordered** within an inspection by dragging the grip handle and **moved between inspections** (or into *Unassigned*) by dragging across groups (`@dnd-kit`, with a drag preview that follows the cursor). Manual uploads carry a **trash button** that deletes the file and drops its stored object; hub-reported footage has no delete affordance. Inspection assignment and order survive a reload. Empty states: "This mission has no inspections yet. Add an inspection before uploading media." when the mission has no inspections, and "No files yet" per empty group. Reorder/move/delete update the list optimistically, then reconcile against `GET /api/v1/missions/{mission_id}/drone-media`. Load/upload/move/reorder/delete failures surface as an inline error line. A single footer **Confirm** button (rendered once media has loaded, disabled while a kickoff is in flight or when no inspection holds media) fires one measurement per inspection-with-media at once — `Promise.allSettled` over `createMeasurement` (`POST /api/v1/inspections/{inspection_id}/measurement`), skipping empty groups and the *Unassigned* bucket, so a single failure can't abort the rest. It registers the started run ids with the measurement-progress context (the corner progress toast, see Page 15), navigates to the mission's Results tab (`/operator-center/missions/{mission_id}/results`), and closes; if every run fails to start it surfaces an inline error and stays open instead of navigating away. There is no longer a per-inspection measure button or a separate batch button. EN + SK strings under `mission.uploadDroneMediaDialog.*` (incl. `confirm`, `confirmStartError`); button label under `mission.validationExportPage.uploadDroneMedia`. See SPEC.md "Drone media matching + upload dialog" and `docs/specs/FIELD-HUB.md` §5.

**Left Panel:** three stacked collapsible cards — Validation Results & Status, Warnings, Mission Estimated Stats.
- **Validation Results & Status:** Per-constraint breakdown: altitude (pass/fail/warning), speed, geofence, battery, runway buffer, obstacle clearance. Since #215 the card is **expanded by default only while the mission is `PLANNED`** (the active review state) and collapsed by default in every other status; both the body and the Edit Configuration / Accept actions live inside the collapsible region.
- **Warnings:** same severity-grouped content as Overview (Violations / Warnings / Suggestions, collapsible per-section with count badges, rows deduped by `violation_kind`). Since #215 the page threads `missionStatus` into this panel so its top-level collapse follows the same rule as Validation Results — **expanded by default only in `PLANNED`**, collapsed elsewhere. (The Overview and Map call sites omit the prop and keep the legacy always-expanded behavior.)
- **Mission Estimated Stats:** distance, duration, waypoint count, battery %. Since #215 it sits here in the left column **below Warnings** (it previously rode in the right export column via `ExportPanel`'s removed `statsSlot`).
- **Approve collapses both panels:** clicking **Accept** (`PLANNED → VALIDATED`) auto-collapses the Validation Results and Warnings cards in lockstep with a smooth height animation (`grid-rows-[0fr→1fr]`, `motion-reduce` fallback). Both stay user-toggleable.
- **"Edit Configuration" button:** Navigates to Configuration tab
- **"Accept" button:** Sets status to VALIDATED. Not clickable when already VALIDATED. Any changes → status reverts to PLANNED.

**Right Panel:**
- Map Preview + Layers + Waypoint list/info + Legend
- **Export section:**
  - **Field-link status** — since #217 the two-pill field-link chip is no longer on the mission page (it moved to the Field Ops page's `FieldHubPanel`). The mission page now collapses the link state to a single green/red **Online / Offline** dot on the **Send to Drone** button (green when `hub_online`, red otherwise). `ExportPanel` polls `GET /api/v1/field-link/status` every 10 s while mounted (`useFieldLinkStatus`), reads only `status`, and passes it to `ExportFormatSection` for the dot + the dispatch gate. A failed poll degrades to the no-hub state. See SPEC.md "Field-link status chip" and `docs/specs/FIELD-HUB.md` §6.
  - Export Format: single-select dropdown (KML, KMZ, JSON, MAVLink, UgCS, WPML, GPX, Litchi, CSV, DroneDeploy) defaulting to KMZ, styled like the DJI heading-mode picker and carrying a "Format" field label. Since #217 a **`?` info hint** sits next to the "Format" label and composes the selected format's description + capability note (e.g. for KMZ: "DJI WPMZ archive for Pilot 2 and Flight Hub 2. Carries optical zoom per inspection. Set ISO, shutter speed, white balance and focus mode on the controller before flight."); the previously-visible copies of that text below the dropdown were removed — the hint is the single source. One format per export - the download sends a one-element `formats` array. Strings under `mission.validationExportPage.formatLabel` (EN + SK).
  - **Advanced Options** — since #217 the "Include keep-out zones" controls and the DJI heading-mode picker live inside a single **outlined, collapsed-by-default** "Advanced Options" disclosure between the Format dropdown and the Download button. Expand it to reach the two bullets below; collapsed is the common case (a plain KMZ download needs neither).
  - **"Include keep-out zones" checkbox** (in Advanced Options) — bundles airport obstacles + active safety zones into the export. Enabled only when at least one selected format is geozone-capable AND the chosen drone has `supports_geozone_upload=true`. Disabled-state tooltip explains the missing capability (no format / drone incapable / no formats selected). Nested **"Include runway buffers"** child checkbox is **hidden entirely until the "Include keep-out zones" parent is checked** (removed from the DOM, not just greyed out); once shown it stays disabled with a "requires MAVLink" hint until MAVLink is the selected format. Inline note distinguishes enforced formats (MAVLink, JSON, UgCS) from advisory ones (KML, KMZ — DJI Pilot 2 renders but does not enforce). MAVLink output switches from WPL plain text to QGC `.plan` JSON when the parent checkbox is on. See SPEC.md "Geozone bundle option" for the full capability matrix.
  - **"DJI heading mode" select** (in Advanced Options) — three options, labelled "Smooth body tracking" (`smoothTransition`) / "Continuous POI tracking" (`towardPOI`) / "Snap at each waypoint" (`followWayline`). Since #217 the labels dropped their bracketed `(recommended)` / `(experimental)` / `(reliable)` qualifiers — all three modes are validated. Visible only when at least one of `KMZ` / `WPML` is selected AND `activeDroneProfile.manufacturer === 'DJI'`. Pre-fills from `mission.dji_heading_mode` (which defaults to `towardPOI` for new missions since #217); the export endpoint accepts the choice as `dji_heading_mode_override` and writes it back so the picker pre-fills with the operator's last choice on the next export. A `?` info hint beside the label explains each mode. Hidden otherwise — the field is irrelevant to non-DJI generators. See SPEC.md "DJI heading mode picker" for resolution + persistence semantics.
  - **WPML enum-fallback confirm modal** — when the operator triggers a KMZ or WPML download and the mission's drone is not in the `DJI_WPML_ENUMS` table (`activeDroneProfile.supports_dji_wpml === false`), ExportPanel intercepts the click and surfaces a modal warning that the file will be tagged with the Matrice 4T fallback enum. Three body variants by drone category: unmapped DJI ("firmware still flies correctly, preview may show the wrong aircraft icon"), non-DJI ("file is generated for archival but the aircraft cannot read it — consider LITCHI or KML instead"), no drone configured ("assign a drone before flight"). "Continue" replays the pending export; "Cancel" dismisses without downloading. Mapped DJI drones (Matrice 4T, Matrice 300 RTK, Matrice 350 RTK, Mavic 3 Enterprise) export silently. See SPEC.md "DJI WPML drone enum table + M4T fallback" for the full enum table.
  - **Export-failure toast surfaces the real backend reason.** The mission-validation hook extracts `response.data.detail` (string or `{message}` object) from the DomainError body and shows it directly in the toast; the generic "Failed to export mission" line fires only when the response carried no usable message. So messages like "mission must be VALIDATED, EXPORTED, or MEASURED to export" or "no flight plan found for this mission" now reach the operator instead of being swallowed.
  - **DJI altitude clamp warning card** — when a KMZ/WPML export contains placemarks whose MSL sits below the takeoff reference, the backend refuses with `409 + {altitude_clamps: [...]}` and `ExportPanel` renders an `AltitudeClampWarning` panel: per-waypoint table of `waypoint_index / intended_alt / clamped_alt` plus an "I understand the altitudes will be clamped" checkbox. The Download button is disabled until the checkbox is ticked; ticking re-fires the export with `acknowledge_altitude_clamps: true`. A fresh 409 with a new clamp list resets the acknowledgment (the operator cannot silently re-confirm a different set), and dismissing the warning clears it entirely. EN + SK strings live under `mission.validationExportPage.altitudeClamp.*`. See SPEC.md "DJI altitude clamp acknowledgment" for the full server-side contract.
  - "Download Export": direct browser download
  - **Export grayed out / disabled** until the plan reaches VALIDATED; it stays enabled through EXPORTED and MEASURED (re-download a measured mission's plan) and is disabled again in the terminal COMPLETED / CANCELLED states. Shows a "Validate mission to export" badge (reworded in #217) while still pre-validation
  - **Send to Drone button** — since #217 there is no separate Send to Drone *card*; a **Send to Drone** button renders directly **under Download Export** in the same export section, with a **centered** label and a green/red **Online / Offline** dot (driven by the shared `useFieldLinkStatus` poll). It pushes the mission KMZ into the field hub's wayline library so DJI Pilot 2 picks it up in its route list (`POST /api/v1/missions/{id}/dispatch`). `ExportPanel` builds the dispatch payload from the **same** `buildExportOptions()` as the download, so the dispatched KMZ matches a download of the same config (geozones + heading mode included). The button is disabled only while the hub is unreachable (tooltip "Field hub not connected") or status is outside VALIDATED/EXPORTED/MEASURED — **not** when a drone is offline, so waylines can be staged before the aircraft is up. Sending shows a spinner; success shows "Mission sent – it will appear in Pilot's route library"; failure surfaces the backend `detail` message inline. A DJI altitude-clamp 409 shows a warning line and relabels the button "Acknowledge clamps and send" — clicking again re-fires the dispatch with `acknowledge_altitude_clamps: true`. The page refetches after a successful dispatch (a first dispatch from VALIDATED side-effects VALIDATED → EXPORTED; a measured mission stays MEASURED); re-dispatch from EXPORTED or MEASURED updates the same wayline in place. EN + SK strings under `mission.sendToDrone.*`. See SPEC.md "Send to drone (mission dispatch)" and `docs/specs/FIELD-HUB.md` §4.2.
- **Field hub configuration moved off this page (#217)** — the *Field Hub* connection dialog (connect address, QR, CA-cert download, full link-signal panel) is no longer reachable from the mission page. That config now lives only on the **Field Ops** page as the `FieldHubPanel` left card. See WIREFRAME Field Ops page + SPEC.md "Field hub connection panel".
- **Complete / Cancel / Delete:**
  - Complete: sets COMPLETED (terminal state). Available only once MEASURED. Disabled tooltip: requires the mission be measured.
  - Cancel: sets CANCELLED (terminal state). Available from any non-terminal status (DRAFT through MEASURED), routed through the confirm-warning modal. Disabled tooltip: "already completed or cancelled".
  - Delete: removes from database entirely. Available at any status (terminal states included). Routed through the confirm-warning modal.
  - Complete is grayed out / disabled until MEASURED; Cancel is grayed out only in the terminal states; Delete is never grayed out.

**Status gating summary:**
- DRAFT/PLANNED: Accept button available. Export grayed out. Complete grayed out. Cancel available. Delete available.
- VALIDATED: Accept not clickable. Export available. Complete grayed out. Cancel available. Delete available.
- EXPORTED: Accept not clickable. Export available. Complete grayed out. Cancel available. Delete available.
- MEASURED: Accept not clickable. Export grayed out. Complete available. Cancel available. Delete available. Config edit controls locked (see Page 07).
- COMPLETED/CANCELLED: Accept/Export/Complete/Cancel all disabled (terminal states). Delete stays available.

**No export history:** Each export is a one-time download. Previous exports are not stored.

**Status transitions on changes:**
- Waypoint edits (move, add, delete) → status back to PLANNED
- Config changes (drone, framerate-related) → status back to PLANNED
- Accepting → VALIDATED
- Exporting → EXPORTED

---

### Page 09 — Airport Page (Operator View)

**Route:** `/operator-center/airport`

**Purpose:** Read-only view of the entire airport with all infrastructure

**Content:**
- Map showing: runway and taxiway polygons (ground surfaces), all AGL systems, all safety zones, all obstacles
- Left panel: Ground Surfaces list, AGL systems/Points of Interest list
- Every DB-stored object is clickable → shows info in PoI panel
- Single click (map or list) selects without moving the camera; double click selects and recenters. Same convention in 2D and 3D viewers.
- Legend, Layers

**Strictly read-only for Operator.** No editing capability.

---

### Page 10 — Configurator: Airport Editing (Coordinator)

**Route:** `/coordinator-center/airports/:id`

**Nav:** TarmacView Configurator Center | Mission Center | **Airports** | Inspections | Drones | Selected Airport | Username

**Left Panel — collapsible sections:**
- **Ground Surfaces:** Type selector (RUNWAY / TAXIWAY). CRUD for all surfaces. Paired RUNWAY rows render adjacent (lower identifier first) with a single chain icon spanning their boundary; the same `pairAwareSurfaceOrder` helper backs both the coordinator panel and the operator-side `GroundSurfacesPanel`. Map labels collapse paired runways to `RWY 01/19` (driven by the MapLibre `identifier_label` property emitted from `pairedRunwayLabel`); the planner still sees both surfaces. The heading field — creation-form prefill from the drawn centerline, plus the compass arrow + opposite-flip widget (e.g. 135° → 315°) in the feature editor and map POI info — renders for both types; taxiways always have a value because the backend derives a missing heading from the centerline on create and on geometry edits (see SPEC.md `airfield_surface`).
- **Obstacles:** CRUD. Point + height + bufferRadius. Types from ObstacleType enum.
- **Safety Zones:** CRUD. Polygon geometry. Types from SafetyZoneType enum.
- **AGL and LHA:** CRUD. Create AGL → name it → add LHAs by clicking "Add LHA" → place on map or enter coordinates.

**Map (EDITABLE):**
- Drawing tools: polygons (click to add corners, right-click to finish), circles with radius, rectangles, point placement
- Coordinate entry: alternative to drawing — enter coordinates and click "add point to polygon" or "delete existing point"
- Vertex dragging on existing polygons
- GeoJSON text editing for all geometries (both visual and text editing available)
- Undo/Redo + Save (same pattern as mission map)

**PAPI creation workflow:** Coordinator clicks "Create New AGL" → names it → adds LHAs one by one (click "Add LHA" → place on map or enter coordinates). PAPI has exactly 4 LHAs but coordinator is not software-limited (specialist knowledge assumed).

**Pair-link affordances (RUNWAY surfaces):** `EditableFeatureInfo` exposes a `PairSurfaceSection` with three actions — **Create reverse direction** (derives the reciprocal identifier, e.g. 01↔19, 09L↔27R, C stays C, with optional override and auto-couples), **Pair with…** (couple to an existing reciprocal RUNWAY; the primary side overwrites the secondary's geometry), **Decouple** (clears the pair link on both sides; geometry stays as-is). After every pair-write the section re-syncs from the freshly-fetched airport so the new state appears without a second click. Identifier rename is rejected while coupled. Surface delete confirm names the partner and the combined AGL count.

**LHA sequence + reorder:** Each LHA has a per-AGL `sequence_number` (1..N, dense). `EditableFeatureInfo` shows a numeric `Sequence #` input bounded `[1, count]` for non-PAPI LHAs; editing it shifts neighbours by ±1 in a single transaction. For PAPI parents the numeric input is hidden and the unit-designator dropdown acts as the sequence control — picking a letter submits the matching `sequence_number` and the backend relabels surviving siblings (project convention: 1=A, 2=B, 3=C, 4=D, closest-to-runway is D=seq 4). The dropdown only offers as many letters as the AGL has lights (capped at the PAPI max of 4): a 3-light AGL shows A/B/C, a full 4-light PAPI shows A/B/C/D, mirroring how the non-PAPI numeric input caps with `max={count}` so a picked letter can never submit a `sequence_number` past the backend's `1..N` range (#99/#105). A stored `sequence_number` already beyond the current light count has no matching option, so the controlled `<select>` falls back to the first letter (the same accepted edge as the non-PAPI numeric input). `CoordinatorAGLPanel` lists LHAs sorted by `sequence_number` and prefixes each row with `#n`. Out-of-range or partially-typed values are held in a draft state until valid; PoiInfoPanel for an LHA also surfaces the `#n` prefix.

**Click-to-locate:** map and side list panels follow the unified pattern — single click selects (no camera move), double click selects and recenters. Same in 2D and 3D viewers.

**Entity altitude auto-fill (DEM-derived):**
- Point entities (AGL, LHA, obstacle-from-circle) render an editable **Altitude** input in `CreationForm`. The DEM-resolve state/effects live in the `useResolvedAltitude` hook (`hooks/useResolvedAltitude.ts`), which the form drives with an `ElevationResolver` from `useElevationResolver(airportId)`; as soon as the position is known it prefills the value. The resolver returning `null` drops to `airport.elevation` and renders an `(fallback)` annotation next to the input. Once the coordinator types into the input, `userEditedAlt` freezes the field so later marker drags or resolver responses cannot overwrite it. A request-id guard makes the effect last-write-wins on rapid re-clicks. The form's `data.altitude` flows into `createAGL` / `createLHA` / `createObstacle` (no longer stamped from the page).
- Polygon entities (runway, taxiway, safety zone, obstacle-polygon) skip the input and resolve elevation **per vertex at submit time** via `resolveRingZ`. Per-vertex resolver failures fall back to `airport.elevation` without aborting the submit; both the boundary polygon and the derived centerline carry per-vertex Z.
- Runway touchpoint altitude auto-fills via `resolvePointAltitude` when `data.touchpoint_altitude` is null/undefined but lat/lon are set. Coordinator-entered values still win.
- FLAT-mode airports (no DEM source) are byte-identical to the pre-DEM behavior because `fetchElevationAt` returns `airport.elevation` for them.

**Runway threshold / endpoint picker (creation):**
- After a runway polygon is drawn, `CreationForm` renders a single bordered **Threshold / Endpoint** subsection above the standard fields. Both vertices are editable lat/lon/alt inputs seeded from the derived centerline endpoints (exposed by `useEntityCreation` as `centerlineEndpoints`), free-form thereafter. An InfoHint sits in the section header; a **Swap** toggle flips which drawn vertex is the threshold (default: vertex 0). A pick-on-map button lets the coordinator drop either endpoint with a click — the active pick state lives in `useMapPickingTools` (`pickingThreshold` / `pickingEnd`) which also renders the colored preview dot on the map.
- On submit, the form emits `threshold_position` / `end_position` as `POINT Z (lon lat alt)` WKT alongside `geometry` / `boundary` / `touchpoint_*`. The backend `SurfaceCreate` schema already accepts both, and the pair-swap path mirrors them on reverse-runway creation. Taxiway creation does not show the subsection.
- The same section shape lives in the feature-info edit panel (`ThresholdEndSection`) for an existing runway: one bordered container holding both `PositionBlock` children (rendered with the `nested` prop so the outer card chrome and `uppercase tracking-wide` label are stripped), with the section header carrying the swap button.

**Surface / AGL identifier autofill:**
- Surface autofill is a plain numeric counter — the `RWY ` / `TWY ` literal prefix is no longer prepended. AGL autofill still keeps the surface identifier in the name (e.g. `REL RWY 09L`, `PAPI 06/24`).

**AGL distance-from-threshold prefill (live):**
- When an AGL creation is opened on a runway that exposes both `threshold_position` and `end_position`, `useCreationFormState` recomputes the **Distance from Threshold** input from the live lat/lon/surface via `utils/aglDistance.ts` (a TS port of `_along_runway_distance_from_threshold`: equirectangular projection with cosine-latitude correction, parity-pinned to the Python helper within `1e-6 m`). The field stays editable; an operator edit freezes it from later auto-prefills (same `userEditedAlt`-style shape as `useResolvedAltitude`). Backend auto-compute on `create_agl` is unchanged — this is a UX preview that happens to match what the backend persists.

**Image position-metadata extractor (read-only seed):**
- An **Extract from image** tool on `MapDrawingToolbar` opens `ImageMetadataExtractorModal`. The coordinator adds drone photos (file picker + drag-and-drop); the backend parses per-image GPS lat/lon/alt from EXIF GPS tags plus the DJI XMP packet (DJI keeps its higher-precision `AbsoluteAltitude` outside EXIF) and returns per-image coordinates. Images with no GPS are listed in the review list without failing the batch. The extractor never writes to the DB - it hands the coordinate(s)/geometry to the existing creation panel pre-filled via `useEntityCreation.beginExtractorHandoff`.
- The dialog adapts the target-type choices to the count of geotagged points (n): 1 → AGL system / AGL unit (LHA); 2 → AGL units (LHAs); 3 → AGL units / obstacle; 4+ → surface (runway) / obstacle / AGL units. Touchpoint / threshold / runway-endpoint are intentionally not standalone targets — they are sub-fields set during surface creation, so a runway handoff seeds the polygon into the existing surface-creation flow.
- For polygon targets (obstacle / runway), vertices are auto-ordered into a non-self-intersecting ring (polar angle around the centroid, `utils/orderPolygonRing.ts`) and can be manually reordered in the dialog — a manual reorder is preserved on confirm (the ring is only closed, not re-sorted).
- Endpoint `POST /api/v1/airports/{airport_id}/extract-photo-metadata` (multipart, coordinator-gated via `check_airport_access`, no audit row, caps at 50 images / 50 MB each). A `403` shows a distinct "no access to this airport" message; generic parse failures keep the generic message.

**PAPI lens height (LHA fields):**
- Two nullable lens-height fields ride on the LHA create form (`creationFields/LhaFields`) and the feature editor (`featureInfo/LhaFields`) for PAPI units only: `lens_height_msl_m` (raw EXIF absolute altitude, MSL) and `lens_height_agl_m` (MSL minus DEM terrain). Both are editable before save; the extractor pre-fills them on an LHA handoff. AGL is derived only when a real DEM backs the airport — on a flat airport AGL stays null and the coordinator enters it by hand (the flat airport elevation must not stand in for surveyed ground).
- The read-only feature-info panel (`PoiInfoPanel` → `overlays/poi/LhaInfoPanel`) also surfaces both surveyed lens heights (AGL + MSL) when a PAPI LHA is clicked, each row hidden when its value is null (non-PAPI / unconfigured units show neither).

**PAPI glide-slope tolerance (AGL fields):**
- A PAPI-only `glide_slope_angle_tolerance` number input rides on both `AglFields` (the AGL creation form `creationFields/AglFields` and the feature editor `featureInfo/AglFields`), right beside the existing `glide_slope_angle`. It is the results-time verdict band (degrees, default 0.1, `gt 0`) for the measured glidepath, ground truth set by the coordinator — not a per-inspection operator setting. Hidden for edge-lights AGLs and nulled on a PAPI → edge-lights switch. Writes inherit the coordinator-gated `PUT/POST .../agls` routes, so operators cannot change it. Wired through `useCreationFormState` / `CreationForm`.

---

### Page 11 — Configurator: Airport List (Coordinator)

**Route:** `/coordinator-center/airports`

**Same pattern as Mission List:** search, filters, columns, sorting, pagination, List Item Action Pattern

**"Add New" minimal fields:** ICAO code, name, coordinates, elevation

**Creation assignment (no silent orphans):** when a **coordinator** creates an airport it is auto-assigned to that coordinator, so the new airport is immediately visible and usable to its creator. A **super admin** creates airports unassigned by design — super admins bypass the airport-access check, so they can use any airport, but coordinators/operators see nothing until a coordinator is assigned. To keep these unassigned airports from going unnoticed, the super-admin airports list flags any airport with **zero coordinators** as `Unassigned` (warning-toned badge) and offers an `Unassigned only` filter plus an `Operators` count column; the super-admin airport-detail page shows the same warning banner and an in-place add-coordinator affordance (`AirportAssignedUsersPanel`). The super-admin user-detail page mirrors this from the user side (`UserAssignedAirportsPanel`): same panel affordances (count badge, empty state, accessible remove control), each assigned airport deep-links to its airport-detail page, and the add-airport dropdown lists every airport, orphaned ones included. Both directions share one write path and emit the same `ASSIGN_AIRPORT` audit row. An airport with no coordinator is "orphaned" — invisible to coordinators and returning `403 no access to this airport` on every airport-scoped action for them.

---

### Page 12 — Configurator: Inspections (Coordinator)

**Route:** `/coordinator-center/inspections/:id`

**Purpose:** Coordinator creates and edits inspection TEMPLATES (reusable). Operators use these templates and can override parameters per mission.

**Content:**
- AGL system selector: one AGL system per inspection template. Coordinator selects which AGL.
- LHA selection (per AGL via `TemplateAglSection`): four-mode segmented toggle (All / Range / From-threshold / Custom) above the checkbox grid. Same modes and validation as Page 07 (see "AGL targets for selected inspection"); the chosen rule is persisted to `inspection_configuration.lha_selection_rules` on the template's default config and resolved into `lha_ids` at save time. The selection re-seeds from the template's targets when the AGL list loads, but freezes once the coordinator edits it — a same-template autosave refetch no longer clobbers a manual selection (same `userEditedAlt`-style freeze used by the Page 10 creation forms).
- Create-template dialog (`CreateTemplateDialog`, reached from "Add New"): the template **name** auto-suggests from the chosen method (and AGL when the method needs one), but the suggestion freezes the moment the coordinator types into the name field, so changing method/AGL afterwards no longer overwrites a custom name. Reopening the dialog re-enables the suggestion.
- Inspection configuration parameters: DEFAULT values (altitudeOffset, speedOverride, measurementDensity, customTolerances, hoverDuration). Operator can override per mission.
- Method selection: set in inspection configuration (ANGULAR_SWEEP or VERTICAL_PROFILE)
- Map preview: shows the AGL targets the coordinator has selected, highlighted on the airport map
- PoI Info panel (NOT waypoint list — templates have no waypoints)

**Templates are airport-specific** — tied to that airport's AGL systems.

**Inspection template list page (missing from wireframe, needs to be added):** Same pattern as other lists — search, filters, list, add new. "Add New" also available as first item in dropdown.

**Constraints:** Auto-derived from drone profile + safety zones. Coordinator does NOT define custom constraints. Kept out of thesis scope.

**Coordinator also defines:** the inspection template name, description, default parameters. No edit waypoints functionality on coordinator pages.

---

### Page 13 — Configurator: Drones (Coordinator)

**Route:** `/coordinator-center/drones/:id`

**Drone Profile Fields:** name, maxAltitude, maxSpeed, batteryCapacity, maxFlightTime, maxPayload, sensorFOV, cameraFrameRate (all with units and validation)

**Actions:**
- Add: new from scratch
- Duplicate: creates copy with "(Copy)" suffix
- Delete: allowed even if referenced by missions — shows warning with list of affected missions. Confirmation dialog required.

**Drone list page:** search, filters (Drone Search, Drone Filters), list, "Add New", "Duplicate", "Delete" buttons. List Item Action Pattern applies.

---

### Page 14 — Configurator: Inspection List (Coordinator) — MISSING WIREFRAME

**Route:** `/coordinator-center/inspections`

**Needed:** Same pattern as airport list and drone list. Search, filters, list, Add New. First item in dropdown is also "Add New." List Item Action Pattern applies.

---

### Page 15/16 — Results: Mission Results Tab (Operator)

**Route:** `/operator-center/missions/{id}/results` — a `MissionResultsPage` rendered through the `MissionTabNav` shell, the fifth mission tab after **Validation & Export**. Inherits the normal (non-compact) mission selector, the disabled Save pill + Saved-timestamp, and the left-panel portal automatically.

Results moved out of the old airport-wide list + per-run detail pages and into the mission they belong to. The old `/operator-center/measurements` and `/operator-center/measurements/{measurementId}/results` routes now **redirect**: the list route to `/operator-center/missions`, the detail route via `MeasurementResultsRedirect`, which resolves the run's owning mission off `listAirportMeasurements(airportId)` and navigates to `…/missions/{mission_id}/results?inspection={inspection_id}` (or falls back to the missions list when the run / airport can't be resolved).

**Source:** one new read-only endpoint `getMissionResults(missionId)` → `GET /api/v1/missions/{mission_id}/results` (`MissionResults`) backs the protocol overview. `listAirportMeasurements(airportId)` filtered client-side to the current mission maps each inspection → its **latest** run (the API returns newest-first, so the first row seen per `inspection_id` wins). `listInspectionTemplates({ airport_id })` backs the picker row names. `getMeasurementResults(id)` loads the selected inspection's pivoted per-frame payload (drill-down). `downloadMeasurementReport(id)` backs the header PDF button.

**Header (MissionTabNav action slot):** a **Save** pill + Saved-timestamp copied for visual parity with the other tabs but permanently disabled (nothing is saved here), and a real **Download PDF Report** button (`secondary` compute-context with a `FileText` icon) targeting the drilled-down run — **enabled only inside a drill-down**, disabled in the overview since a mission-scale PDF is an explicit non-goal.

**Left panel** (`ResultsLeftPanel`) — a stack of `--tv-*` cards:
1. **Inspection picker** (`InspectionPicker`, adapted from the Configuration `InspectionList`) — a collapsible, single-select list of **all** the mission's inspections, sorted by `sequence_order`, each row carrying a sequence badge, the template name, a method badge, and a **result tag**: a DONE run shows the `MeasurementStatusChip` plus a `pass/total` rollup, an in-progress run shows its status chip, an un-measured inspection shows a muted "Not measured" tag and renders **disabled** (`aria-disabled`, not clickable). Clicking a DONE row selects it; clicking the selected row deselects.
2. **Inspection Info panel** (`InspectionInfoPanel`, mirroring `MissionInfoPanel`) — a collapsible 2-col cell grid shown once results load: method, sequence order, runway heading, processed date, the `MeasurementStatusChip`, the **overall verdict** pill (`PASS` unless a scored light failed, `FAIL` on any fail, `Pending` until something is scored), and the **glide-path angle** (midpoint of PAPI_B's upper transition + PAPI_C's lower transition; "Not available" when either edge is missing).
3. **Glide-slope tolerance card** (`GlideSlopeToleranceCard`, `results-glide-slope-tolerance`) — measured glidepath (mid of `PAPI_B.transition_angle_max` / `PAPI_C.transition_angle_min`, `toFixed(2)`) beside the snapshotted configured glide slope ± tolerance (`configured ± tolerance`, both `toFixed(2)`), under a full-width status pill: **OK** (within tolerance), **out-of-tolerance**, or **unavailable** (`—` placeholders + the unknown tone) until a usable run resolves both the measured value and the verdict. Tones reuse `VERDICT_CLASS` (ok=pass, out=fail, unavailable=unknown). Configured angle + tolerance show even before DONE; measured + verdict fill in once the run completes.
4. **Per LHA verdict** (`results-per-lha`) — one row per light in `lights[]` (renamed + generalized from the old PAPI-only list), each showing measured vs `setting_angle ± tolerance` and a pass/fail/neutral icon, color-dotted by inspection-light color. Empty state when `lights[]` is empty.

`overallVerdict` is a pure helper exported from `ResultsLeftPanel` for test; `computeGlidePathAngle` (the glide-path midpoint math) lives in `resultsStats.ts` alongside `seriesStats` and is tested in `resultsStats.test.ts`. The old measurement summary card and the Jump-to-section nav were removed.

**Default view & drill-down:** on load the tab **lands on the mission overview** (`mission-results-overview`) — it no longer auto-selects the first DONE inspection. A single-inspection **drill-down** opens when the operator clicks a DONE device in the overview, picks a DONE inspection in the left panel, or lands via an `?inspection=<DONE>` deep-link; the `didInitRef` one-shot honours only that deep-link at init. In drill-down, a "← Back to overview" control (`back-to-overview`) clears the selection back to the overview. Drill-down right-column states are unchanged: run still loading → spinner (`results-loading`); load failure → error (`results-error`); `has_results: false` → "not ready" card (`results-pending`); otherwise the results body (`ResultsPage`). The old "no data" / "pick an inspection" empty states are gone — the overview scaffold renders even with zero measurements.

**Mission overview** (`MissionResultsOverview`, `mission-results-overview`) — the protocol-style default view, rendered from `getMissionResults`. In order: (1) a **session-header** card (airport ICAO + name, mission, date, drone model; placeholder optical-sensor / reference-system / certificate fields as `—`); (2) a **weather** placeholder card (temperature / wind / visibility / conditions as `N/A`); (3) one **runway block** per `runways[]` (heading label + each `DeviceProtocolSection`); (4) a **mission evaluation table** (`MissionEvaluationTable`, one row per device: result pill / placeholder restrictions / placeholder recommendations); (5) a **recommendations** block. Loading → spinner (`overview-loading`); failure → error card (`overview-error`). `DeviceProtocolSection` (`device-section-{label}`) shows the device label + an `EvaluationPill` (PASS/FAIL/PENDING/NOT_MEASURED), an optional glide-slope row (measured vs `configured ± tol`), a per-light table (measured transition angle vs `setting_angle ± tol` with a pass/fail icon; **not-measured rows render greyed with an `N/A` tag, visually distinct from a real FAIL** per AC6), and greyed placeholder rows for each `placeholder_rows` key (PAPI parameters + ALS/RLS serviceability we don't compute yet). The header is a drill-down button only when the device is DONE with an `inspection_id`. Every un-measured parameter comes back from the endpoint as explicit `null` / `"NOT_MEASURED"`, never omitted. Strings under `results.overview.*` (EN + SK).

**Body** (`ResultsPage`, now a presentational component taking `results` as a prop) — the result sections, **Data Tables first**:
1. **Data Tables** (`data-tables`) — the `TransitionAngleTable` (each PAPI light's measured transition angle vs `setting_angle ± tolerance`, with a solid PASS/FAIL verdict tone) followed by a **Data tables** 2-col grid of four client-side-derived tables (no backend or type changes): `TransitionDifferenceTable` (per-light start / middle (80%) / end / width / nominal / correction + PASS/FAIL/UNKNOWN verdict, with a pairwise consecutive-light diff sub-block), `GlidePathSummaryTable` (glide-path-to-PAPI angle from `PAPI_B.transition_angle_max` + `PAPI_C.transition_angle_min` with nominal/tolerance/status — the glide-path-to-touch-point row renders `—`), `ChromaticityComparisonTable` (per-light red-chromaticity min/max/avg/range as percent, from `chromaticity_x`), and `LuminosityComparisonTable` (per-light intensity min/max/avg/range). The two comparison tables share `StatsComparisonTable` plus the `seriesStats()` helper (`resultsStats.ts`).
2. **PAPI Vertical Analysis** (`papi-vertical`) — three stacked blocks:
   - the three per-light charts in a 2-col grid: `LightAngleChart` (per-light elevation angle over the climb, shading the white/red transition zones via recharts `ReferenceArea` from `transition_angle_min/middle/max`), `IntensityChart`, and `ChromaticityChart`. Since #167 all three sit on a shared `ChartShell` (`ComposedChart`, taller responsive height, a collapsible "What's this?" explanation note, themed axes/grid, empty state); intensity and chromaticity also carry a right-axis elevation overlay.
   - **Per-unit analysis** (since #167) — a `PapiUnitSelector` A/B/C/D pill row (mirroring the annotated-video track picker) drives `PerLightRgbChart` (raw R/G/B 0-255) and `PerLightChromaticityChart` (normalized R/G/B %, with a dashed white-1/3 reference line). Both render the transition-zone bands, the dashed nominal `setting_angle` line, the right-axis elevation overlay, and a pass/fail `VerdictBadge`. The raw `red`/`green`/`blue` fields are optional, forward-compatible fields on `LightSeriesPoint` — `PerLightRgbChart` shows its empty state until the backend supplies them; the per-unit chromaticity chart is derived from the existing `chromaticity_x/y`, so it works today.
   - **Vertical analysis** (since #167) — `VerticalAnalysisSection` overlays all four units across red chromaticity, luminosity, colour difference (red − green), and light area (`area_pixels`), each with the right-axis elevation overlay.
3. **PAPI Horizontal Analysis** (`papi-horizontal`, since #167) — `HorizontalAnalysisSection` plots red chromaticity and luminosity vs horizontal angle (centerline at 0°), plus a derived `LightDirectionCard` table giving each unit's horizontal angle of maximum luminosity.
4. **Drone Path** (`drone-path`) — `DronePathMap` (MapLibre drone-path map with reference points) beside `DroneHeightProfileChart` (since #168, replacing the old `ClimbProfileChart`): a dual-axis recharts line chart plotting the flown `drone_path` WGS84 elevation on the left axis, plus one dashed altitude-difference series (right axis) per PAPI reference point that carries an `elevation`, plus a touch-point series if a `TOUCH_POINT` reference with elevation ever appears (forward-compatible, omitted otherwise). Its empty state shows only when no path point records an elevation. PAPI footage holds a fixed standoff while altitude sweeps, so the flown path often collapses to a near-stationary point: the map draws circle markers over the path points (not just the line) so a stationary/single-point path stays visible, and falls back to a fixed zoom when the combined path+reference bbox is degenerate so `fitBounds` can't over-zoom (#73). The "no path" empty state shows only when `drone_path` is genuinely empty.
5. **Annotated Video** (`annotated-video`) — `AnnotatedVideoPlayer` (defaults to "All PAPI lights"; a fixed `aspect-video` box the video stretches to fill via `object-fill` so tall per-light crops share the same frame as the full track, plus a Fullscreen button). The PDF download lives in the header, not the body.

**States:** loading spinner, error card, the no-data / pick-inspection messages, and the `has_results: false` "not ready" card. Strings under `results.*` (incl. `results.sections.*`, `results.summary.*`, `results.verdictRollup.*`, `results.perLha.*`, `results.glidePath.*`, `results.inspectionInfo`, `results.picker.*`, `results.noMeasurements`, `results.pickInspection`, `results.perLight.*`, `results.vertical.*`, `results.horizontal.*`, `results.direction.*`, `results.charts.*`, `results.heightProfile.*`, `results.dataTables.*`, `results.transitionDiff.*`, `results.chromaticityCompare.*`, `results.luminosityCompare.*`) + `mission.results` + `measurementsList.*` (EN + SK).

---

### Page 17 — Field Ops (Operator)

**Route:** `/operator-center/field-ops` (the "Field Ops" top-nav tab, added in #162)

The operator surface for the field hub's cloud-route library and the media returned from flights. Since #179 it uses the same 30/70 shell as the mission tabs: a left **Field Hub connection** card (30%) over a right column (70%) holding the two tables. The left card renders the shared `FieldHubPanel` (signals, heartbeat check, connect address + QR, connected devices, CA-cert download) off its own `useFieldLinkStatus()` poll — since #217 this is the **only** place `FieldHubPanel` renders (the mission-page connection dialog that also hosted it was removed). Hub-offline state lives here (`field-hub-offline`), not in a banner above the tables. Each right-column card carries its own **Refresh** button. See SPEC.md "Field Ops page (cloud missions + drone media)" and `docs/specs/FIELD-HUB.md` top status + §5/§6.

**Cloud Missions table:**
- Lists the waylines registered on the field hub — columns: **Name**, **Drone model**, **Last updated** (`update_time`, epoch ms). Backed by `GET /api/v1/field-link/waylines` (the operator proxy over the hub's `GET /internal/api/v1/waylines`), degrading to an empty list when the hub is unconfigured/unreachable.
- Each row has a **delete** action → confirm dialog ("Delete cloud mission \"{name}\"? This removes it from the field hub.") → `DELETE /api/v1/field-link/waylines/{id}`, which removes the wayline row **and** its KMZ object from the hub. 404 surfaces when the hub reports the wayline absent, 502 when the hub is down.
- Empty state: "No cloud missions on the field hub."

**Drone Media table:**
- Tables the transferred media — columns: **File**, **Status** (`Received` / `Matched` / `Unassigned` / `Ingested`), **Size**, **Mission** (the matched mission, if any), **Captured** (device-reported time). Backed by `GET /api/v1/drone-media`. Shows transferred files only (no live in-flight progress — use Refresh); ingested media moves out of this list into the measurement results.
- **Open media** — `GET /api/v1/drone-media/{media_id}/view-url` returns a presigned GET url the browser opens in a new tab to stream or download the file.
- **Link & process** — a per-row mission + inspection picker (inspection auto-selected when the mission has exactly one). Confirm runs `assignDroneMedia` → `moveDroneMedia` → `createMeasurement` in order, so the video is linked to the inspection and its measurement starts in one step, then offers a **View results** link to `/operator-center/measurements/{id}/results`. A measurement consumes **all** videos currently assigned to the chosen inspection, in order — assign every video for a multi-video inspection before starting. Needs a selected airport to resolve the mission list.
- Empty state: "No transferred drone media."

Strings under `fieldOps.*` (EN + SK; `cloudMissions.*`, `droneMedia.*`, `linkProcess.*`). Wayline types in `frontend/src/types/fieldLink.ts` mirror `backend/app/schemas/field_link.py`.

---

## Inspection Color Mapping (Map)

| Inspection # | Color |
|---|---|
| 1 | To be defined (e.g., Blue) |
| 2 | To be defined (e.g., Green) |
| 3 | To be defined (e.g., Orange) |
| 4 | To be defined (e.g., Purple) |
| 5 | To be defined (e.g., Red) |

**Maximum 5 inspections per mission.** Colors are fixed to inspection order, not configurable.

---

## ERD Changes Required

Based on design decisions:

1. **Waypoint entity — add field:** `cameraTarget` (Coordinate) — stores the point where the camera should look for each waypoint
2. **Obstacle entity — confirm field:** `bufferRadius` (Double) — already in ERD, used for cylinder in 3D / circle in 2D
3. **InspectionTargets multiplicity:** Change to one AGL system per inspection (was potentially N — clarify and align ERD)

---

## Deployment Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Amplify     │────▸│  API Gateway +   │────▸│  Amazon RDS     │
│  Hosting     │     │  Lambda (SnapStart)│     │  PostgreSQL 16  │
│  (React SPA) │     │  (Spring Boot 3) │     │                 │
└─────────────┘     └──────────────────┘     └─────────────────┘
```

- **Frontend:** AWS Amplify Hosting (CI/CD built-in)
- **Backend:** AWS Lambda with SnapStart + API Gateway (Spring Boot 3 via `aws-serverless-java-container-springboot3`)
- **Database:** Amazon RDS PostgreSQL (vanilla; geometry stored as WKT strings, processed via Shapely in the application layer)
- **Cold start:** ~1s with SnapStart (acceptable)
- **Limitations:** No WebSockets (fine — REST only), payload size limits (10MB via API Gateway — sufficient for flight plan exports)
