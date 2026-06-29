"""scheduled db backup service: due-calc, pg_dump, upload to object storage, prune.

business logic lives here so it can be unit-tested without celery - the beat tick
and the on-demand task in workers/backup_tasks.py are thin wrappers over these.
restore is deliberately out of scope.
"""

import logging
import os
import subprocess
import tempfile
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from app.core.config import settings
from app.services import admin_settings, object_storage

logger = logging.getLogger(__name__)

_BACKUP_KEY_PREFIX = "tarmacview-"
_BACKUP_KEY_SUFFIX = ".dump"


def is_backup_due(s: dict, now: datetime) -> bool:
    """pure due-calc from a get_system_settings dict + current time."""
    if not s.get("backup_enabled"):
        return False
    last = s.get("last_backup_at")
    if last is None:
        return True
    interval = max(1, int(s.get("backup_interval_hours") or 24))
    return now - last >= timedelta(hours=interval)


def _pg_dump(dump_path: str) -> None:
    """run pg_dump -Fc against the live db into dump_path. creds never logged."""
    u = urlparse(settings.database_url)
    cmd = [
        "pg_dump",
        "-Fc",
        "-h",
        u.hostname or "localhost",
        "-p",
        str(u.port or 5432),
        "-U",
        u.username or "",
        "-d",
        (u.path or "/").lstrip("/"),
        "-f",
        dump_path,
    ]
    env = {**os.environ}
    if u.password:
        # password via env, never argv/logs
        env["PGPASSWORD"] = u.password
    subprocess.run(cmd, env=env, check=True, capture_output=True)


def _prune(bucket: str, retention: int) -> None:
    """keep the newest `retention` dumps, delete the rest (best-effort)."""
    dumps = sorted(
        (
            o
            for o in object_storage.list_objects(bucket=bucket)
            if o["key"].startswith(_BACKUP_KEY_PREFIX) and o["key"].endswith(_BACKUP_KEY_SUFFIX)
        ),
        key=lambda o: o["key"],
        reverse=True,  # ts key is lexically chronological
    )
    # max(1, retention) guards a bad retention=0 from wiping every dump
    for stale in dumps[max(1, retention) :]:
        object_storage.delete_object(stale["key"], bucket=bucket)


def run_backup(db: Session) -> dict:
    """dump the live db, upload to the backups bucket, prune to retention, stamp result."""
    s = admin_settings.get_system_settings(db)
    now = datetime.now(timezone.utc)
    key = f"{_BACKUP_KEY_PREFIX}{now.strftime('%Y%m%d-%H%M%S')}{_BACKUP_KEY_SUFFIX}"
    bucket = settings.s3_backup_bucket
    fd, path = tempfile.mkstemp(suffix=_BACKUP_KEY_SUFFIX)
    os.close(fd)
    try:
        _pg_dump(path)
        object_storage.upload_file(
            key, path, content_type="application/octet-stream", bucket=bucket
        )
        _prune(bucket, int(s.get("backup_retention_count") or 3))
        admin_settings.record_backup_run(db, at=now, status="success")
        return {"key": key, "status": "success"}
    except Exception as exc:
        logger.exception("scheduled db backup failed")
        admin_settings.record_backup_run(db, at=now, status=f"failed: {type(exc).__name__}")
        return {"key": key, "status": "failed"}
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def maybe_run_backup(db: Session) -> dict | None:
    """beat-dispatched: run a backup only when one is due. inline (single worker)."""
    s = admin_settings.get_system_settings(db)
    if not is_backup_due(s, datetime.now(timezone.utc)):
        return None
    return run_backup(db)


def list_backups(db: Session) -> dict:
    """recent dumps + last-run metadata for the admin panel."""
    s = admin_settings.get_system_settings(db)
    items = sorted(
        (
            o
            for o in object_storage.list_objects(bucket=settings.s3_backup_bucket)
            if o["key"].startswith(_BACKUP_KEY_PREFIX)
        ),
        key=lambda o: o["key"],
        reverse=True,
    )
    return {
        "backups": items,
        "last_backup_at": s["last_backup_at"],
        "last_backup_status": s["last_backup_status"],
    }


def enqueue_backup() -> None:
    """lazy-import seam: hand an on-demand backup to the celery worker."""
    from app.workers.backup_tasks import run_backup_task

    run_backup_task.delay()
