# Vendored: video-processing engine

This directory is a vendored snapshot of the PAPI light-detection engine from the
upstream project, imported as part of the TarmacView merge.

- **Upstream:** `github.com/vzeman/airport-lights-detection`
  (`application/backend/app/services/video_processing/`)
- **Snapshot taken at upstream commit:** `4f60ae7`
- **Why:** TarmacView is the planning half of the loop; this engine is the
  verification half. See `docs/specs/TARMACVIEW-MERGE-PLAN.md`.

## What it does

Pure OpenCV / numpy / ffmpeg. No ML, no GPU. Given a drone video it extracts the
first frame, detects PAPI light candidates, tracks each light frame-by-frame, and
produces per-light timeseries (status RED/WHITE/TRANSITION, glide-path angle,
horizontal angle, chromaticity, intensity, area), transition angles, annotated
videos, and a gzipped measurements JSON.

## Status: vendored, not yet wired

Nothing in `app.main` imports this package yet, so its couplings below are inert
until Phase 2. Do not import it from the app until they are resolved.

It is excluded from ruff (lint + format) in `backend/pyproject.toml` while it stays
a verbatim snapshot. When it is decoupled in Phase 2, drop that exclusion and bring
it up to TarmacView's style.

## Couplings to strip (Phase 2)

| Import in the engine | Count | Plan |
|----------------------|-------|------|
| `from app.core.config` | 23 | Move the detection thresholds into a small engine-local config (a dataclass), independent of the app `Settings`. |
| `from app.core.logging` | 21 | Replace with `logging.getLogger(__name__)`. |
| `from app.repositories` | 2 | Remove. Persistence moves behind the measurement `MeasurementRepository` port; the engine should return domain results, not write the DB. |
| `from app.services.s3_storage` | 1 | Replace with the shared S3/MinIO storage abstraction (boto3 with `S3_ENDPOINT_URL`). |

## To remove (Phase 2)

`step_functions/` is the AWS Step Functions orchestration that chunked the job
across Lambda invocations to dodge Lambda's 15-minute cap. We replace it with a
single Celery task (`app/workers/`), so this subdirectory will be deleted.
