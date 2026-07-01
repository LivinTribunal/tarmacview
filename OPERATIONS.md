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

### Tiered tile resolution (online → cache → offline)

The 2D (MapLibre) and 3D (Cesium) maps resolve every tile through a three-tier fallback chain so the **same build** serves cloud, cached, pre-seeded, and fully air-gapped field deployments — no separate artefact:

```
request → [1] local bundle → [2] persistent cache → [3] network (online)
```

- **Tier 1 — local bundle.** Pre-seeded tiles served same-origin. For 2D + 3D imagery this is an MBTiles file in MinIO served by the backend tile route; for 3D terrain it is a quantised-mesh tileset in MinIO. The bundle is the air-gapped source of truth and is **never auto-evicted**.
- **Tier 2 — persistent cache.** Previously-fetched tiles held on disk (backend proxy cache) or in the browser (service-worker cache). Bounded by a **7-day max-age + size cap**.
- **Tier 3 — network.** Direct fetch from the upstream CDN (Esri / OSM / Cesium Ion). Cloud deployments run this exactly as today; air-gapped deployments disable it.

The backend `TILE_MODE` flag is the field switch across the chain:

| `TILE_MODE` | Behaviour |
|---|---|
| `online` (default) | bundle → cache → upstream; cloud parity, nothing changes |
| `cached` | bundle → cache → upstream **once**, then served from the disk cache |
| `offline` | bundle → cache only; a miss returns a clean `404`/`204` (no upstream, no hang) |

The maps themselves never change — only the `VITE_TILE_*` / `VITE_CESIUM_*` build-time indirection (documented below) and the `TILE_MODE` switch.

**Phased delivery** (tracked by #130):

- Browser service-worker tile cache — tier 2 for the cloud path — #127.
- Backend MBTiles tile route `GET /api/v1/tiles/{layer}/{z}/{x}/{y}` + MinIO bundle — tiers 1+2 for air-gapped 2D & 3D imagery — #128.
- Cesium quantised-mesh terrain bundler — tier 1 for air-gapped 3D terrain — #129 (soft-depends on #128's MinIO serving path).

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

Start from SRTM (or a higher-resolution per-airport-region DEM) and run `scripts/field-hub/bundle-terrain.py` (which drives Cesium Terrain Builder) to produce a quantised-mesh tileset. The output is uploaded to MinIO under the `terrain/` prefix and served same-origin by the backend terrain route `GET /api/v1/terrain/...` (not a separate terrain server), so CSP `connect-src 'self'` already covers it — no nginx / CSP change.

### Building and seeding the field tile bundle

Run once while online (staging laptop — `bundle-basemap.py` is stdlib + `httpx` only, no app install needed):

1. **2D imagery + OSM raster** — `scripts/field-hub/bundle-basemap.py` fetches an airport bbox across a zoom range into an MBTiles SQLite file:
   ```
   scripts/field-hub/bundle-basemap.py \
     --url "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" \
     --bbox 14.20 50.06 14.32 50.14 --min-zoom 8 --max-zoom 16 \
     --out prague-imagery.mbtiles
   ```
   Repeat with the OSM template (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`) to cover the 3D viewer's "map" terrain mode.
2. **3D terrain mesh** — run the airport DEM (GLO-30 / SRTM) through `scripts/field-hub/bundle-terrain.py`, which drives Cesium Terrain Builder (default docker image `tumgis/ctb-quantized-mesh`) to produce `layer.json` + `{z}/{x}/{y}.terrain` tiles. This is a different artefact from the backend's `download_srtm_for_location` GLO-30 DEM, which feeds altitude math, not the render mesh:
   ```
   scripts/field-hub/bundle-terrain.py --dem prague-glo30.tif --out ./terrain-prague --start-zoom 0 --end-zoom 14
   ```
3. **Upload to MinIO** — push the `.mbtiles` and the terrain tileset into the MinIO bucket the `field` profile already runs (the `minio` service in `docker-compose.yml`, seeded by `minio-setup`). The backend tile route (#128) reads the raster tiles from this bundle; the terrain tileset uploads under the `terrain/` prefix (object keys `terrain/layer.json`, `terrain/{z}/{x}/{y}.terrain`), read back by the `/api/v1/terrain/...` route — e.g. `mc mirror ./terrain-prague/ local/tarmacview-media/terrain/`.
4. **Point the build at the bundle** — for the field build set `VITE_TILE_IMAGERY_URL` / `VITE_TILE_OSM_URL` / `VITE_CESIUM_IMAGERY_URL` at `/api/v1/tiles/...`, `VITE_CESIUM_TERRAIN_URL=/api/v1/terrain` (no trailing slash — Cesium appends `/layer.json` and `/{z}/{x}/{y}.terrain`), and `TILE_MODE=offline`. No map code changes — this is the same env indirection used today.

### Backend configuration

- Place each airport's local DEM under `settings.terrain_dir` (`TERRAIN_DIR`, default `<repo>/data/terrain`). `create_elevation_provider(airport)` in `backend/app/services/elevation_provider.py` picks `DEMElevationProvider` automatically when `terrain_source ∈ {DEM, DEM_UPLOAD, DEM_API, DEM_SRTM}`, so no extra wiring is needed. The stored `dem_file_path` is re-rooted at read time by `resolve_dem_file_path`: a bare basename or a legacy absolute path that no longer exists (e.g. an old repo-checkout path) both resolve to `terrain_dir/<basename>`, while an absolute path that still exists is used as-is (custom deployments). The resolution is read-only - the stored column is never rewritten, so a DEM stays portable across deployments without a data migration.
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

For the **field build** these point at the same-origin backend routes rather than the public CDN — the `VITE_TILE_*` / `VITE_CESIUM_IMAGERY_URL` raster vars at `/api/v1/tiles/...` and `VITE_CESIUM_TERRAIN_URL=/api/v1/terrain` (the same-origin terrain route, so CSP `connect-src 'self'` already covers it); the cloud build leaves them unset.

**Service-worker tile cache.** The production build registers a Workbox service worker that `CacheFirst`-caches external map tiles (ESRI / OSM / Cesium hosts). Its matcher (`frontend/src/sw/tileCacheConfig.ts`) only recognises those public cloud hosts, so once the `VITE_TILE_*` / `VITE_CESIUM_*` URLs point at internal servers the cache no-ops and every tile fetch goes straight to your self-hosted endpoints. No extra configuration is needed, and the verification check below still holds.

### Runtime system settings (Super Admin → System)

- Leave `cesium_ion_token` blank. Today the frontend reads `VITE_CESIUM_ION_TOKEN` only; the row is harmless but inert in closed-network deployments.
- Either redirect `elevation_api_url` to a self-hosted elevation endpoint, or leave each airport configured with a DEM file so `FlatElevationProvider` and `DEMElevationProvider` cover the rest.

### Verification

Build with all six `VITE_*` vars set, deploy to a host that has its outbound traffic firewalled to allow only the self-hosted services, and load the operator interface. Confirm:

- The 2D map paints satellite imagery and labels.
- The 3D viewer paints both terrain and satellite imagery.
- The browser network panel shows no requests to `arcgisonline.com`, `tile.openstreetmap.org`, `assets.ion.cesium.com`, or `cesium.com`.
- With `TILE_MODE=offline`, reloading a never-visited area returns a clean miss (no spinner hang) instead of waiting on a blocked upstream.
- Repeat views / reloads of an already-seen area paint from cache with the network throttled or blocked.
