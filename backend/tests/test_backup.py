"""tests for scheduled db backups: due-calc, run/prune, settings round-trip, routes."""

import subprocess
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from testcontainers.postgres import PostgresContainer

import app.models  # noqa: F401
from app.core.config import settings
from app.core.database import Base, get_db
from app.main import app
from app.services import admin_settings, backup_service, object_storage
from app.services.seeder import seed_users


@pytest.fixture(scope="module")
def backup_engine():
    """dedicated postgis database for backup tests."""
    with PostgresContainer(
        image="postgis/postgis:16-3.4",
        username="test",
        password="test",
        dbname="test_backup",
    ) as pg:
        engine = create_engine(pg.get_connection_url())
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
            conn.commit()

        Base.metadata.create_all(engine)
        yield engine
        Base.metadata.drop_all(engine)


@pytest.fixture(scope="module")
def backup_session_factory(backup_engine):
    """session factory for backup tests."""
    return sessionmaker(bind=backup_engine)


@pytest.fixture
def backup_db(backup_session_factory):
    """per-test session."""
    session = backup_session_factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(scope="module")
def backup_client(backup_session_factory):
    """test client with db override + seeded users."""

    def override_get_db():
        """test db override."""
        db = backup_session_factory()
        try:
            yield db
        finally:
            db.close()

    saved_overrides = dict(app.dependency_overrides)
    app.dependency_overrides.clear()
    app.dependency_overrides[get_db] = override_get_db

    original = settings.seed_users
    settings.seed_users = True
    db = backup_session_factory()
    try:
        seed_users(db)
    finally:
        db.close()
        settings.seed_users = original

    yield TestClient(app)
    app.dependency_overrides.clear()
    app.dependency_overrides.update(saved_overrides)


def _admin_token(client):
    """log in as the seeded super admin."""
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@tmv.com", "password": "adminadmin"},
    )
    return resp.json()["access_token"]


def _operator_token(client):
    """log in as the seeded operator."""
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "operator@tmv.com", "password": "operator"},
    )
    return resp.json()["access_token"]


def _dump(key: str) -> dict:
    """build a fake list_objects entry for a backup key."""
    return {"key": key, "size": 100, "last_modified": datetime.now(timezone.utc)}


class TestIsBackupDue:
    """pure due-calc."""

    def test_disabled_never_due(self):
        """disabled backups are never due regardless of last run."""
        s = {"backup_enabled": False, "last_backup_at": None}
        assert backup_service.is_backup_due(s, datetime.now(timezone.utc)) is False

    def test_never_run_is_due(self):
        """enabled with no prior run is due immediately."""
        s = {"backup_enabled": True, "last_backup_at": None, "backup_interval_hours": 24}
        assert backup_service.is_backup_due(s, datetime.now(timezone.utc)) is True

    def test_recent_not_due(self):
        """enabled with a recent run is not due before the interval elapses."""
        now = datetime.now(timezone.utc)
        s = {
            "backup_enabled": True,
            "last_backup_at": now - timedelta(hours=1),
            "backup_interval_hours": 24,
        }
        assert backup_service.is_backup_due(s, now) is False

    def test_stale_is_due(self):
        """enabled with a stale run past the interval is due."""
        now = datetime.now(timezone.utc)
        s = {
            "backup_enabled": True,
            "last_backup_at": now - timedelta(hours=25),
            "backup_interval_hours": 24,
        }
        assert backup_service.is_backup_due(s, now) is True


class TestRunBackup:
    """run_backup uploads, prunes, and stamps the result."""

    def test_uploads_and_stamps_success(self, backup_db, monkeypatch):
        """a successful run uploads to the backup bucket and stamps success."""
        uploaded: list = []
        monkeypatch.setattr(backup_service, "_pg_dump", lambda path: None)
        monkeypatch.setattr(
            object_storage,
            "upload_file",
            lambda key, path, content_type=None, bucket=None: uploaded.append((key, bucket)),
        )
        monkeypatch.setattr(object_storage, "list_objects", lambda bucket=None: [])
        monkeypatch.setattr(object_storage, "delete_object", lambda key, bucket=None: None)

        result = backup_service.run_backup(backup_db)

        assert result["status"] == "success"
        assert len(uploaded) == 1
        key, bucket = uploaded[0]
        assert bucket == settings.s3_backup_bucket
        assert key.startswith("tarmacview-") and key.endswith(".dump")

        s = admin_settings.get_system_settings(backup_db)
        assert s["last_backup_status"] == "success"
        assert s["last_backup_at"] is not None

    def test_prunes_to_retention(self, backup_db, monkeypatch):
        """only the oldest dumps beyond the retention count are deleted."""
        existing = [_dump(f"tarmacview-2026010{i}-000000.dump") for i in range(1, 6)]
        deleted: list = []
        admin_settings.update_system_settings(backup_db, None, backup_retention_count=3)
        backup_db.commit()

        monkeypatch.setattr(backup_service, "_pg_dump", lambda path: None)
        monkeypatch.setattr(object_storage, "upload_file", lambda *a, **k: None)
        monkeypatch.setattr(object_storage, "list_objects", lambda bucket=None: list(existing))
        monkeypatch.setattr(
            object_storage,
            "delete_object",
            lambda key, bucket=None: deleted.append(key),
        )

        backup_service.run_backup(backup_db)

        # newest 3 kept, oldest 2 deleted
        assert deleted == [
            "tarmacview-20260102-000000.dump",
            "tarmacview-20260101-000000.dump",
        ]

    def test_failure_stamps_failed(self, backup_db, monkeypatch):
        """a pg_dump failure stamps a failed status and never uploads."""
        uploaded: list = []

        def boom(path):
            """simulate pg_dump failing."""
            raise subprocess.CalledProcessError(1, "pg_dump")

        monkeypatch.setattr(backup_service, "_pg_dump", boom)
        monkeypatch.setattr(
            object_storage,
            "upload_file",
            lambda *a, **k: uploaded.append(a),
        )

        result = backup_service.run_backup(backup_db)

        assert result["status"] == "failed"
        assert uploaded == []
        s = admin_settings.get_system_settings(backup_db)
        assert s["last_backup_status"].startswith("failed")
        assert s["last_backup_at"] is not None


class TestMaybeRunBackup:
    """beat-dispatched maybe_run_backup honours due-ness."""

    def test_runs_when_due(self, backup_db, monkeypatch):
        """maybe_run_backup runs a backup when one is due."""
        admin_settings.update_system_settings(backup_db, None, backup_enabled=True)
        backup_db.commit()
        admin_settings.record_backup_run(
            backup_db, at=datetime.now(timezone.utc) - timedelta(hours=48), status="success"
        )

        called: list = []
        monkeypatch.setattr(
            backup_service, "run_backup", lambda db: called.append(True) or {"status": "success"}
        )
        result = backup_service.maybe_run_backup(backup_db)
        assert called == [True]
        assert result == {"status": "success"}

    def test_skips_when_not_due(self, backup_db, monkeypatch):
        """maybe_run_backup is a no-op when disabled."""
        admin_settings.update_system_settings(backup_db, None, backup_enabled=False)
        backup_db.commit()

        called: list = []
        monkeypatch.setattr(backup_service, "run_backup", lambda db: called.append(True))
        result = backup_service.maybe_run_backup(backup_db)
        assert called == []
        assert result is None


class TestBackupRoutes:
    """admin backup endpoints."""

    def test_settings_round_trip(self, backup_client):
        """PUT writes the backup config and GET echoes it, with the change audited."""
        token = _admin_token(backup_client)
        resp = backup_client.put(
            "/api/v1/admin/system-settings",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "backup_enabled": True,
                "backup_interval_hours": 12,
                "backup_retention_count": 5,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["backup_enabled"] is True
        assert data["backup_interval_hours"] == 12
        assert data["backup_retention_count"] == 5

        resp = backup_client.get(
            "/api/v1/admin/system-settings",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.json()["backup_interval_hours"] == 12

        audit = backup_client.get(
            "/api/v1/admin/audit-log?action=SYSTEM_SETTING_CHANGE",
            headers={"Authorization": f"Bearer {token}"},
        )
        latest = audit.json()["data"][0]
        assert latest["details"].get("backup_enabled") is True

    def test_retention_zero_rejected(self, backup_client):
        """retention below 1 is rejected at the schema boundary."""
        token = _admin_token(backup_client)
        resp = backup_client.put(
            "/api/v1/admin/system-settings",
            headers={"Authorization": f"Bearer {token}"},
            json={"backup_retention_count": 0},
        )
        assert resp.status_code == 422

    def test_on_demand_trigger_enqueues_and_audits(self, backup_client, monkeypatch):
        """POST /backups enqueues a worker backup and records a BACKUP audit row."""
        from app.services import backup_service as svc

        called: list = []
        monkeypatch.setattr(svc, "enqueue_backup", lambda: called.append(True))

        token = _admin_token(backup_client)
        resp = backup_client.post(
            "/api/v1/admin/backups",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 202
        assert called == [True]

        audit = backup_client.get(
            "/api/v1/admin/audit-log?action=BACKUP",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert audit.json()["meta"]["total"] >= 1

    def test_list_backups_shape(self, backup_client, monkeypatch):
        """GET /backups returns sorted dumps plus last-run metadata."""
        monkeypatch.setattr(
            object_storage,
            "list_objects",
            lambda bucket=None: [
                _dump("tarmacview-20260101-000000.dump"),
                _dump("tarmacview-20260102-000000.dump"),
            ],
        )
        token = _admin_token(backup_client)
        resp = backup_client.get(
            "/api/v1/admin/backups",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        body = resp.json()
        keys = [b["key"] for b in body["backups"]]
        assert keys == [
            "tarmacview-20260102-000000.dump",
            "tarmacview-20260101-000000.dump",
        ]

    def test_operator_forbidden(self, backup_client):
        """operators cannot read or trigger backups."""
        token = _operator_token(backup_client)
        assert (
            backup_client.get(
                "/api/v1/admin/backups", headers={"Authorization": f"Bearer {token}"}
            ).status_code
            == 403
        )
        assert (
            backup_client.post(
                "/api/v1/admin/backups", headers={"Authorization": f"Bearer {token}"}
            ).status_code
            == 403
        )
