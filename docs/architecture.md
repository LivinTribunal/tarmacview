# Architecture

TarmacView is a full-stack drone mission planning system for airport lighting inspection, built as a React + FastAPI application deployed on AWS.

## Project Structure

```
drone-mission-planning-module/
├── frontend/              # React 18 + TypeScript + Vite SPA
├── backend/               # Python 3.12 + FastAPI REST API
├── fieldhub/              # Field Hub — local DJI Cloud API gateway (compose profile "field")
├── docs/                  # Architecture docs, wireframes, diagrams
├── .github/               # Issue/PR templates, CI workflows
├── docker-compose.yml     # Default stack (postgres + backend + frontend) + "field" profile
└── harness.config.json    # Risk tier configuration
```

### Frontend (`frontend/`)

Single-page React application serving two user roles via nested routes:
- `/` — Login page
- `/operator-center/*` — Mission planning, trajectory editing, flight plan export
- `/coordinator-center/*` — Airport configuration, obstacle/safety zone management

Entry point: `src/main.tsx` → `src/App.tsx` (React Router v6 `<BrowserRouter>`).

Key tooling: Vite dev server proxies `/api` requests to `http://localhost:8000`, TailwindCSS for styling, MapLibre GL JS for 2D mapping, path alias `@/*` → `./src/*`.

### Backend (`backend/`)

FastAPI REST API structured into four layers under `app/`:

```
backend/app/
├── main.py               # FastAPI app, CORS, health endpoint
├── api/routes/            # HTTP route handlers
├── models/                # SQLAlchemy ORM models (geometry as WKT strings)
├── schemas/               # Pydantic v2 request/response DTOs
├── services/              # Business logic (trajectory, safety, export)
└── core/                  # Config, database session, auth, dependencies
```

Entry points:
- **Local dev**: `uvicorn app.main:app --reload` (port 8000)
- **AWS Lambda**: `lambda_handler.py` wraps the FastAPI app with Mangum

### Database

PostgreSQL 16 for persistence. Local instance via `docker-compose.yml` (`postgres:16`); production on Amazon RDS. Migrations managed by Alembic (`backend/migrations/`). Geometry columns are plain `TEXT` storing ISO WKT (`POINT Z (lon lat alt)`, `LINESTRING Z (...)`, `POLYGON Z ((...))`); spatial operations run in-process via Shapely. The `app.core.geometry` module is the single seam between the column boundary and Shapely.

### Field Hub (`fieldhub/`)

Separate FastAPI service for the field laptop — the device-facing DJI Cloud API gateway for wireless mission dispatch to DJI Pilot 2 and full-quality media return. Ships behind the docker compose `field` profile together with EMQX (MQTTS broker) and MinIO (S3-compatible object store); the default stack is unaffected when the profile is off. It is deliberately not a backend module: the backend deploys to AWS Lambda via Mangum, where a stateful MQTT-attached gateway cannot live, and separation keeps DJI-protocol dependencies out of the protected `backend/requirements.txt`. Phase 1 is merged (#818, #822): the Cloud API access/binding surface under `/manage/api/v1` (Pilot login, device list, bind/unbind, topology), an MQTT listener tracking device topology and TTL-based online state in a device registry persisted under its own `fieldhub` schema in the shared postgres (created on startup, not Alembic-managed), and a shared-secret internal status endpoint that the backend proxies at `GET /api/v1/field-link/status` for the export-panel RC link chip. The media-return hub side is merged (#824): the hub issues temporary upload-scoped MinIO credentials (STS), answers fast-upload fingerprint dedupe, persists each upload callback in its own media registry, and reports arrivals to the backend at `POST /api/v1/field-link/media-events` (shared-secret auth), where each file lands as a `drone_media_file` row with status `RECEIVED`. Mission dispatch is merged (#825): `POST /api/v1/missions/{id}/dispatch` exports the mission KMZ and registers it with the hub over the shared-secret internal endpoint (persisting the mission ↔ wayline mapping in the `wayline_dispatch` table), and the hub serves the pilot-token-gated wayline library under `/wayline/api/v1` — paged route list with model-key filters, presigned MinIO download URLs signed against the LAN-reachable public endpoint, favorites, delete — which DJI Pilot 2 syncs into its route list. Media→mission matching is merged (#828): the media-events ingest runs `drone_media_service.match_media_file` on each new row — candidates are missions dispatched before the device-reported capture time, narrowed by GPS containment in the mission's flight-plan area (100 m buffer) with a nearest-inspection tie-break — and the operator surface at `/api/v1/drone-media` lists mission-grouped media (retrying lingering `RECEIVED` rows on each listing), supports manual reassignment, and confirms ingest idempotently; the `UploadDroneMediaDialog` on the validation page fronts it, while the hand-off into the processing pipeline stays a stub. The Pilot 2 connect page is merged (#831): the hub serves the page Pilot 2's *Cloud Service* webview opens — `GET /` (plain HTML + vanilla JS under `fieldhub/app/static/`, no build step, no external assets) plus the unauthenticated `GET /pilot/config` bootstrap envelope (DJI app credentials from the `FIELDHUB_DJI_APP_ID` / `_APP_KEY` / `_APP_LICENSE` settings, the device-facing MQTT address, platform/workspace identity) — and its JSBridge flow gates each step in sequence: license verify → operator login → `api`/`thing`/`media` module loads with media auto-upload set to originals + video, a status panel tracking live MQTT link state, and a graceful "open this page in DJI Pilot 2" banner outside the webview. Call sequence and envelope-parsing rules: `docs/specs/dji-cloud-api-reference.md` §5. Spec: `docs/specs/FIELD-HUB.md`; decision record: `docs/adr/2026-06-09-field-hub-local-cloud-api.md`.

## Architectural Pattern

TarmacView follows a **layered monolith** pattern with a strict unidirectional dependency flow: routes → services → models. The frontend is a separate SPA communicating exclusively via REST.

This pattern suits the project because:
- **Thesis scope**: a single deployable backend keeps infrastructure simple while maintaining clean separation of concerns.
- **Spatial domain complexity**: the business logic layer (services) isolates Shapely-based trajectory computation and safety validation from HTTP handling.
- **Serverless deployment**: Mangum wraps the entire FastAPI app as a single Lambda function — a monolith that deploys as a microservice.

Key design principles:
- **Routes are thin**: HTTP parsing, auth, and response formatting only — no business logic in route functions.
- **Services own the logic**: trajectory generation, safety validation, and export formatting live in dedicated service modules.
- **Pydantic boundaries**: SQLAlchemy models never leak to the API surface; Pydantic schemas define all request/response contracts.
- **Dependency injection**: database sessions flow through `Depends(get_db)` — no global state.

## Component Diagram

```mermaid
graph TD
    Browser["Browser (React SPA)"]
    Vite["Vite Dev Proxy /api → :8000"]
    APIGW["AWS API Gateway"]
    Lambda["AWS Lambda (Mangum)"]
    FastAPI["FastAPI App"]
    Routes["api/routes/"]
    Services["services/"]
    Models["models/"]
    Schemas["schemas/"]
    DB["PostgreSQL 16 (WKT geometry)"]
    MapLibre["MapLibre GL JS"]
    Cesium["CesiumJS (3D viewer)"]
    ESRI["ESRI Satellite Tiles"]

    Browser --> Vite
    Browser --> APIGW
    Vite --> FastAPI
    APIGW --> Lambda --> FastAPI
    FastAPI --> Routes
    Routes --> Schemas
    Routes --> Services
    Services --> Models
    Models --> DB
    Browser --> MapLibre
    Browser --> Cesium
    MapLibre --> ESRI
```

## Directory Organization

### Backend Layers

| Directory | Role | Depends On |
|---|---|---|
| `api/routes/` | HTTP handlers, request validation, auth | schemas, services |
| `schemas/` | Pydantic DTOs (request/response contracts) | — (pure data) |
| `services/` | Business logic, trajectory computation | models |
| `models/` | SQLAlchemy ORM, WKT geometry in `String` columns | — (database mapping) |
| `core/` | Cross-cutting: config, database session, auth | — (infrastructure) |

Dependency rule: **routes → services → models**. Schemas are shared across routes and services but never import from either.

### Frontend Organization

| Directory | Role |
|---|---|
| `src/pages/operator-center/` | Operator mission planning views |
| `src/pages/coordinator-center/` | Coordinator airport config views |
| `src/components/` | Shared UI components |
| `src/types/` | TypeScript interfaces mirroring backend schemas |
| `src/api/` | Axios client with JWT interceptor |

## Data Flow

### Typical API Request

```
1. Browser sends POST /api/v1/missions
2. Vite proxy (dev) or API Gateway (prod) forwards to FastAPI
3. FastAPI router deserializes request body via Pydantic schema (MissionCreate)
4. Router calls service function (e.g., mission_manager.create_mission())
5. Service executes business logic, writes to database via SQLAlchemy
6. Service returns domain object
7. Router serializes response via Pydantic schema (MissionResponse)
8. JSON response sent to browser
```

### Mission Planning Flow

```
1. Coordinator configures airport: runways, PAPI systems, obstacles, safety zones
2. Operator creates mission → status: DRAFT
3. Operator selects AGL systems and LHAs for inspection
4. System generates trajectory (waypoints) → status: PLANNED
5. Operator reviews 3D flight plan in CesiumJS viewer
6. Operator validates → status: VALIDATED
7. Export to KML/KMZ/JSON/MAVLink → status: EXPORTED
8. After flight → status: COMPLETED
```

### Map Rendering Flow

```
1. MapLibre GL JS loads ESRI satellite basemap tiles
2. GeoJSON overlays render runways, taxiways, obstacles, safety zones
3. Leaflet.draw enables coordinate editing for airport geometry
4. CesiumJS renders 3D flight plan with waypoint markers and trajectory lines
```

## External Dependencies

| Dependency | Purpose | Abstraction |
|---|---|---|
| PostgreSQL | Persistence | SQLAlchemy ORM; geometry stored as WKT strings, processed in-process via Shapely |
| ESRI Satellite Tiles | Basemap imagery (cloud default) | MapLibre GL JS tile source; overridable via `VITE_TILE_*` env vars for closed-network deployments — see [`OPERATIONS.md`](../OPERATIONS.md) |
| Cesium Ion (World Terrain + Asset 2 imagery) | 3D terrain and satellite imagery (cloud default) | CesiumJS providers; overridable via `VITE_CESIUM_TERRAIN_URL` / `VITE_CESIUM_IMAGERY_URL` for closed-network deployments |
| AWS Lambda | Serverless compute | Mangum adapter wrapping FastAPI |
| AWS API Gateway | HTTP routing | Transparent to application code |
| AWS Amplify | Frontend hosting | Static build deployment |
| Amazon RDS | Managed PostgreSQL | Same connection string as local |

All external services are abstracted behind application-level interfaces. The database is accessed exclusively through SQLAlchemy sessions injected via `Depends(get_db)`. AWS Lambda integration is a single 5-line adapter (`lambda_handler.py`):

```python
from mangum import Mangum
from app.main import app

handler = Mangum(app, lifespan="off")
```

## Configuration

Application settings are managed through Pydantic's `BaseSettings` class in `app/core/config.py`, loading from environment variables:

```python
class Settings(BaseSettings):
    database_url: str = "postgresql://tarmacview:tarmacview@localhost:5432/tarmacview"
    jwt_secret: str = "change-me-in-production-minimum-256-bits"
    jwt_expiration_minutes: int = 15
    jwt_refresh_expiration_days: int = 7
    environment: str = "development"
```

Environment-specific values (database URL, JWT secret) are injected at deploy time - never hardcoded for production. When `environment == "production"` the app raises a `RuntimeError` at startup if `jwt_secret` is still the built-in default; dev/test logs a warning instead.

## Architecture Decision Records

The inline records below cover foundational choices. Newer decisions are recorded as dated, standalone files in [`docs/adr/`](adr/).

### ADR-001: FastAPI + Mangum for Serverless Deployment

**Status**: Accepted

**Context**: The backend needs to run both locally during development and on AWS Lambda in production without maintaining two separate entry points.

**Decision**: Use FastAPI as the web framework with Mangum as a Lambda adapter. A single `lambda_handler.py` wraps the same FastAPI app used in local development.

**Rationale**: Mangum transparently translates API Gateway events to ASGI requests. Development uses standard Uvicorn, production uses Lambda — same application code, zero branching.

**Consequences**: Cold starts on Lambda are higher than a minimal handler, but acceptable for this use case. The entire app loads on every cold start.

### ADR-002: PostGIS for Spatial Data

**Status**: Superseded by ADR-003

**Context**: The domain requires 3D coordinate storage (WGS84 + altitude), spatial queries (point-in-polygon for safety zones), and distance calculations for trajectory planning.

**Decision**: Use PostgreSQL with PostGIS extension, accessed through GeoAlchemy2's `Geometry("POINTZ", srid=4326)` column type.

**Rationale**: PostGIS provides native spatial indexing and functions (ST_Contains, ST_Distance, ST_3DDistance) that would be complex and slow to implement in application code.

**Consequences**: Requires PostGIS-enabled PostgreSQL in all environments. Local development uses the `postgis/postgis:16-3.4` Docker image. Production uses Amazon RDS with PostGIS extension enabled.

### ADR-003: WKT-as-text + Shapely (supersedes ADR-002)

**Status**: Accepted (PR #425, May 2026)

**Context**: The dataset is small (single airport, dozens of surfaces / obstacles / zones, a few thousand waypoints per mission) and every spatial query already loads the full row set anyway. PostGIS spatial indexing was never on the hot path. The PostGIS dependency complicated local setup, RDS option groups, and migration squashes; a few raw `ST_*` queries also leaked geographic semantics into safety validation.

**Decision**: Store geometries as ISO WKT strings (`POINT Z (lon lat alt)`, `LINESTRING Z (...)`, `POLYGON Z ((...))`) in plain `String` columns. Replace every spatial predicate with Shapely. `app.core.geometry` is the only seam between the column boundary and Shapely - parsing helpers (`wkt_to_shapely`, `wkt_to_geojson`) plus typed extractors (`point_lonlatalt`, `polygon_xy`, `linestring_xy`) live there; services route every WKT-to-tuple read through this module rather than rolling their own. Distance-in-meters checks (e.g. runway-buffer) reproject through `app.utils.local_projection.LocalProjection` before measuring.

**Rationale**: One database image, one toolchain at the column boundary, no spatial-extension drift across local / CI / prod. Shapely 2 ships batched predicates that release the GIL, and the visibility-graph builder runs on the same data anyway, so moving to Python-side spatial ops did not regress trajectory generation in practice.

**Consequences**: Local and prod databases run vanilla `postgres:16`; the previous PostGIS migrations were squashed into a single `0001_initial_schema.py` (fresh-DB only — no upgrade path preserved). Spatial predicates that previously were one SQL query now load polygons into Shapely once per planning run. No SRID enforcement at the column level; producers must emit WGS84 lon/lat and the column comment is the contract.

### Template for Future ADRs

```markdown
### ADR-NNN: [Title]

**Status**: Proposed | Accepted | Deprecated | Superseded by ADR-XXX

**Context**: What is the issue that we're seeing that is motivating this decision?

**Decision**: What is the change that we're proposing and/or doing?

**Rationale**: Why is this the best choice given the constraints?

**Consequences**: What trade-offs does this decision introduce?
```
