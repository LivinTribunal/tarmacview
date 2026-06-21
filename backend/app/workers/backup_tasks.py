"""celery tasks for scheduled db backups.

thin wrappers over ``backup_service`` - the due-calc, pg_dump, upload, and pruning
all live in the service so they can be unit-tested without celery. each task owns
its own db session. beat dispatches maybe_run_backup; the admin route enqueues
run_backup_task on demand.
"""

from app.workers.celery_app import celery_app


@celery_app.task(name="workers.backup.maybe_run_backup")
def maybe_run_backup() -> str:
    """beat tick: run a backup only when due."""
    from app.core.database import SessionLocal
    from app.services import backup_service

    db = SessionLocal()
    try:
        result = backup_service.maybe_run_backup(db)
        return (result or {}).get("status", "skipped")
    finally:
        db.close()


@celery_app.task(name="workers.backup.run_backup")
def run_backup_task() -> str:
    """on-demand backup enqueued by POST /admin/backups."""
    from app.core.database import SessionLocal
    from app.services import backup_service

    db = SessionLocal()
    try:
        return backup_service.run_backup(db)["status"]
    finally:
        db.close()
