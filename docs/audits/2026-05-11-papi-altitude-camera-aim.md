# PAPI POI altitude and camera aim deepdive (2026-05-11)

Hardware-test feedback on three exported KMZ missions (LZIB area) surfaced three
symptoms that share a single root cause: TarmacView stored a single
`airport.elevation` value and reused it for every per-point altitude on the
airfield, ignoring real terrain variation.

## 1. Symptoms

Reporter, in Slovak, translated:

1. **PAPI marker sits above the ground** in the 3D preview; should be at 0 m
   AGL.
2. **Takeoff marker is below ground level** in the 3D preview.
3. **Camera not centred on PAPI lights at 7× zoom** across waypoints 4 – 11.

Three KMZs at `~/Downloads/test mission/`:

- `test jaro luka only measurements smooth.kmz`
- `test jaro luka without takeoff and landing no continous.kmz` (uses
  `towardPOI`)
- `test jaro luka without takeoff and landing smooth.kmz`

All three emit:

```xml
<wpml:takeOffRefPoint>...,...,134.000000</wpml:takeOffRefPoint>
<wpml:waypointPoiPoint>...,...,134.000000</wpml:waypointPoiPoint>
```

`134.000000` is the airfield's published `airport.elevation`. Real terrain
varies several metres between the takeoff stand and the PAPI fixture; one
constant cannot describe both.

## 2. Root causes

### 2.1 PAPI POI altitude wrong

`backend/app/services/airport_service.py::_normalize_position_altitude`
correctly delegates to `create_elevation_provider(airport)`, but when
`airport.terrain_source = "FLAT"` (the default), the provider was
`FlatElevationProvider(airport.elevation)` which ignores `(lat, lon)` and
returns the single airport-wide value. Every LHA's stored `position.z` ended
up at `airport.elevation`. That value then flowed into the WPML
`waypointPoiPoint` via `backend/app/services/export/dji/heading.py` (was
`export/dji.py` at audit time; split into the `export/dji/` package by #562,
where `_append_heading_param` now emits the element) and into the trajectory
engine (`center.alt`), corrupting per-WP gimbal-pitch geometry as a side
effect.

### 2.2 Takeoff coordinate altitude wrong

`frontend/src/utils/takeoffLandingPlacement.ts` assigned `airportElevation`
directly when the operator clicked the map. There was no per-point elevation
lookup. The exported `wpml:takeOffRefPoint` and the in-trajectory ground
TAKEOFF waypoint both consumed this value. The bug fired even after a DEM was
uploaded — the click-handler never asked.

### 2.3 Camera drift at 7× zoom

Primarily 2.1 spillover: wrong `camera_target.alt` ⇒ wrong gimbal pitch ⇒
PAPI lights off-centre. Secondary factors:

- `smoothTransition` mode interpolates body yaw linearly between per-WP
  angles, but the true bearing-to-PAPI along an arc is non-linear ⇒
  mid-segment yaw drift.
- HR + VIDEO_CAPTURE anchors the gimbal pitch once and holds it
  (`_video_smooth_emit_plan`), so per-WP altitude wobble has no firmware-side
  correction.

After 2.1 is fixed, a hardware-test re-record at 7× zoom is needed. If drift
persists, escalate via §4.2 levers.

## 3. Fix landed

Single conceptual fix: eliminate the assumption that one `airport.elevation`
value describes every point on the airfield.

1. **New endpoint** `GET /api/v1/airports/{id}/elevation?lat={lat}&lon={lon}`
   returns the active elevation provider's value at that point with a `source`
   label (`FLAT`, `DEM_UPLOAD`, `DEM_API`, `API_FALLBACK`).
2. **Frontend** `takeoffLandingPlacement.ts` is now async: it queries the new
   endpoint before assigning the takeoff/landing coordinate. Falls back to
   `airportElevation` on any error.
3. **Backend** new `ApiFallbackElevationProvider` wraps the flat fallback so
   `terrain_source = "FLAT"` opportunistically samples Open-Elevation
   per-point. Gated by `settings.elevation_api_fallback_enabled` (default off
   so tests are deterministic; production enables via env). DEM-backed
   providers ignore the flag because they already vary by `(lat, lon)`.
4. **Backfill** `renormalize_airport_altitudes` now also rewrites
   `mission.takeoff_coordinate.alt` and `mission.landing_coordinate.alt` per
   mission of the airport. `mission.status` is not affected — alt-only writes
   stay outside `TRAJECTORY_FIELDS`.
5. **Flight-plan sync** `batch_update_waypoints` queries the provider at the
   rerouted `(lon, lat)` when syncing mission coords from TAKEOFF/LANDING
   waypoint moves; today it copied the wp coords verbatim.

The `_normalize_position_altitude` call sites (`create_lha`, `update_lha`,
`create_obstacle`, `update_obstacle`) now pass `allow_api_fallback=True`, so
operators with no DEM upload still get per-point altitudes when the API
fallback is enabled.

## 4. Follow-ups

### 4.1 Hardware-test re-record (human-driven, post-merge)

- Regenerate one of the three reporter KMZs.
- Confirm `wpml:waypointPoiPoint` and `wpml:takeOffRefPoint` z-values vary
  across PAPI fixtures / takeoff stand.
- Fly the same mission at 7× zoom. Capture before/after video.
- If drift persists, file a follow-up.

### 4.2 Camera-drift levers (only if hardware-test still shows drift)

- **`smoothTransition` → `towardPOI`**: continuous POI tracking, hardware-
  dependent on M4T firmware. Already a per-export option.
- **Increase waypoint density on the arc**: shorter segments reduce
  interpolation error.
- **Per-WP `gimbalRotate` snap**: re-anchor the gimbal at each measurement
  rather than relying on `gimbalEvenlyRotate` sweep.

### 4.3 Hardware-driven follow-ups outside this issue

- `wpml:waypointPoiPoint` ordering is `lat,lon,alt`, while every other point
  in the export is `lon,lat,alt`. Reversal happens at the write site; do not
  unify.
