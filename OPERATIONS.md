# Operations

## Architecture Rules

### DDD-Lite Patterns

This codebase uses DDD-lite patterns without changing the project layout:

- **Business logic belongs on model methods**, not in services. Services handle DB access and HTTP concerns only.
- **Aggregate roots**: Mission (owns inspections, controls status transitions), Airport (owns surfaces, obstacles, safety zones).
- **Value objects** in `backend/app/models/value_objects.py`: Coordinate, Speed, AltitudeRange, IcaoCode. Pure Python, no framework dependencies.
- **Status transitions** use `Mission.transition_to()`, never direct `mission.status =` assignment.
- **Child entity creation** goes through aggregate root methods (e.g., `airport.add_surface()`, `mission.add_inspection()`).

### What is NOT DDD

- No directory restructure (no domain/, application/, infrastructure/ folders)
- SQLAlchemy models keep their dual role (no separate domain entities + ORM models)
- No repository interfaces (services use db session directly)
- No domain events or event bus
- No use case classes (services stay as functions)

## Backups

Daily local dumps of the PostgreSQL database run via `scripts/backup_db.sh`. See [`docs/backups.md`](docs/backups.md) for usage, scheduling (cron / systemd / launchd), and restore procedures.

## Closed-Network Deployment

Military airports and restricted-network civilian aerodromes block outbound traffic. The system can run with every external endpoint replaced by self-hosted equivalents. Cloud parity is preserved when none of the override variables are set.

### Required services

- **Self-hosted vector/raster tile server.** Suggested: [OpenMapTiles](https://openmaptiles.org/) data served by [tileserver-gl](https://github.com/maptiler/tileserver-gl) in Docker. One container exposes both the satellite-style and OSM-style raster endpoints used by the 2D map and the 3D viewer's "map" terrain mode.
- **Self-hosted Cesium terrain server.** Suggested: terrain produced with [Cesium Terrain Builder](https://github.com/geo-data/cesium-terrain-builder) and served by [`nodejs-terrain-server`](https://github.com/geo-data/cesium-terrain-server) or an equivalent static-file host that exposes `layer.json` and quantised-mesh tiles.

### Pre-built tile data

Sources appropriate for the deployment region — for example [HOT Export Tool](https://export.hotosm.org/), [Geofabrik OSM extracts](https://download.geofabrik.de/), or in-house orthophoto stacks. Convert into the format your tile server expects (MBTiles for tileserver-gl).

### Backend-served offline tiles (field profile)

Instead of standing up a separate tile server, the backend can serve raster tiles itself from a pre-seeded MBTiles bundle in MinIO. This is the laziest path for the air-gapped `field` stack: the 2D map and 3D satellite imagery resolve same-origin (nginx already proxies `/api/`), so no extra container, CORS, or CSP changes are needed (`img-src 'self'` / `connect-src 'self'` stay clean).

```
GET /api/v1/tiles/{layer}/{z}/{x}/{y}
```

The endpoint resolves each tile through a three-tier chain:

1. **bundle** — the pre-seeded `{layer}.mbtiles` in MinIO (air-gapped source of truth, never auto-evicted),
2. **disk cache** — tiles previously proxied from upstream,
3. **upstream** — fetch from the CDN and write through (only when `TILE_MODE != offline`).

It is **unauthenticated** by design — MapLibre/Cesium fetch tiles directly and can't attach a JWT, and basemap raster tiles are public read-only. A clean miss returns **HTTP 204** (no hang, no console noise).

**Valid `{layer}` values** are the keys of `TILE_UPSTREAM_URLS`: `imagery`, `osm`, `reference`.

**Build a bundle while online**, then upload it under the `basemaps/` prefix in the media bucket:

```bash
scripts/field-hub/bundle-basemap.py \
    --url "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" \
    --bbox 14.20 50.06 14.32 50.14 --min-zoom 8 --max-zoom 16 \
    --out imagery.mbtiles
# upload to the media bucket (object key = {TILE_BUNDLE_PREFIX:-basemaps}/{layer}.mbtiles)
mc cp imagery.mbtiles local/tarmacview-media/basemaps/imagery.mbtiles
# or: aws s3 cp imagery.mbtiles s3://tarmacview-media/basemaps/imagery.mbtiles
```

**`TILE_MODE`** governs the upstream tier:

| Mode | Behavior |
|---|---|
| `online` (default) | bundle → disk cache → upstream (fetch + write-through) |
| `cached` | identical to `online` — bundle → disk cache → upstream write-through |
| `offline` | bundle → disk cache only; a miss returns a clean 204, never the network |

The disk cache (under `TILE_CACHE_DIR`) honors `TILE_CACHE_MAX_BYTES` (default 512 MB) and `TILE_CACHE_MAX_AGE_DAYS` (default 7). Only proxied tiles are evicted — the MBTiles bundle is never evicted.

**Field-build VITE values** (all `{z}/{x}/{y}` order — the backend re-substitutes per upstream template internally):

```
VITE_TILE_IMAGERY_URL=/api/v1/tiles/imagery/{z}/{x}/{y}
VITE_TILE_OSM_URL=/api/v1/tiles/osm/{z}/{x}/{y}
VITE_TILE_REFERENCE_URL=/api/v1/tiles/reference/{z}/{x}/{y}
VITE_CESIUM_IMAGERY_URL=/api/v1/tiles/imagery/{z}/{x}/{y}
```

These plug into the existing `VITE_TILE_*` / `VITE_CESIUM_IMAGERY_URL` indirection (no map code change) — set them as `frontend` `build.args` in `docker-compose.yml`.

### Pre-built terrain data

Start from SRTM (or a higher-resolution per-airport-region DEM) and run it through Cesium Terrain Builder to produce a quantised-mesh tileset. Place the output behind your self-hosted terrain endpoint.

### Backend configuration

- Place each airport's local DEM where its `dem_file_path` row points. `create_elevation_provider(airport)` in `backend/app/services/elevation_provider.py` picks `DEMElevationProvider` automatically when `terrain_source ∈ {DEM, DEM_UPLOAD, DEM_API}`, so no extra wiring is needed.
- Airport infrastructure (surfaces, obstacles, safety zones) is registered manually through the Coordinator interface — OpenAIP is not consulted.

## Per-Point Elevation

Airports without a DEM upload default to `terrain_source = "FLAT"`, which returns a single `airport.elevation` value for every coordinate on the airfield. That is wrong for PAPI POI altitudes, takeoff/landing alt, and any other position where real terrain varies across the airfield — see [`docs/audits/2026-05-11-papi-altitude-camera-aim.md`](docs/audits/2026-05-11-papi-altitude-camera-aim.md).

Two ways to get per-point ground elevations:

1. **Upload a DEM** (preferred). Use the airport admin UI's *Upload Terrain DEM* action, or `POST /api/v1/airports/{id}/terrain-dem`. Once uploaded, every position write (LHA, AGL, obstacle, takeoff/landing) is sampled from the GeoTIFF.
2. **Enable the Open-Elevation API fallback** (issue #467 / #469). Preferred path: super-admin toggles `elevation_api_fallback_enabled` in `System Settings` (DB-backed `system_settings` row, no restart required — see [Super-admin UI](#super-admin-ui) below). On airports with no DEM, position writes opportunistically hit `https://api.open-elevation.com` (override via `OPEN_ELEVATION_URL`) before falling back to `airport.elevation`. Results are cached in-process keyed on `(lat, lon)` rounded to ~1 m. The `ELEVATION_API_FALLBACK_ENABLED` env var stays as a bootstrap default for fresh installs (set it `true` if you want the API path on before any super admin logs in). The DB row wins when present. Closed-network deployments should leave both off and use DEM uploads instead.

Backend env vars (all optional, both default off / unchanged):

| Variable | Purpose | Default |
|---|---|---|
| `ELEVATION_API_FALLBACK_ENABLED` | Bootstrap default for per-point Open-Elevation lookups when no `system_settings` row exists yet. The DB row wins after first super-admin save. | `false` |
| `ELEVATION_API_LOOKUP_TIMEOUT` | Per-request timeout in seconds. | `2.0` |
| `OPEN_ELEVATION_URL` | Override the Open-Elevation endpoint (self-hosted mirror). | `https://api.open-elevation.com/api/v1/lookup` |
| `SECRET_ENCRYPTION_KEY` | Decrypts the admin-stored remote elevation API key at request time. Needed only when a super admin has saved a provider key under `System Settings`; absent or rotated, the fallback degrades to flat instead of erroring (see note below). For compose, copy the value from `backend/.env` into `.env.docker`. | _(unset)_ |

When the remote fallback is enabled and a super admin has stored a provider key, the backend decrypts that key with `SECRET_ENCRYPTION_KEY` on each `allow_api` lookup (LHA placement). If the key is unset or rotated, the remote backend can't be configured, so the provider falls back to flat (`airport.elevation`) rather than failing the request - a missing encryption key means "remote elevation unavailable", not a 500. Earlier this path 500'd when building an airport's PAPI/LHAs through the UI on a deployment that had a stored key but no `SECRET_ENCRYPTION_KEY`.

### Super-admin UI

`Super-admin → System Settings` exposes the `elevation_api_fallback_enabled` toggle alongside the existing Cesium token and elevation API URL fields. The toggle invalidates the in-process runtime cache on save, so the next request reads the new value without a backend restart. Every change emits a `SYSTEM_SETTING_CHANGE` audit row.

### Existing airports / missions

Changing `airport.elevation`, `terrain_source`, or `dem_file_path` runs `renormalize_airport_altitudes` by default, which resamples ground for every obstacle, AGL, LHA, and mission `takeoff_coordinate` / `landing_coordinate` on the airport. Missions in `PLANNED` / `VALIDATED` / `EXPORTED` whose takeoff or landing altitude actually shifts are regressed to `DRAFT` via `invalidate_trajectory()` so the persisted flight plan can't silently disagree with the new geometry — the flight plan row is kept as a stale reference (per the keep-stale-flight-plan contract) and the operator must re-compute. Terminal missions (`COMPLETED`, `CANCELLED`) are skipped.

**Opt-out per terrain action.** The coordinator `Terrain Settings` card shows a *Rewrite existing structures with new terrain* checkbox above each terrain action (Upload DEM / Download from API / Remove DEM, and the airport-elevation field in airport settings). Checked by default — matches the renormalize-and-regress behavior above and is the right call for fresh airport setup. Uncheck it to keep persisted altitudes intact: validated missions stay validated, but existing entities (LHAs, obstacles, mission coords) keep the OLD ground references until a manual recompute lands. Use this for the "don't disturb my validated missions" case. The route accepts `rewrite_existing=true|false` as a query param on `POST /airports/{id}/terrain-dem`, `POST /airports/{id}/terrain-download`, `DELETE /airports/{id}/terrain-dem`, and `PUT /airports/{id}` (the latter only applies when `elevation` / `terrain_source` / `dem_file_path` is in the payload). The choice lands in the audit row's `details` so the activity feed shows the operator's intent.

### Frontend env vars (set before `npm run build`)

| Variable | Purpose |
|---|---|
| `VITE_TILE_IMAGERY_URL` | 2D satellite imagery raster template (`{z}/{y}/{x}`). |
| `VITE_TILE_REFERENCE_URL` | 2D label/reference overlay template. |
| `VITE_TILE_OSM_URL` | 2D OSM-style raster template. Also used by the 3D viewer's "map" terrain mode. |
| `VITE_TILE_IMAGERY_ATTRIBUTION` | Attribution string shown on the 2D satellite layer. |
| `VITE_CESIUM_TERRAIN_URL` | Cesium quantised-mesh terrain endpoint. |
| `VITE_CESIUM_IMAGERY_URL` | 3D satellite imagery raster template (replaces Cesium Ion asset 2). |

`import.meta.env.*` is resolved at build time. One built artefact is bound to one set of endpoints — rebuild to change them.

### Runtime system settings (Super Admin → System)

- Leave `cesium_ion_token` blank. Today the frontend reads `VITE_CESIUM_ION_TOKEN` only; the row is harmless but inert in closed-network deployments.
- Either redirect `elevation_api_url` to a self-hosted elevation endpoint, or leave each airport configured with a DEM file so `FlatElevationProvider` and `DEMElevationProvider` cover the rest.

### Verification

Build with all six `VITE_*` vars set, deploy to a host that has its outbound traffic firewalled to allow only the self-hosted services, and load the operator interface. Confirm:

- The 2D map paints satellite imagery and labels.
- The 3D viewer paints both terrain and satellite imagery.
- The browser network panel shows no requests to `arcgisonline.com`, `tile.openstreetmap.org`, `assets.ion.cesium.com`, or `cesium.com`.
