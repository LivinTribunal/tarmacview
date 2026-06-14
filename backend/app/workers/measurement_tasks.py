"""celery tasks for the measurement pipeline.

thin wrappers over ``measurement_service`` runners - the orchestration, engine seams,
and status transitions all live in the service so they can be unit-tested without
celery (which only ships in the worker image). each task owns its own db session.
"""

import logging
from uuid import UUID

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


def _run(runner_name: str, measurement_id: str) -> str:
    """open a session, dispatch to the named service runner, return the final status."""
    from app.core.database import SessionLocal
    from app.services import measurement_service

    runner = getattr(measurement_service, runner_name)
    db = SessionLocal()
    try:
        measurement = runner(db, UUID(measurement_id))
        return measurement.status.value
    finally:
        db.close()


@celery_app.task(name="workers.measurement.extract_first_frame")
def extract_first_frame_task(measurement_id: str) -> str:
    """extract the first frame and detect lights, then await operator confirmation."""
    return _run("run_first_frame", measurement_id)


@celery_app.task(name="workers.measurement.process")
def process_measurement_task(measurement_id: str) -> str:
    """run the full two-pass engine and write results to object storage."""
    return _run("run_processing", measurement_id)
