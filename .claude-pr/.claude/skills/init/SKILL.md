---
name: init
description: Project-specific startup runbook and repository tour for TarmacView — covers what to install, how to start each runnable app in the background, what env vars are required, and where the routes/pages live.
---

# init

TarmacView — Drone Mission Planning Module for airport lighting inspection.
Bachelor's thesis project (Štefan Moravík, MUNI FI). Two runnable apps in
one repo, plus a PostGIS-backed database. Not a workspace monorepo —
each app has its own manifest and is run independently.

Always run shell commands from the repository root unless a step
explicitly says otherwise.

## Repository tour (overview)

| App | Path | Stack | Default port | Purpose |
|---|---|---|---|---|
| `backend` | `backend/` | Python 3.12 + FastAPI 0.115 + SQLAlchemy 2.0 + GeoAlchemy2 + Alembic, pip + venv | `8000` (uvicorn) | REST API at `/api/v1/*`, mounted in `backend/app/main.py:71-78`. |
| `frontend` | `frontend/` | React 18 + TypeScript 5.6 + Vite 6 + MapLibre GL + CesiumJS, npm | `5173` (vite dev) | SPA at `frontend/src/main.tsx`, routes in `frontend/src/App.tsx:60-127`. |
| `postgres` (compose service) | service in `docker-compose.yml:2-18` | postgis/postgis:16-3.4 | `127.0.0.1:5432` | PostgreSQL 16 + PostGIS 3.4. Database name, user and password all default to `tarmacview` (`docker-compose.yml:5-8`). |

Two more compose services exist for fully containerised runs:
`backend` (`docker-compose.yml:20-39`, runs `alembic upgrade head` then
uvicorn on port 8000 inside the container) and `frontend`
(`docker-compose.yml:41-58`, nginx on host port 80, builds the React
bundle at image build time). For iterative dev prefer the local
workflow below and only use compose for the database — see
`INSTALL.md` *Developer reference* for the docker-side cheat sheet.

There is **no monorepo tool** (no pnpm/yarn workspaces, no Turborepo).
The aggregate test/lint/build commands at the repo root are wrappers
that `cd` into each package — defined in `harness.config.json:99-104`.
A stray `backend/package-lock.json` exists (3 lines, an artefact) — the
backend uses pip and `requirements.txt`, not npm.

A second tier of automation lives in `scripts/` and `.codefactory/`
(CodeFactory issue/PR agents). They are not part of dev startup but
can be run manually — see `CLAUDE.md` for the full agent lifecycle.

Pure libraries / non-runnable: none. There is no `packages/`,
`libs/`, or shared lib dir.

## Boot order dependencies

The backend cannot start without postgres reachable on its
`DATABASE_URL` host. The frontend dev server can start in any order —
it proxies `/api` to `localhost:8000` (`frontend/vite.config.ts:68-72`)
and just shows network errors if the backend is down. Local dev order:

1. `postgres` (docker compose service, port 5432)
2. `backend` (uvicorn, port 8000) — runs `alembic upgrade head` only
   inside docker (`backend/Dockerfile:22`); on local dev you must run
   migrations yourself before first boot (see backend section).
3. `frontend` (vite, port 5173)

## Logs directory

The agent should keep background process logs in `.harnext/logs/`.
Create it once per session if missing:

```bash
mkdir -p .harnext/logs
```

It is not in `.gitignore` explicitly but `.harnext/` lives outside
tracked source — safe to write to.

---

## Database (postgres + postgis)

Source: `docker-compose.yml:2-18`.

**Start (background):**

```bash
docker compose up -d postgres
```

`-d` detaches; this is already a long-running daemon — do not wrap in
`nohup`. The healthcheck is `pg_isready` on the configured user/db
(`docker-compose.yml:14-18`).

**Tail logs:**

```bash
docker compose logs --tail=200 postgres
```

(Never use `docker compose logs -f` from an agent — it never returns.)

**Stop:**

```bash
docker compose stop postgres
```

`docker compose down` also tears it down but removes the container;
`down -v` additionally wipes the `pgdata` volume — **never run
`down -v` without explicit user approval**, it destroys all DB data
(seeded airports, missions, users).

**Connect with psql:**

```bash
docker compose exec postgres psql -U tarmacview -d tarmacview
```

**Env vars consumed (compose-level, all default-supplied):**

| Var | Default | Source |
|---|---|---|
| `POSTGRES_DB` | `tarmacview` | `docker-compose.yml:6` |
| `POSTGRES_USER` | `tarmacview` | `docker-compose.yml:7` |
| `POSTGRES_PASSWORD` | `tarmacview` | `docker-compose.yml:8` |

---

## Backend — `backend/`

Source: `backend/app/main.py` is the FastAPI entrypoint
(`app = FastAPI(...)` at `backend/app/main.py:43-49`). Routes mounted
at `backend/app/main.py:71-78`. Settings loader in
`backend/app/core/config.py:9-62` (Pydantic `BaseSettings`, reads
`.env` from the current working dir).

### Install (one-time)

```bash
cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
```

A `.venv` already exists in this checkout (`backend/.venv/`). Once
created, just `source backend/.venv/bin/activate` (or call the venv's
binaries directly: `backend/.venv/bin/uvicorn`, `backend/.venv/bin/pytest`,
`backend/.venv/bin/alembic`). `requirements.txt` is **protected** —
agents must not modify it (`harness.config.json:152-158`,
`CLAUDE.md`).

### First-time database setup

Run alembic migrations against the running postgres before the first
boot. Migrations live in `backend/migrations/versions/` (one chain,
many revisions; the latest at the time of writing reflects merged
heads). The local dev `alembic.ini` points at
`postgresql://tarmacview:tarmacview@localhost:5432/tarmacview`
(`backend/alembic.ini:3`).

```bash
cd backend && source .venv/bin/activate && alembic upgrade head
```

Optional: seed reference data (5 European airports + DJI drone profiles).

```bash
cd backend && source .venv/bin/activate && python -m app.seed
```

### Start in background

Bind to 8000 (the port the frontend proxy expects). `--reload`
restarts on file change.

```bash
mkdir -p .harnext/logs
cd backend && nohup .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload >> ../.harnext/logs/backend.log 2>&1 &
```

If you didn't activate the venv: replace `.venv/bin/uvicorn` with the
absolute path or `python -m uvicorn`.

### Tail logs

```bash
tail -n 200 .harnext/logs/backend.log
```

(Never use `tail -f` from an agent — it never returns.)

### Stop

```bash
pkill -f "uvicorn app.main:app"
```

(Or save the PID returned by `$!` after the nohup line and `kill` it.)

### Env vars required to boot

Settings come from Pydantic `BaseSettings` reading `.env` in the
process CWD (`backend/app/core/config.py:57-59`). All have safe
defaults so the app will boot with **no** env vars set, but you'll
get warnings for the JWT secret default. Fields that matter at boot:

| Var | Default | Source | Notes |
|---|---|---|---|
| `DATABASE_URL` | `postgresql://tarmacview:tarmacview@localhost:5432/tarmacview` | `backend/app/core/config.py:12` | Must point at the running postgres. Inside docker compose it is overridden to use the `postgres` service host (`docker-compose.yml:29`). |
| `JWT_SECRET` | `change-me-in-production-minimum-256-bits` | `backend/app/core/config.py:14` | Default triggers a startup warning (`backend/app/core/config.py:68-73`). |
| `JWT_EXPIRATION_MINUTES` | `15` | `backend/app/core/config.py:15` | |
| `JWT_REFRESH_EXPIRATION_DAYS` | `7` | `backend/app/core/config.py:16` | |
| `CORS_ORIGINS` | `["http://localhost:5173"]` | `backend/app/core/config.py:17` | JSON-encoded list. |
| `OPENAIP_API_KEY` | `""` | `backend/app/core/config.py:54` | Required for live OpenAIP airport lookups; a working key is checked into `backend/.env`. |
| `SEED_USERS` / `SEED_*_EMAIL` / `SEED_*_PASSWORD` | see below | `backend/app/core/config.py:36-42` | When `SEED_USERS=true`, `seed_users()` runs once on app startup (`backend/app/main.py:32-39`). The committed `backend/.env` already enables this. |
| `MAINTENANCE_MODE` | unset | read directly via `os.environ` in `backend/app/main.py:109` | Truthy value forces every non-admin request to return 503. |
| `TERRAIN_DIR` | `<repo>/data/terrain` | `backend/app/core/config.py:25` | Used by elevation provider; created lazily. |

The committed `backend/.env` (the only env file the agent will find
without extra work) holds the OpenAIP key and the seed user
credentials (`backend/.env:1-12`). For docker compose runs use
`.env.docker` at the repo root (template at `.env.docker.example`).

### Key endpoints (top-level groups)

All HTTP layer; business logic lives in `backend/app/services/`.

| Prefix | Tag | Source |
|---|---|---|
| `/api/v1/auth` | `auth` | `backend/app/api/routes/auth.py:24` |
| `/api/v1/admin` | `admin` | `backend/app/api/routes/admin.py:27` |
| `/api/v1/airports` | `airports` | `backend/app/api/routes/airports.py:69` |
| `/api/v1/camera-presets` | `camera-presets` | `backend/app/api/routes/camera_presets.py:19` |
| `/api/v1/drone-profiles` | `drone-profiles` | `backend/app/api/routes/drone_profiles.py:20` |
| `/api/v1/inspection-templates` | `inspection-templates` | `backend/app/api/routes/inspection_templates.py:21` |
| `/api/v1/missions` | `missions` | `backend/app/api/routes/missions.py:39` |
| `/api/v1/missions` (flight plan sub-routes) | `flight-plans` | `backend/app/api/routes/flight_plans.py:22` |
| `/api/v1/health` | (none) | `backend/app/main.py:160` |
| `/api/docs` | OpenAPI Swagger UI | `backend/app/main.py:47` |
| `/api/openapi.json` | OpenAPI schema | `backend/app/main.py:48` |
| `/static/*` | uploaded models | `backend/app/main.py:81-83` |

Layered DDD-lite — `routes → services → models/schemas`, enforced by
the architectural-boundary config in
`harness.config.json:111-127`. Business rules live on model methods
(`backend/app/models/mission.py`, `airport.py`, etc.). See
`OPERATIONS.md` and `CLAUDE.md` for the full pattern.

### Quick checks

```bash
# unit + integration tests (auto async mode, real PostGIS via testcontainers)
cd backend && source .venv/bin/activate && pytest -v

# lint
cd backend && source .venv/bin/activate && ruff check .

# format check (no rewrite)
cd backend && source .venv/bin/activate && ruff format --check .

# migration integrity (no DB needed for steps 1 & 3; cycle/heads check uses the venv's alembic)
bash scripts/check-migrations.sh

# create a new migration after model changes
cd backend && source .venv/bin/activate && alembic revision --autogenerate -m "short description"

# merge multiple heads (only if check-migrations.sh complains)
cd backend && source .venv/bin/activate && alembic merge heads -m "merge migration heads"
```

Pytest config (`backend/pyproject.toml:15-18`): `testpaths = ["tests"]`,
`asyncio_mode = "auto"`, `slow` marker available.
Ruff config (`backend/pyproject.toml:7-13`): py312 target, 100-char
line length, ignores `migrations/versions`, lint rules `E F I`.

---

## Frontend — `frontend/`

Source: `frontend/src/main.tsx` is the entrypoint (mounts
`<App />` at `frontend/src/main.tsx:26-37`); `App.tsx:60-127`
defines the React Router 6 routing tree. Vite config in
`frontend/vite.config.ts`.

### Install (one-time)

```bash
cd frontend && npm install
```

`package-lock.json` is **protected** (`harness.config.json:152-158`,
`CLAUDE.md`) — let `npm install` regenerate it only when actually
adding deps; never edit it by hand.

### Start in background

Vite dev server binds to `localhost:5173` by default; the dev server
proxies `/api/*` requests to `localhost:8000`
(`frontend/vite.config.ts:68-72`), so the frontend reaches the
backend via the dev proxy — there is no `VITE_API_BASE_URL`.

```bash
mkdir -p .harnext/logs
cd frontend && nohup npm run dev >> ../.harnext/logs/frontend.log 2>&1 &
```

`npm run dev` runs `vite` (`frontend/package.json:7`).

### Tail logs

```bash
tail -n 200 .harnext/logs/frontend.log
```

### Stop

```bash
pkill -f "vite"
```

### Env vars required to boot

The frontend reads only Vite-prefixed env vars (`VITE_*`) at build
time. Found in code by grepping `import.meta.env`:

| Var | Default | Source | Notes |
|---|---|---|---|
| `VITE_CESIUM_ION_TOKEN` | unset | `frontend/src/components/map/CesiumMapViewer.tsx:29`, `frontend/.env:1` | Required for the 3D globe tiles. A working dev token is committed to `frontend/.env`. In docker compose it is a build-time `ARG` (`docker-compose.yml:46`, `frontend/Dockerfile:7-8`). |
| `VITE_GLYPHS_URL` | falls back to a hard-coded MapLibre demo URL | `frontend/src/components/map/AirportMap.tsx:129` | Optional. |
| `import.meta.env.DEV` | provided by Vite | `frontend/src/api/client.ts:105` | Used to gate dev-only logging — no action needed. |

The committed `frontend/.env` is enough to run dev. There is no
`.env.example` inside `frontend/`; the root `.env.example` documents
just the Cesium token (`.env.example:1-3`).

### Key routes (top-level groups in `frontend/src/App.tsx`)

| Path | Component / file | Source |
|---|---|---|
| `/login` | `LoginPage` | `frontend/src/pages/LoginPage.tsx`, route at `App.tsx:65` |
| `/setup-password` | `SetupPasswordPage` | `App.tsx:66` |
| `/maintenance` | `MaintenancePage` | `App.tsx:67` |
| `/operator-center/*` | `OperatorLayout` + 8 child routes (dashboard, missions list, missions/:id/{overview,configuration,map,validation-export}, drones, airport) | `App.tsx:70-96`; pages in `frontend/src/pages/operator-center/` |
| `/coordinator-center/*` | `CoordinatorLayout` + 6 child routes (airports, airports/:id, inspections, inspections/:id, drones, drones/:id) | `App.tsx:99-108`; pages in `frontend/src/pages/coordinator-center/` |
| `/super-admin/{users,airports,system,audit-log}` | `SuperAdminLayout` + 4 child routes | `App.tsx:111-119`; pages in `frontend/src/pages/super-admin/` |
| `*` (fallback) | `CatchAllRedirect` — routes to last-visited path or role default | `App.tsx:122` |

Auth gating uses `<ProtectedRoute requiredRole=...>` and
`<RequireAirport />` wrappers
(`frontend/src/components/Auth/`). Globals are wired in
`frontend/src/main.tsx:26-37`: `ThemeProvider` → `AuthProvider` →
`AirportProvider` → `App` (`QueryClientProvider` + `BrowserRouter`).
i18n is initialised by importing `./i18n` at
`frontend/src/main.tsx:3` — locale JSON in `frontend/src/i18n/locales/`.

### Quick checks

```bash
cd frontend && npx vitest run      # all tests
cd frontend && npm run lint        # eslint
cd frontend && npx tsc --noEmit    # type-check only
cd frontend && npm run build       # tsc -b + vite build (writes to dist/)
```

Vitest config is inlined in `frontend/vite.config.ts:73-77`
(`environment: 'jsdom'`, setup file `src/setupTests.ts`).
ESLint config at `frontend/eslint.config.js` (typescript-eslint).
Note: `frontend/package.json:11` defines `"test": "vitest"` (watch mode);
for one-shot CI-style runs use `npx vitest run`, which is what the
aggregate command in `harness.config.json:100` uses.

---

## Aggregate / repo-root commands

Defined in `harness.config.json:99-104`. Assume both venv-installed
backend deps and frontend node_modules already present.

```bash
# all tests (backend pytest then frontend vitest run)
cd backend && pytest && cd ../frontend && npx vitest run

# all lint (backend ruff check + format check, then frontend eslint)
cd backend && ruff check . && ruff format --check . && cd ../frontend && npm run lint

# type-check (frontend only — Python is unchecked statically beyond ruff F)
cd frontend && npx tsc --noEmit

# build (frontend only — backend has no build step)
cd frontend && npm run build
```

These are the exact strings the harness uses; do not paraphrase them
when reporting.

## Full-stack startup (one shot)

The minimum sequence to bring everything up locally for browser
verification:

```bash
mkdir -p .harnext/logs
docker compose up -d postgres
cd backend && source .venv/bin/activate && alembic upgrade head && cd ..
cd backend && nohup .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload >> ../.harnext/logs/backend.log 2>&1 & cd ..
cd frontend && nohup npm run dev >> ../.harnext/logs/frontend.log 2>&1 & cd ..
```

Then browse to `http://localhost:5173`. Default seeded users
(`backend/.env`):
- super admin: `admin@tmv.com` / `adminadmin`
- coordinator: `coord@tmv.com` / `coordinator`
- operator: `operator@tmv.com` / `operator`

## Protected files (do not modify)

From `harness.config.json:152-158` and `CLAUDE.md`:

- `.github/workflows/**`
- `harness.config.json`
- `CLAUDE.md`
- `backend/requirements.txt`
- `frontend/package-lock.json`

## Critical paths (tier 3 — extra care)

From `harness.config.json:71-76`:

- `**/trajectory*` — `backend/app/services/trajectory/` (directory)
- `**/safety_validator*`
- `**/flight_plan*` — `backend/app/services/flight_plan_service.py`,
  `backend/app/api/routes/flight_plans.py`
- `**/migrations/versions/*`

These require thorough test coverage and human review. Run
`bash scripts/check-migrations.sh` after every migration touch.

## Unknown — confirm with the team

- `frontend` Dockerfile production image listens on host port 80
  (`docker-compose.yml:53`), but no documented dev-time port for
  serving the production bundle outside Docker. If you need to
  preview a built bundle locally, `frontend/package.json:9` provides
  `vite preview` (default port 4173) — confirm this matches what the
  team expects.
- `backend/lambda_handler.py` exists but no IaC or deploy script in
  the repo points to it; whether Lambda is a live target is
  unverified.
