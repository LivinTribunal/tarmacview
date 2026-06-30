"""celery tasks for the measurement pipeline.

thin wrappers over ``measurement_service`` runners - the orchestration, engine seams,
and status transitions all live in the service so they can be unit-tested without
celery (which only ships in the worker image). each task owns its own db session.
"""

import logging
from uuid import UUID

from celery.signals import worker_ready

from app.core.enums import MeasurementStatus
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@worker_ready.connect
def _reap_orphaned_runs(**_kwargs) -> None:
    """on worker boot, fail runs a previous worker left mid-processing.

    a docker recreate / crash kills the worker mid-job; the measurement is left
    PROCESSING and the acks_late task gets redelivered. reaping on startup marks
    those orphans ERROR so they stop looping and surface in the UI.
    """
    from app.core.database import SessionLocal
    from app.services import measurement_service

    db = SessionLocal()
    try:
        reaped = measurement_service.reap_stale_runs(db)
        if reaped:
            logger.warning("reaped %d orphaned measurement run(s) on worker start", reaped)
    except Exception:
        logger.exception("failed reaping orphaned measurement runs on startup")
    finally:
        db.close()


def _run(runner_name: str, measurement_id: str) -> str:
    """open a session, dispatch to the named service runner, return the final status."""
    from app.core.database import SessionLocal
    from app.services import measurement_service

    runner = getattr(measurement_service, runner_name)
    db = SessionLocal()
    try:
        measurement = runner(db, UUID(measurement_id))
        return measurement.status
    finally:
        db.close()


@celery_app.task(name="workers.measurement.extract_first_frame")
def extract_first_frame_task(measurement_id: str) -> str:
    """extract the first frame and detect lights; chain processing when auto-confirmed.

    a confident detection auto-confirms straight to PROCESSING, so the task enqueues full
    processing itself (enqueue stays at the task boundary, mirroring how routes own it). an
    uncertain detection parks at AWAITING_CONFIRM for the operator's confirm-lights call.
    """
    status = _run("run_first_frame", measurement_id)
    if status == MeasurementStatus.PROCESSING.value:
        process_measurement_task.delay(measurement_id)
    return status


@celery_app.task(name="workers.measurement.process")
def process_measurement_task(measurement_id: str) -> str:
    """run the full two-pass engine and write results to object storage."""
    return _run("run_processing", measurement_id)
