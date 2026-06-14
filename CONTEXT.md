# CONTEXT — Domain Glossary

TarmacView is a drone mission planning module for **airport lighting inspection**. This file is the living glossary of the project's domain vocabulary. When agents or contributors name a concept (in issue titles, refactor proposals, test names, comments), they should use the term defined here.

The full data model — all 19 tables, columns, types, and enums — lives in `docs/specs/SPEC.md`. The thesis design reference is `docs/specs/CHAPTER3-SYSTEM-DESIGN.md`. This file is the **vocabulary** layer; SPEC is the **schema** layer.

---

## Aggregate Roots

- **Mission** — the planned inspection job. Owns one or more inspections, controls status transitions via `transition_to()`. Has a state machine; trajectory-affecting changes auto-regress to `DRAFT`. Max 10 inspections per mission.
- **Airport** — the operational site. Owns surfaces, obstacles, and safety zones. Identified by an ICAO code.

## Mission lifecycle

- **Mission status** — discrete states a mission moves through (DRAFT → … → terminal). Transitions only via `Mission.transition_to(status)`; never assigned directly. Add/remove of inspections from a non-terminal mission regresses it to `DRAFT`. Full state machine: `docs/specs/SPEC.md`.
- **DRAFT** — editable, no committed trajectory.
- **Trajectory-affecting change** — any edit (inspection add/remove, config change) that invalidates the compiled flight plan; triggers regression to DRAFT.
- **Terminal state** — mission states from which no further edits are allowed.

## Inspection

- **Inspection** — a single subject of inspection within a mission (typically a runway, taxiway, or lighting array). Belongs to exactly one Mission.
- **InspectionConfiguration** — per-inspection parameters that override the mission-level template defaults. Resolved via `resolve_with_defaults(template_config)`.
- **Inspection heading** — the optimal direction the drone faces while inspecting (auto-computed for efficiency in #214).

## Geometry & airport features

- **Airport** — top-level site entity, ICAO-keyed.
- **Surface** — runways, taxiways, aprons, and other ground surfaces. Stored as WKT geometry strings (`POLYGON Z`); see `app.core.geometry` for the round-trip seam. Created via `Airport.add_surface()`.
- **Obstacle** — vertical objects (towers, buildings, terrain features) the drone must avoid. Created via `Airport.add_obstacle()`.
- **Safety zone** — geographic regions with restricted flight rules (e.g. RPZ, runway protection zone). Created via `Airport.add_safety_zone()`.
- **POI (Point of Interest)** — annotated point on the map (lighting fixtures, infrastructure references).

## Altitude & geometry primitives

- **AGL (Above Ground Level)** — altitude relative to the terrain surface beneath the drone, distinct from MSL. Bug #232 fixed a regression where takeoff/landing waypoints made the displayed AGL range go negative.
- **MSL (Above Mean Sea Level)** — absolute altitude, used by GPS and barometric sensors.
- **LHA (Lighting Hot Area)** — region of intense lighting that anchors an inspection. `AGL.calculate_lha_center_point()` returns the centroid of LHA positions.
- **AltitudeRange** — value object: `(min, max)` with `min ≤ max`, `contains()` method.
- **Coordinate** — immutable value object `(lat, lon, alt)` with range validation, `to_wkt()` serializer. SRID 4326.
- **Speed** — non-negative float (m/s). Must be compatible with the drone's frame rate via `Inspection.is_speed_compatible_with_frame_rate(drone, speed)`.
- **IcaoCode** — exactly 4 uppercase alpha characters.

## Trajectory & flight plan

- **Trajectory** — the computed 3D path through space, generated from a mission's inspections, surfaces, obstacles, and safety zones. **T3 critical path** — see `docs/specs/TRAJECTORY-CONTEXT.md`. Core thesis algorithm.
- **Waypoint** — discrete point on a trajectory; carries position, altitude, heading, speed, and per-inspection camera settings.
- **Takeoff / landing waypoint** — the first and last waypoints; not part of the inspection itself, so should be excluded from inspection-altitude reporting (see #232).
- **FlightPlan** — the materialized, exportable form of a trajectory. Compiled via `FlightPlan.compile(total_distance, estimated_duration)`. Exports to KMZ/WPML for drone hardware.
- **SafetyValidator** — validates a trajectory against surfaces, obstacles, and safety zones. **T3 critical path** — `**/safety_validator*`.

## Drone & camera

- **Drone model** — hardware profile (DJI etc.) with frame rate, max speed, camera characteristics. Selected per mission, can be bulk-changed via `BulkChangeDroneDialog`.
- **Camera settings** — per-inspection imaging parameters emitted into the KMZ/WPML export (#200).

## Field operations

- **Field Hub** — local DJI Cloud API gateway (top-level `fieldhub/` service) running on the field laptop; gives DJI Pilot 2 wireless mission dispatch and full-quality media return without USB or SD cards, fully offline. Authoritative spec: `docs/specs/FIELD-HUB.md`; protocol contract: `docs/specs/dji-cloud-api-reference.md`; decision record: `docs/adr/2026-06-09-field-hub-local-cloud-api.md`.
- **Field profile** — the docker compose profile (`docker compose --profile field up`) that adds `fieldhub`, EMQX (MQTTS broker), and MinIO (S3-compatible object store) to the stack and wires the backend->hub link. The `start-field.sh` / `start-field.bat` launchers are the one-command entrypoint: they export `FIELDHUB_URL`/`FIELDHUB_CA` only for that single compose invocation (never written to `.env.docker`), so the backend reaches the hub without leaking into a plain `docker compose up`, which leaves them empty and stays no-hub. The profile is mandatory because `fieldhub`/`emqx` need the local TLS certs and crash-loop without them. The default stack is unaffected when the profile is off.
- **Emulator profile** — the cert-free counterpart to the `field` profile, in `emulator/`. Drives DJI Pilot 2 in BlueStacks against the real `fieldhub` over **plain HTTP** (`http://10.0.2.2:8080` via an nginx front, plain MQTT on 1883, throwaway sqlite). BlueStacks reaches the host only via the `10.0.2.2` loopback alias and its WebView won't trust the local CA, so the production HTTPS path can't be used there - the emulator drops TLS instead. Mutually exclusive with `field` (shared ports). Run kit + procedure: `emulator/README.md`, `docs/emulator-validation.md`.
- **Pilot connect page** — the page the hub serves at its root URL; DJI Pilot 2's *Cloud Service* webview loads it, and its JSBridge bootstrap chains license verify → operator login → `api`/`thing`/`media` module loads (media auto-upload: originals + video). Call sequence: `docs/specs/dji-cloud-api-reference.md` §5.
- **Wayline dispatch** — pushing a mission's export KMZ into DJI Pilot 2's route library via the hub. The wayline-id ↔ mission-id mapping anchors media matching later.
- **Media return** — post-flight upload of the aircraft's original photos/videos through Pilot 2 into MinIO, matched to a mission by capture-time window + GPS containment. Unmatched files land in an *unassigned* bucket for manual assignment.

## Users & authorization

- **Operator** — the field user who plans missions and operates drones. Lives in `frontend/src/pages/operator-center/`.
- **Coordinator** — reviews and approves missions before execution. Lives in `frontend/src/pages/coordinator-center/`.
- **Super-admin** — manages users and airport-level configuration. Lives in `frontend/src/pages/super-admin/`.
- **Multi-airport access** — a user may have access to more than one airport; the active airport is held in `AirportContext`. Bug #225 fixed the mission page loading the wrong airport's mission for such users.
- **Orphaned airport** — an airport with zero assigned coordinators: invisible to coordinators/operators (every airport-scoped action returns 403) while super admins, who bypass the airport-access check, still see it. Coordinator-created airports auto-assign their creator so creation never orphans; super-admin-created airports stay unassigned by design and surface as `Unassigned` in the super-admin views (`docs/specs/WIREFRAME.md` Page 11).

## Templates

- **Mission template** — reusable inspection configuration that pre-fills mission defaults. Resolved at the inspection level via `InspectionConfiguration.resolve_with_defaults(template_config)`.

---

## Conventions for adding to this glossary

- One concept per bullet, defined in one or two sentences.
- If a concept has a value-object or method-level definition in code, name it (`Coordinate`, `AltitudeRange`, `Mission.transition_to()`).
- If the concept has a deeper authoritative definition elsewhere (`docs/specs/SPEC.md`, ADR, etc.), reference that doc rather than duplicating it.
- New concepts should be added when they appear in two or more places (issue title, code, conversation) without an agreed-on name yet.
