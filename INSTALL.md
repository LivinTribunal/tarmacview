# Installation Guide

**TarmacView** — drone mission planning for airport lighting inspection.
This guide is written for Windows users with no programming background. macOS users can follow the same steps using `start.sh` instead of `start.bat`.

> Closed-network deployments (military airports, restricted-network aerodromes) replace every external map/terrain endpoint with self-hosted services — see the **Closed-Network Deployment** section in [`OPERATIONS.md`](OPERATIONS.md).

---

## What you'll need

- **A Windows 10 or 11 PC** with at least **8 GB RAM** and **10 GB free disk space**.
- **Internet connection** for the first run (about 2 GB download).
- **Administrator rights** to install Docker Desktop.

---

## Step 1 — Install Docker Desktop (one-time)

1. Open this link in your browser:
   **https://www.docker.com/products/docker-desktop/**
2. Click **Download for Windows** and run the installer (`Docker Desktop Installer.exe`).
3. During install, **leave all checkboxes at their defaults** — especially "Use WSL 2 instead of Hyper-V".
4. When the installer asks, **restart your computer**.
5. After the restart, open the **Docker Desktop** app from the Start menu.
6. Accept the licence terms. Skip the sign-in step (click *Continue without signing in*).
7. Wait until the bottom-left corner says **"Engine running"** — usually 30–60 seconds.

> Once Docker Desktop is running, you can leave it running in the background. It uses very little resources when idle.

---

## Step 2 — Get the project folder

You should have received the project as a ZIP file (e.g. `tarmacview.zip`) or a USB drive.

1. **Right-click** the ZIP and choose **Extract All...**
2. Pick a simple location like `C:\TarmacView` and click **Extract**.

Inside `C:\TarmacView` you should see files including:
- `start.bat` ← you'll double-click this
- `stop.bat`
- `docker-compose.yml`
- folders `frontend`, `backend`, `db`, …

---

## Step 3 — Start the app

1. Make sure **Docker Desktop is running** (check the system tray — there should be a whale icon, and Docker Desktop should say "Engine running").
2. Open the `C:\TarmacView` folder.
3. **Double-click `start.bat`**.

A black window opens. The first run will:
- generate a unique `.env.docker` file with a random JWT signing key (so every install has its own secret — keep this file private and don't share it),
- download the database, backend and frontend images (≈ 2 GB),
- build the application (5–10 minutes, depending on your internet speed),
- automatically open your browser at **http://localhost**.

> **Don't close the black window** until you see *"TarmacView is running!"*. After that you can close it — the app keeps running in the background.

If Windows Defender Firewall asks whether to allow Docker, click **Allow access**.

---

## Step 4 — Use the app

Open your browser at **http://localhost** any time after start-up.

Default login (dev/local-stack defaults; rotate before any non-dev deployment):

| Role        | Email              | Password      |
|-------------|--------------------|---------------|
| Super-admin | `admin@tmv.com`    | `adminadmin`  |
| Coordinator | `coord@tmv.com`    | `coordinator` |
| Operator    | `operator@tmv.com` | `operator`    |

Override the defaults by setting `SEED_ADMIN_PASSWORD`, `SEED_COORDINATOR_PASSWORD`, and `SEED_OPERATOR_PASSWORD` in `backend/.env` before the first start. After the database is initialised, change the password from inside the UI.

---

## Step 5 — Stop the app

When you want to free up RAM:

- **Double-click `stop.bat`**, **or**
- Open Docker Desktop → **Containers** → click the ⏹ button next to `tarmacview-*`.

Your data stays safe in the `pgdata` Docker volume. Next time you double-click `start.bat`, everything resumes where you left off.

---

## Optional — adding new airports (your own OpenAIP key)

The bundled database seed already ships **three demo airports** — LZIB Bratislava, LZKZ Košice, and LZPP Piešťany — with full runway / obstacle / safety-zone data. You can use the app end-to-end without any external API key.

If you want to **add more airports** by ICAO code through the in-app lookup (Coordinator → "Add airport"), the backend needs an OpenAIP API key:

1. Sign up for a free account at <https://openaip.net> and create a personal API key.
2. Open `.env.docker` in the project folder (it's created on first run by `start.bat` / `start.sh`; if you don't see it, run the start script once to generate it).
3. Add a line: `OPENAIP_API_KEY=your-key-here`
4. Restart the stack: stop the app, then run `start.bat` / `start.sh` again.

Your key stays in `.env.docker`, which is gitignored — it never leaves your machine. The bundled `db/initdb/01-seed.sql` does not contain any API key, only the airport data that was fetched at dump time.

---

## Updating to a new version

If Štefan sends you a new ZIP:

1. Run `stop.bat` first.
2. Replace the `C:\TarmacView` folder with the new one (keep the old one as a backup if you want).
3. Run `start.bat`.

The database keeps your existing data — the seed only loads on a fresh install.

---

## Troubleshooting

### "Docker is not installed"
You skipped Step 1, or Docker Desktop hasn't finished starting. Open Docker Desktop, wait for "Engine running", try again.

### "Docker Desktop is installed but not running"
Open the Docker Desktop app from the Start menu and wait for the green dot.

### The browser shows "This site can't be reached"
- Wait another minute — first start-up can take longer on slow internet.
- Make sure no other program is using port 80 (Skype, IIS, XAMPP). Close it and run `start.bat` again.
- Open Docker Desktop → **Containers** — all three containers (`tarmacview-db`, `tarmacview-backend`, `tarmacview-frontend`) should be green / healthy.

### "Port 5432 is already allocated"
Another PostgreSQL is running on your machine. Stop it, or open `docker-compose.yml` and change `"127.0.0.1:5432:5432"` to `"127.0.0.1:5433:5432"`.

### After an update I see old data / missing missions

PostgreSQL only runs its initialisation scripts on an **empty** data directory. If a partial or older database is already in the Docker volume, the new seed file under `db/initdb/` is ignored on startup. Symptom: you updated the project, expect to see new sample missions or airports, but the **Retry** button doesn't bring them in.

Wipe the volume and start again:

```bash
docker compose --env-file .env.docker down -v   # the -v wipes the pgdata volume
./start.sh                                       # postgres re-runs the seed on the fresh volume
```

Windows equivalent: `stop.bat` (which preserves the volume), then in Docker Desktop → **Volumes** → delete the `..._pgdata` volume → `start.bat`.

### I want to start with a fresh empty database
1. Run `stop.bat`.
2. Open Docker Desktop → **Volumes**.
3. Delete the volume named `pgdata` (or `tarmacview_pgdata`).
4. Run `start.bat` again — the seed file will load fresh.

### Something else is broken
Take a screenshot of the black window and the Docker Desktop **Containers** view, send them to Štefan.

---

## For developers — regenerating the bundled seed

When the schema changes (any new alembic migration, table, or column), the bundled `db/initdb/01-seed.sql` falls out of date and a fresh `docker compose up -v` will load a dump that doesn't match the ORM. To refresh it, run from the repo root:

```bash
OPENAIP_API_KEY=<your-key> bash scripts/regenerate-db-seed.sh
```

The script spins up an ephemeral `postgres:16` container, runs `alembic upgrade head`, runs the Python seeder (airports from openAIP + 8 drones + 2 inspection templates + 3 default users), `pg_dump`s the result over `db/initdb/01-seed.sql`, and tears the container down. `OPENAIP_API_KEY` is required for the openAIP-sourced airports (e.g. LZIB / LZKZ / LZPP); without it the dump still loads but ships with no airports. Commit the refreshed `01-seed.sql` alongside the schema change. Alternatively, if you already have a working local DB with the demo airports, dump it directly with `pg_dump --exclude-table-data=mission --exclude-table-data=inspection ...` (the personal-data table list is in the current `db/initdb/01-seed.sql` header).

### Optional — using a richer local seed (gitignored)

Maintainers sometimes keep an extended `db/01-seed.full.sql` outside the `db/initdb/` mount — a version with additional test airports or work-in-progress fixtures that should not be published. The file is gitignored (`db/.gitignore`) so it never lands in the repo. It lives one level above `db/initdb/` on purpose: postgres' initdb only auto-runs files inside the `db/initdb/` directory, so a local maintainer's `db/01-seed.full.sql` does not get loaded by accident. `scripts/zephyr-bundle/prepare.sh` refreshes both seeds on every run (`db/initdb/01-seed.sql` via an ephemeral postgres + alembic + python seeder, `db/01-seed.full.sql` via `pg_dump` of the running `tarmacview-db`) and ships whichever one the required `--seed-source=demo|full` flag selects as the bundle's `db/initdb/01-seed.sql`.

To use it locally, copy it over the committed seed **before** the first `docker compose up` (postgres only runs initdb scripts on a fresh volume, so the swap has no effect on an already-initialised stack):

```bash
docker compose --env-file .env.docker down -v   # wipe the dev volume
cp db/01-seed.full.sql db/initdb/01-seed.sql   # locally override; do not commit
docker compose --env-file .env.docker up -d
```

To get back to the committed version, run `git checkout db/initdb/01-seed.sql`.

---

## What's actually happening behind the scenes

- **Docker Desktop** is a tool that runs small, isolated environments called *containers*.
- The app uses three containers:
  - `tarmacview-db` — the PostgreSQL database (with the seed data already loaded).
  - `tarmacview-backend` — the Python API.
  - `tarmacview-frontend` — the React web UI served by nginx.
- They talk to each other over a private Docker network. Only the web UI (port 80) and the database (port 5432, localhost only) are exposed to your machine.

You don't need to understand any of this to use the app — but if anything breaks, this gives Štefan a hint of where to look.

---

## Developer reference

### Local development workflow (without Docker for the app)

For iterative work with hot reload, run the database in Docker and the backend / frontend natively:

```bash
# 1. just the database
docker compose up -d postgres

# 2. backend (terminal 1)
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
python -m app.seed                # populate reference data (drone profiles, templates)
uvicorn app.main:app --reload     # serves on http://localhost:8000

# 3. frontend (terminal 2)
cd frontend
nvm use                           # node 22, pinned in .nvmrc
npm install
npm run dev                       # serves on http://localhost:5173
```

Backend tests: `cd backend && pytest`. Frontend tests: `cd frontend && npx vitest run`. Lint: `ruff check .` (backend), `npm run lint` (frontend). Type-check: `npx tsc -b` (frontend).

### Environment file reference

The Docker stack reads `.env.docker` at the repo root for variable substitution (passed through `--env-file`). The file is created on first `start.sh` / `start.bat` run with a random `JWT_SECRET`; the example template is `.env.docker.example`.

| Key | Default | What it controls |
|-----|---------|------------------|
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | `tarmacview` | Database container init values. |
| `DATABASE_URL` | `postgresql://...@postgres:5432/...` | Backend connection string. |
| `JWT_SECRET` | random per install | HMAC key for session tokens. Must be ≥ 256 bits in production; the start scripts generate 64 hex chars (256 bits) automatically. |
| `CORS_ORIGINS` | `["http://localhost"]` | JSON list of allowed origins for the API. |
| `OPENAIP_API_KEY` | empty | Opt-in. Needed only for in-app "add airport by ICAO" lookups; the bundled seed already has 3 demo airports. See [Optional — adding new airports](#optional--adding-new-airports-your-own-openaip-key). |
| `VITE_CESIUM_ION_TOKEN` | empty | Build-time arg baked into the frontend image. Empty disables Ion-hosted 3D world terrain (free fallback tiles are still served). |
| `ENVIRONMENT` | `development` | Set to `production` to enforce strict-mode JWT secret check. |
| `FIELDHUB_SHARED_SECRET` | empty | Field profile only. Shared secret for fieldhub ↔ backend service calls (status proxy, wayline register, media events); empty disables the integration. |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | `tarmacview` / `tarmacview-minio` | Field profile only. MinIO root credentials; override for field deployments. |

`JWT_SECRET` is the only variable without a usable default — `docker compose up` errors if it is unset.

The `FIELDHUB_*` / `MINIO_*` keys matter only when the optional `field` compose profile is active (`docker compose --profile field up` — the local DJI Cloud API stack for wireless mission dispatch and media return). The `start-field.sh` / `start-field.bat` launchers export the backend→hub link (`FIELDHUB_URL` / `FIELDHUB_CA`) only for that one compose invocation, never persisting them; plain `docker compose up` leaves them empty, so the default stack stays no-hub. For field day, the launchers do everything in one command — filling these from the laptop's LAN IP and bringing the stack up. See `fieldhub/README.md` for the run sequence including TLS cert generation, and `docs/specs/FIELD-HUB.md` for the architecture.

### Common Docker commands

```bash
# start / stop
docker compose --env-file .env.docker up -d --build     # build + start in background
docker compose --env-file .env.docker down              # stop and remove containers (keeps pgdata volume)
docker compose --env-file .env.docker down -v           # also wipe pgdata (loses all DB data!)

# logs
docker compose logs -f                                  # tail all services
docker compose logs -f backend                          # tail backend only

# psql shell into the DB
docker compose exec postgres psql -U tarmacview -d tarmacview

# rebuild one service
docker compose --env-file .env.docker build backend
docker compose --env-file .env.docker up -d --no-deps backend

# run backend tests against the running DB
docker compose exec backend pytest
```

### Rebuilding after code changes

| Changed | Required action |
|---------|-----------------|
| Python code | `docker compose --env-file .env.docker build backend && docker compose up -d --no-deps backend` (code is `COPY`'d at build time, so a rebuild is mandatory). |
| Python deps (`backend/requirements.txt`) | Same as above. |
| Frontend code / translations | `docker compose --env-file .env.docker build frontend && docker compose up -d --no-deps frontend`. |
| `VITE_CESIUM_ION_TOKEN` | Frontend rebuild (token is a build-time `ARG`). |
| Database schema (new Alembic migration) | Handled automatically — the backend container runs `alembic upgrade head` on startup. |
| `db/initdb/01-seed.sql` | Only applied on a fresh volume. To pick up a new seed: `docker compose --env-file .env.docker down -v && docker compose --env-file .env.docker up -d`. |

For iterative work prefer the local dev workflow above and let Docker run only the database.

### Service architecture

```
Browser → nginx :80 ─ /api/* ─→ backend :8000 → postgres :5432
                    └ /*     ─→ static React bundle
```

The nginx config (`frontend/nginx.conf`) proxies `/api/*` to the backend container and serves the React SPA for all other routes. Both Dockerfiles use multi-stage builds — backend has a `deps` stage with gcc + libpq-dev that the final stage discards; frontend builds with `node:20-alpine` and serves with `nginx:alpine`.
