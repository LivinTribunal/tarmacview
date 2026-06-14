# TarmacView — Drone Mission Planning Module for Airport Lighting Inspection

**Website:** <https://www.tarmacview.com/>

A full-stack web application that plans, validates, and exports autonomous drone missions for inspecting airport visual approach lighting (PAPI). Developed as a Bachelor's thesis at the Faculty of Informatics, Masaryk University, in collaboration with **[ZEPHYR UAS s.r.o.](https://zephyruas.eu/)**

---

## What this is

Modern Precision Approach Path Indicator (PAPI) inspection at airports is dominated by manual flight checks: a calibrated aircraft flies along the published approach and crews on the ground judge the lights' beam transitions by eye. The procedure is accurate but slow, weather-sensitive, expensive, and demands an operational airspace closure. Surface-based teleobjective measurements exist in research but have not seen broad adoption; commercial drone-based offerings address the inspection problem but each is a closed system whose internals, validation rules, and trajectory algorithms are not publicly available.

TarmacView is an open, vendor-neutral planning and validation platform. It takes a description of an airport (runways, taxiways, obstacles, safety zones, AGL infrastructure), a drone profile (mass, speed envelope, camera, flight-time budget), and an inspector's intent (which PAPI to inspect, by which method) and produces a flight plan: an ordered sequence of validated 3D waypoints with per-segment camera settings, ready for export to a drone's mission file (KML, KMZ, JSON, MAVLink, DJI WPML). Every waypoint is checked against the airport's safety constraints — obstacles, safety zones, runway buffers, minimum AGL, battery reserves — and either flagged as a hard violation or downgraded to a soft warning that the inspector can review.

The system implements the inspection methods specified by ZEPHYR UAS s.r.o., primarily the **vertical profile** and **horizontal range** procedures grounded in ICAO Annex 14 and ZEPHYR's internal measurement methodology. The trajectory engine is the central thesis contribution: it composes a visibility-graph + A\* path planner with method-specific waypoint generators, a bounded brute-force heading optimizer, and a safety validator into a single deterministic pipeline.

## What you do with it

1. **Coordinator** — bootstraps an airport. Loads ICAO data from OpenAIP, places runways / taxiways / obstacles / safety zones, configures the PAPI Light Housing Assemblies (LHAs), and defines drone profiles and reusable inspection templates.
2. **Operator** — creates a Mission targeting an airport, adds Inspections (each pinned to specific AGL targets and an inspection method), generates the trajectory, reviews the validation report on the 2D map and 3D fly-along, and exports the flight plan for the drone.
3. **Super-Admin** — manages users, audit log, and system settings (offline elevation provider toggles, AI integration keys, maintenance mode, etc.).

## Architecture at a glance

```
Presentation layer  React 18 + TypeScript + Vite + MapLibre GL JS + CesiumJS + Three.js
        ↓ REST over HTTP/JSON
Application layer   Python 3.12 + FastAPI + Pydantic v2 + Shapely (in-process spatial)
        ↓ SQLAlchemy
Data layer          PostgreSQL 16 (geometry stored as WKT strings)
```

Three Docker containers wire it all up: `postgres`, `backend` (uvicorn behind nginx), and `frontend` (React bundle served by nginx). The browser sees only nginx on port 80, which proxies `/api/*` to the backend and serves the SPA elsewhere. An opt-in compose profile `field` adds the Field Hub stack (`fieldhub` + EMQX + MinIO) for wireless DJI mission dispatch and media return on the field laptop — see [docs/specs/FIELD-HUB.md](docs/specs/FIELD-HUB.md); the default stack is unaffected when the profile is off.

The codebase follows a **DDD-lite** pattern with three tactical mechanisms: aggregate-root invariant enforcement (`Mission.transition_to()`, `Airport.add_surface()`), value objects (`Coordinate`, `AltitudeRange`, `IcaoCode`, `Speed`), and business methods on entities. Services handle database I/O and HTTP concerns; business rules stay on the model.

The trajectory engine and safety validator are the **T3 critical paths** and live under `backend/app/services/trajectory/`. They are the core thesis contribution and carry extra test coverage + human-review requirements on every change.

## Repository structure

```
backend/
  app/
    api/routes/          FastAPI routers — HTTP layer only, no business logic
    core/                config, database, auth, security primitives
    models/              SQLAlchemy ORM models (DDD-lite aggregate roots)
    schemas/             Pydantic v2 request / response DTOs
    services/            business logic
      trajectory/        T3 — generation pipeline + safety validator
      export/            KML / KMZ / JSON / MAVLink / DJI WPML serializers
      mission_report/    PDF flight-brief generator (reportlab + matplotlib)
      airport/           airport-aggregate package (surfaces, obstacles, AGL, LHA, terrain)
      openaip/           OpenAIP integration (live airport lookups by ICAO)
    main.py              FastAPI app + CORS + middleware
  migrations/            Alembic migration chain
  tests/                 pytest + httpx async tests; real Postgres via testcontainers
frontend/
  src/
    pages/               operator-center/ + coordinator-center/ + super-admin/ routes
    components/          React components grouped by domain (map/, mission/, coordinator/, ...)
    contexts/            AuthContext, AirportContext, MissionContext, ThemeContext
    hooks/               drawing, undo/redo, picking, autosave, etc.
    api/                 Axios client + per-resource API functions
    i18n/                i18next config + locale JSON
    types/               TypeScript interfaces matching Pydantic schemas
fieldhub/                Field Hub — local DJI Cloud API gateway (compose profile "field")
db/initdb/01-seed.sql    Bundled DB seed (3 demo airports + reference data + 3 default users)
docker-compose.yml       Default stack (postgres + backend + frontend) + opt-in "field" profile
scripts/                 dev / ops helper scripts
docs/                    architecture notes + thesis specs + ADRs + audits
```

## Documentation

| Doc | Purpose |
|-----|---------|
| **[INSTALL.md](INSTALL.md)** | Install Docker → run → first login. Reviewer-friendly guide, plus a Developer-reference section with env vars, docker cheat sheet, and the local dev workflow. |
| [OPERATIONS.md](OPERATIONS.md) | Runtime ops: backups, restore, elevation provider, AI integration keys, maintenance mode. |
| [CONTEXT.md](CONTEXT.md) | Domain glossary — the canonical vocabulary used across code, issues, and prose. |
| [docs/conventions.md](docs/conventions.md) | Coding conventions, lint / type / test gates, git workflow. |
| [docs/architecture.md](docs/architecture.md) | Architectural notes beyond the system-design chapter. |
| [docs/specs/CHAPTER3-SYSTEM-DESIGN.md](docs/specs/CHAPTER3-SYSTEM-DESIGN.md) | Thesis Chapter 3 — authoritative design reference. |
| [docs/specs/SPEC.md](docs/specs/SPEC.md) | Domain spec: every table, column, enum, and the mission state machine. |
| [docs/specs/WIREFRAME.md](docs/specs/WIREFRAME.md) | Page-by-page wireframes with every field and interaction. |
| [docs/specs/TRAJECTORY-CONTEXT.md](docs/specs/TRAJECTORY-CONTEXT.md) | Trajectory algorithm spec (T3 critical path). |
| [docs/specs/DESIGN-SYSTEM.md](docs/specs/DESIGN-SYSTEM.md) | Frontend design tokens + CSS variables. |
| [docs/specs/MAP-SYMBOLOGY.md](docs/specs/MAP-SYMBOLOGY.md) | Map symbol reference. |
| [docs/specs/FIELD-HUB.md](docs/specs/FIELD-HUB.md) | Field Hub — local DJI Cloud API gateway for wireless mission dispatch and media return. |
| [docs/specs/dji-cloud-api-reference.md](docs/specs/dji-cloud-api-reference.md) | DJI Cloud API protocol contract the Field Hub implements — endpoints, MQTT topics, payload shapes, device enums. |
| [docs/audits/](docs/audits/) | Read-only audit reports (primitives sweep, PAPI altitude, DJI WPML spec). |
| [docs/adr/](docs/adr/) | Architectural decision records. |

## Quick start

Install Docker Desktop, then from the repo root:

```bash
# macOS / Linux
./start.sh

# Windows
start.bat
```

The stack builds and starts in 5–10 minutes the first time. Open <http://localhost> and sign in with one of the three default users — see **[INSTALL.md](INSTALL.md)** for the credentials, the optional OpenAIP-key setup for adding new airports, and the developer reference.

## Thesis & license

Bachelor's thesis at the Faculty of Informatics, Masaryk University.

- **Author:** Štefan Moravík
- **Supervisor:** doc. Ing. Václav Oujezský, Ph.D. (FI MUNI)
- **Consultant:** Ing. Viktor Zeman (QualityUnit)
- **License:** Apache 2.0 — see [`LICENSE`](LICENSE); copyright attribution in [`NOTICE`](NOTICE).
