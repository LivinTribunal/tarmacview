# TarmacView Merge Plan

Status: In progress
Owner: Štefan Moravík
Last updated: 2026-06-14

This document is the durable spec for merging the drone mission planning module
with the airport lights detection backend into a single product,
`LivinTribunal/tarmacview`.

---

## 0. Current status & handoff (2026-06-14)

**Phase 0 is complete. `tarmacview` is the working repo from here - hand new work
to its agents, not the old `drone-mission-planning-module` ones.**

Done:
- `tarmacview` seeded from the TarmacView base (snapshot import); full repo + this plan.
- Video-processing engine vendored into `backend/app/services/video_processing/`
  (inert until Phase 2; excluded from ruff while it stays a verbatim snapshot - see
  its `VENDORED.md`).
- Local stack runs and is healthy: `postgres + redis + minio (+ bucket-init) +
  backend + worker + frontend`. The Celery worker (`backend/app/workers/celery_app.py`)
  connects to redis.
- Dev mode without full compose: `./scripts/dev.sh` brings up infra only; run
  `uvicorn`, `celery`, and `npm run dev` natively with hot-reload.
- The operator's real working data was restored into the tarmacview DB (copied from
  the old repo's volume; the original volume is untouched).
- Harnext pipeline verified live (tagger -> triage -> plan ran; Claude auth OK).
  State-machine labels cloned from the old repo. `harnext-verify` is disabled here
  (self-hosted runner still bound to the old repo; not needed - the other stages run
  GitHub-hosted).
- CI lint is green. Docs (`README`, `CLAUDE.md`, `architecture.md`) acknowledge the
  new service; `harness.config.json` repointed to tarmacview.

Next: **Phase 1 - the upload-drone-media form** (Section 8).

Known caveats:
- `tarmacview` and the old repo share hardcoded compose `container_name`s + port
  5432, so they cannot run at the same time. De-hardcode if both must coexist.
- Engine deps live in `backend/requirements-video.txt` (the worker image installs
  them); the protected `requirements.txt` is untouched. `opencv-python-headless` is
  pinned to `4.13.0.92` (4.12 capped `numpy<2.3`, which conflicts with the pinned
  `numpy==2.4.4`).
- field-hub stays in tarmacview; the separate `tarmacview-field-hub` repo is
  superseded.

---

## 1. Goal

Merge two systems into one product:

- **drone-mission-planning-module** (this repo) - the mission planning module.
  Python 3.12 + FastAPI + PostgreSQL 16 + React 18/Vite. Plans drone inspection
  missions for airport lighting (PAPI, runway edge lights).
- **airport-lights-detection** (`vzeman/airport-lights-detection`) - import the
  **backend only**. A FastAPI video-processing engine (OpenCV, no ML, no GPU)
  that measures PAPI glide-slope angles, chromaticity transitions, intensity and
  horizontal angles from drone video.

We do **not** import the lights-detection frontend. We build a new results UI
inside TarmacView's existing design system (`--tv-*` tokens, `common/`
components, Recharts, MapLibre).

**Priority: it must run locally first** (`docker compose up`). Cloud / AWS is
deferred behind abstractions (Section 6) and decided later.

---

## 2. Why these two fit together

They are the two halves of one loop:

- TarmacView **plans** the inspection of PAPI lights. It already holds the
  ground truth as relational data: `AGL` (type `PAPI` / `RUNWAY_EDGE_LIGHTS`)
  owning child `LHA` units that carry `unit_designator` (A/B/C/D), `setting_angle`,
  `tolerance` (degrees), `transition_sector_width`, `lens_height_msl_m/agl_m`,
  and a WKT `POINT Z` position. Plus `Runway` (threshold, end, heading).
  Inspections already target specific `lha_ids`.
- The lights engine **verifies** them from video, producing the measured angle
  per light over the flight.

So the engine's reference points come for free from the inspection's target
`LHA`s, and the results can be scored PASS/FAIL against `LHA.setting_angle` +/-
`LHA.tolerance`. That closed loop (plan -> fly -> measure -> verify) is the
reason to truly merge rather than bolt on a second product.

---

## 3. Source system summaries

### TarmacView (destination base)

- FastAPI, PostgreSQL + SQLAlchemy + Alembic, PostGIS geometry as WKT strings.
- DDD-lite: business logic on aggregate-root models; services do DB + HTTP only.
- React 18 + Vite + Tailwind, `--tv-*` design tokens, custom `common/` components.
- Docker: postgres + backend (:8000) + frontend nginx (:80). A `field` profile
  already ships **minio** (S3-compatible), emqx (MQTT) and a fieldhub service.
- Already has a field-hub media path (`DroneMediaFile`, `UploadDroneMediaDialog`)
  fed by the DJI field hub - metadata only, not a manual upload.
- No task queue, no cloud deploy today.

### airport-lights-detection (import backend only)

- FastAPI, Python 3.11, **DynamoDB** + boto3, S3, async background tasks.
- Core value: `app/services/video_processing/` - OpenCV / numpy / ffmpeg.
  Pipeline: extract first frame -> detect PAPI candidates -> user confirms 4 box
  positions -> frame-by-frame track -> per-light timeseries (status
  RED/WHITE/TRANSITION, glide-path angle, horizontal angle, chromaticity,
  intensity, area) -> transition angles -> annotated videos +
  `frame_measurements.json.gz`.
- Results JSON (`measurements-data`) is rich per-light timeseries + drone path +
  reference points + runway + video URLs.
- Existing cloud deployment is **fully serverless**: AWS Lambda (Mangum) behind
  API Gateway HTTP API, DynamoDB single-table, S3, **Step Functions** chunking
  the video job across Lambda invocations (because a single Lambda caps at 15
  minutes), Amplify/CloudFront/Route53 for the frontend, Terraform + SAM IaC.
- The engine itself is database-agnostic. Only its persistence edges are DynamoDB.

---

## 4. Locked decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Merge approach | One container app (port the engine into TarmacView), not two services | Single repo, single design system, the closed loop with `LHA` ground truth |
| D2 | Database, local-first | PostgreSQL for everything now | Relational core (missions, airports, AGL/LHA, PostGIS) cannot be DynamoDB |
| D3 | DB decision deferral | New **measurement bounded context** sits behind a repository **port** (ports and adapters); SQLAlchemy adapter now, DynamoDB adapter possible later | Lets us decide the measurement-context DB / cloud later without a rewrite |
| D4 | Async processing | **Celery + Redis** worker container | Long multi-GB video jobs; survives API restarts; simpler than Lambda + Step Functions |
| D5 | Object storage | S3 API, env-swappable: **minio** locally, S3 in cloud | Identical code path; minio already present in the field profile |
| D6 | Media model | **Extend `DroneMediaFile`** (`inspection_id`, `order_index`, `origin: hub\|manual`) - one table for both paths | User choice; reuse over a parallel entity |
| D7 | Cloud target | **Deferred.** Local-first is the priority | Honor AWS at the account / S3 / region / IaC level when we get there; drop Lambda / DynamoDB / Step Functions, which fight the merge |
| D8 | Repo seed | `tarmacview` seeded as a clean snapshot import of this repo (history stays in the original) | 370 MB of history does not belong in a clean merge product |

### On "honoring" the existing AWS setup

The lights-detection AWS stack is serverless (Lambda + DynamoDB + Step Functions).
That is the opposite paradigm to the merged Postgres + Celery container app. Step
Functions exists only to work around Lambda's 15-minute cap on the video workload;
a worker container solves the same problem more simply. So when we reach the cloud
phase we honor AWS where it counts (same account, S3 bucket conventions, region,
profile, Terraform discipline, Glacier lifecycle, and Aurora Serverless v2 Postgres
which their SAM config already anticipated) and drop only Lambda / DynamoDB / Step
Functions. The repository port (D3) keeps a serverless / DynamoDB adapter possible
if that decision is ever revisited.

---

## 5. Target architecture

```
tarmacview/
  backend/app/
    domain/measurement/          # NEW bounded context - persistence-agnostic
      entities.py                #   Measurement, FrameMeasurement (domain objects)
      repository.py              #   MeasurementRepository (abstract PORT)
    infra/measurement/
      sqlalchemy_repository.py   #   adapter #1 - Postgres (built now)
      # dynamo_repository.py     #   adapter #2 - later, if revisiting serverless
    models/
      measurement.py             #   SQLAlchemy ORM (used only by the sqlalchemy adapter)
      drone_media_file.py        #   extended: inspection_id, order_index, origin
    services/
      media/                     #   presigned upload, per-inspection ordering
      measurement_service.py     #   orchestration; depends on the PORT
      video_processing/          #   VENDORED engine (OpenCV) - unchanged core
    workers/
      celery_app.py              #   Celery app + tasks (run engine -> write results)
    api/routes/
      media.py                   #   upload / reorder / move
      measurements.py            #   results, status polling
  frontend/src/
    components/mission/UploadDroneMediaDialog  # rebuilt per-inspection upload form (dnd-kit)
    pages/.../ResultsPage
    components/results/          #   Recharts + --tv-* + MapLibre
  docker-compose.yml             #   postgres + minio + redis + backend + worker + frontend
```

- One database (Postgres). One object store (minio/S3). One broker (redis).
- Storage and broker are env-swappable; the measurement DB is port-swappable.

---

## 6. Deferring the database and cloud choice

We extend DDD-lite with a ports-and-adapters seam around the **new measurement
context only** - not the whole app.

- The engine is pure OpenCV/numpy; it never touches a DB. Persistence lives at
  the edges.
- The measurement aggregate's access patterns stay **narrow** (get-by-id,
  list-by-inspection / airport, save) - the lowest common denominator that both
  Postgres and DynamoDB can satisfy. Swapping DBs is one adapter class; domain,
  services and engine do not change.
- The heavy results blob goes to **object storage**, not the DB. The DB holds
  metadata + pointers, keeping the port trivial to back either way.
- Reference points (the `LHA` ground truth) are **snapshotted** into the
  measurement aggregate at creation time, not live-joined. This is both
  DB-agnostic and a better audit record (it captures what the spec was at
  measurement time).

Honest boundary: this applies to the measurement context. The relational core
(missions, airports, AGL/LHA, PostGIS, Alembic) stays Postgres. The only part
that was ever DynamoDB upstream is exactly the part we make swappable.

---

## 7. Data model changes

### 7.1 Extend `DroneMediaFile`

Add: `inspection_id` (nullable FK -> inspection), `order_index` (dense 1..N per
inspection, like `LHA.sequence_number`), `origin` (`'hub' | 'manual'`),
`filename`, `size_bytes`. Relax hub-only columns (`fingerprint`, `device_sn`,
`raw_callback`, `captured_at`) to nullable so manual uploads fit. New Alembic
migration. Manual rows are created by a new media service path, not only by
`field_link_service`; update the model invariants accordingly.

### 7.2 `Measurement` aggregate (new context)

A measurement per inspection's media set. Status machine
`queued -> first_frame -> awaiting_confirm -> processing -> done | error`.
Holds: `inspection_id`, snapshotted reference points, per-light summary columns,
and a pointer (`object_key`) to the gzipped results JSON in object storage.
Persisted via the repository port.

### 7.3 Results shape

Port the lights engine's `measurements-data` response shape onto the new context:
per-light timeseries (status, angle, horizontal angle, chromaticity, intensity,
area), drone path, reference points, runway, video URLs, transition angles.

---

## 8. Phased plan (local-first)

### Phase 0 - Bootstrap  ✅ done
- Seed `tarmacview` from this repo (snapshot import).
- Vendor `application/backend/app/services/video_processing/` (+ schemas/utils)
  into `backend/app/services/video_processing/`; strip boto3 / DynamoDB coupling,
  keep OpenCV/ffmpeg/numpy.
- Compose: add `redis` + `worker` (celery), promote `minio` into the base stack,
  add `ffmpeg` to the backend and worker images.
- Workflows + secrets + docs (Section 9).

### Phase 1 - Upload drone media form (priority)  ⏳ next
- Extend `DroneMediaFile` (7.1) + migration.
- Backend: presigned-PUT upload to minio, then complete-upload records the row;
  reorder-within-inspection, move-between-inspections, list grouped by inspection.
- Frontend: repurpose the Upload Drone Media entry into a form listing the
  mission's inspections; `@dnd-kit` to drag files in, reorder, and move between
  inspections. Default one video per inspection; ordered list when a recording
  was split.

### Phase 2 - Hook the processing engine
- `Measurement` aggregate (7.2) behind the port + SQLAlchemy adapter.
- Celery task runs the vendored engine; reference points seeded from the
  inspection's target `LHA`s; per-frame GPS from the video telemetry; progress
  polling endpoint.
- First-frame light-confirm step with boxes pre-placed from LHA geometry.

### Phase 3 - Results page
- Port the `measurements-data` shape (7.3) onto Postgres.
- New `ResultsPage` + `components/results/` using Recharts + `--tv-*` tokens:
  per-light angle / chromaticity / intensity charts, transition-angle table with
  PASS/FAIL vs `LHA.setting_angle` +/- `LHA.tolerance`, drone path on our existing
  MapLibre, annotated-video player, server-side `reportlab` PDF export.

### Phase 4 - Cloud (deferred)
- Write the cloud adapter(s) + IaC when ready. Honor AWS at the account / S3 /
  region / IaC level (Section 4). EC2 + docker-compose first; ECS/Fargate + RDS
  or Aurora Postgres as an upgrade path. Nothing earlier blocks on this.

---

## 9. Repo bootstrap: workflows, secrets, docs

- **Workflows**: copy `.github/workflows/*` (ci.yml, harnext-*.yml, gap-agent.yml,
  claude-assistant.yml) and update the repo slug
  `drone-mission-planning-module -> tarmacview`. Re-register the self-hosted
  verify runner against the new repo (`harnext setup`). Extend
  `harness.config.json` risk tiers for the new paths.
- **Secrets** (set via `gh secret set`): `CLAUDE_CODE_OAUTH_TOKEN` (pipeline),
  plus runtime `JWT_SECRET`, `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` (or `S3_*`),
  `REDIS_URL`. AWS credentials only when the cloud phase starts.
- **Docs**: update `CLAUDE.md` (new `domain/measurement` + `infra/` layout,
  worker/redis/minio services, the repository-port pattern), `INSTALL.md` /
  `README` (new local stack and services), add an architecture note acknowledging
  the imported video-processing service and the planning/verification loop, and
  the harnext protected-files / risk-tier section.

---

## 10. Risk tiers and protected files

- New `migrations/versions/*` are **T3** (manual approval + thorough tests).
- `**/video_processing/*` and `**/measurement*` are **T2**.
- Protected files (agents must not modify in the pipeline): `.github/workflows/**`,
  `harness.config.json`, `backend/requirements.txt`, `frontend/package-lock.json`.
  These are handled during human-owned bootstrap, not by pipeline agents.

---

## 11. Dependencies to add

- Backend (`requirements.txt`, human-applied): `opencv-python-headless`, `celery`,
  `redis`, `reportlab`, `plotly`, `boto3`, `mangum` only if a serverless adapter
  is ever built. Plus `ffmpeg` in the Docker images.
- Frontend: `@dnd-kit/*`, `recharts`.

---

## 12. Deferred / open items

- Cloud topology (EC2 compose vs ECS/Fargate + RDS/Aurora) - decide at Phase 4.
- Whether a DynamoDB measurement adapter is ever needed (the port keeps it cheap).
- Whether to retire or keep the field-hub auto-ingest path long-term (kept for now;
  `origin` distinguishes the two).
