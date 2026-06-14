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

## Status: decoupled + wired (Phase 2)

The engine is now wired into the measurement bounded context: `measurement_service`
lazy-imports it inside the worker runners (`run_first_frame` / `run_processing`) and
the Celery tasks in `app/workers/measurement_tasks.py` drive it. The backend stays
import-safe without the worker deps because every engine import is lazy - `app.main`
never pulls in opencv/celery.

It is no longer excluded from ruff: the `app/services/video_processing` ruff exclusion
was dropped from `backend/pyproject.toml` in Phase 2 and the tree is lint + format
clean to TarmacView's style.

## Couplings stripped (Phase 2)

| Import in the engine | Resolution |
|----------------------|-----------|
| `from app.core.config` | replaced by the engine-local `config.py` (`EngineConfig` dataclass + `settings` singleton). |
| `from app.core.logging` | replaced by `logging.getLogger(__name__)` in each module. |
| `from app.repositories` | removed with `step_functions/`. Persistence lives behind the `MeasurementRepository` port; the engine returns results, it never writes the DB. |
| `from app.services.s3_storage` | removed with `step_functions/`. Artifacts move through `app.services.object_storage` (boto3 against MinIO/S3) at the service layer, not the engine. |

`step_functions/` (the AWS Step Functions orchestration that chunked the job across
Lambda invocations to dodge Lambda's 15-minute cap) was deleted - a single Celery
task replaces it.

## Reconstructed thresholds

The upstream snapshot referenced the detection/tracking/video-gen thresholds by name
but their numeric defaults did not travel with the vendor import. `config.py` holds
**reconstructed** defaults derived from how each constant is used (intensity scales
0-255, percentages as frame fractions, etc.). They are sensible starting points, not
the upstream-tuned values, and can be re-tuned against real footage without touching
the call sites.
