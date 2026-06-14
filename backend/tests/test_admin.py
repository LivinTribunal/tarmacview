"""tests for super admin endpoints."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from testcontainers.postgres import PostgresContainer

import app.models  # noqa: F401
from app.core.config import settings
from app.core.database import Base, get_db
from app.core.enums import UserRole
from app.main import app
from app.models.airport import Airport
from app.models.user import User
from app.services.seeder import seed_users


@pytest.fixture(scope="module")
def admin_engine():
    """dedicated postgis database for admin tests."""
    with PostgresContainer(
        image="postgis/postgis:16-3.4",
        username="test",
        password="test",
        dbname="test_admin",
    ) as pg:
        engine = create_engine(pg.get_connection_url())
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
            conn.commit()

        Base.metadata.create_all(engine)
        yield engine
        Base.metadata.drop_all(engine)


@pytest.fixture(scope="module")
def admin_session_factory(admin_engine):
    """session factory for admin tests."""
    return sessionmaker(bind=admin_engine)


@pytest.fixture
def admin_db(admin_session_factory):
    """per-test session with rollback."""
    session = admin_session_factory()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture(scope="module")
def admin_client(admin_engine, admin_session_factory):
    """test client with db override."""

    def override_get_db():
        """test db override."""
        db = admin_session_factory()
        try:
            yield db
        finally:
            db.close()

    saved_overrides = dict(app.dependency_overrides)
    app.dependency_overrides.clear()
    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()
    app.dependency_overrides.update(saved_overrides)


@pytest.fixture(scope="module")
def seeded_admin_client(admin_client, admin_session_factory):
    """admin client with seed users created."""
    original = settings.seed_users
    settings.seed_users = True
    db = admin_session_factory()
    try:
        seed_users(db)
    finally:
        db.close()
        settings.seed_users = original

    return admin_client


def _get_admin_token(client):
    """helper to get admin access token."""
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@tmv.com", "password": "adminadmin"},
    )
    return resp.json()["access_token"]


def _get_operator_token(client):
    """helper to get operator access token."""
    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "operator@tmv.com", "password": "operator"},
    )
    return resp.json()["access_token"]


class TestAdminUserEndpoints:
    """test admin user management endpoints."""

    def test_list_users(self, seeded_admin_client):
        """admin can list all users."""
        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.get(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data
        assert "meta" in data
        assert len(data["data"]) >= 3

    def test_list_users_filter_role(self, seeded_admin_client):
        """admin can filter users by role."""
        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.get(
            "/api/v1/admin/users?role=SUPER_ADMIN",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert all(u["role"] == "SUPER_ADMIN" for u in data)

    def test_list_users_search(self, seeded_admin_client):
        """admin can search users by name or email."""
        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.get(
            "/api/v1/admin/users?search=admin",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert len(data) >= 1

    def test_operator_cannot_list_users(self, seeded_admin_client):
        """operator role is blocked from admin endpoints."""
        token = _get_operator_token(seeded_admin_client)
        resp = seeded_admin_client.get(
            "/api/v1/admin/users",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403

    def test_invite_user(self, seeded_admin_client):
        """admin can invite a new user."""
        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.post(
            "/api/v1/admin/users/invite",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "email": "newinvite@tarmacview.com",
                "name": "New Invite",
                "role": "OPERATOR",
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "invitation_link" in data
        assert data["user"]["email"] == "newinvite@tarmacview.com"
        # invited users are active so setup_password's is_active guard passes;
        # login still fails until they complete setup (no password set).
        assert data["user"]["is_active"] is True

    def test_invite_duplicate_email(self, seeded_admin_client):
        """inviting with existing email returns 409."""
        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.post(
            "/api/v1/admin/users/invite",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "email": "admin@tmv.com",
                "name": "Duplicate",
                "role": "OPERATOR",
            },
        )
        assert resp.status_code == 409

    def test_get_user(self, seeded_admin_client, admin_session_factory):
        """admin can get user detail."""
        db = admin_session_factory()
        try:
            user = db.query(User).filter(User.email == "operator@tmv.com").first()
            user_id = str(user.id)
        finally:
            db.close()

        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.get(
            f"/api/v1/admin/users/{user_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["email"] == "operator@tmv.com"

    def test_update_user(self, seeded_admin_client, admin_session_factory):
        """admin can update user fields."""
        db = admin_session_factory()
        try:
            user = db.query(User).filter(User.email == "operator@tmv.com").first()
            user_id = str(user.id)
        finally:
            db.close()

        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.put(
            f"/api/v1/admin/users/{user_id}",
            headers={"Authorization": f"Bearer {token}"},
            json={"name": "Updated Operator"},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated Operator"

    def test_deactivate_and_activate_user(self, seeded_admin_client, admin_session_factory):
        """admin can deactivate and reactivate a user."""
        db = admin_session_factory()
        try:
            user = User(
                email="toggle@tarmacview.com",
                name="Toggle User",
                role=UserRole.OPERATOR.value,
                is_active=True,
            )
            user.set_password("toggle123")
            db.add(user)
            db.commit()
            user_id = str(user.id)
        finally:
            db.close()

        token = _get_admin_token(seeded_admin_client)

        resp = seeded_admin_client.put(
            f"/api/v1/admin/users/{user_id}/deactivate",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["is_active"] is False

        resp = seeded_admin_client.put(
            f"/api/v1/admin/users/{user_id}/activate",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["is_active"] is True

    def test_delete_inactive_user(self, seeded_admin_client, admin_session_factory):
        """admin can delete an inactive user."""
        db = admin_session_factory()
        try:
            user = User(
                email="deleteme@tarmacview.com",
                name="Delete Me",
                role=UserRole.OPERATOR.value,
                is_active=False,
            )
            db.add(user)
            db.commit()
            user_id = str(user.id)
        finally:
            db.close()

        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.delete(
            f"/api/v1/admin/users/{user_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True

    def test_delete_active_user_blocked(self, seeded_admin_client, admin_session_factory):
        """cannot delete an active user."""
        db = admin_session_factory()
        try:
            user = User(
                email="nodelete@tarmacview.com",
                name="No Delete",
                role=UserRole.OPERATOR.value,
                is_active=True,
            )
            user.set_password("nodelete1")
            db.add(user)
            db.commit()
            user_id = str(user.id)
        finally:
            db.close()

        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.delete(
            f"/api/v1/admin/users/{user_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400

    def test_reset_password(self, seeded_admin_client, admin_session_factory):
        """admin can generate password reset link."""
        db = admin_session_factory()
        try:
            user = db.query(User).filter(User.email == "operator@tmv.com").first()
            user_id = str(user.id)
        finally:
            db.close()

        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.post(
            f"/api/v1/admin/users/{user_id}/reset-password",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert "invitation_link" in resp.json()

    def test_update_airport_assignments(self, seeded_admin_client, admin_session_factory):
        """admin can assign airports to a user."""
        db = admin_session_factory()
        try:
            airport = Airport(
                icao_code="ZZZZ",
                name="Test Airport",
                elevation=100.0,
                location="SRID=4326;POINTZ(17.0 48.0 100)",
            )
            db.add(airport)
            db.flush()
            airport_id = str(airport.id)

            user = db.query(User).filter(User.email == "operator@tmv.com").first()
            user_id = str(user.id)
            db.commit()
        finally:
            db.close()

        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.put(
            f"/api/v1/admin/users/{user_id}/airports",
            headers={"Authorization": f"Bearer {token}"},
            json={"airport_ids": [airport_id]},
        )
        assert resp.status_code == 200
        airports = resp.json()["airports"]
        assert any(a["id"] == airport_id for a in airports)

    def test_assign_orphaned_airport_from_user_page(
        self, seeded_admin_client, admin_session_factory
    ):
        """assigning an airport with no current assignees writes one row + one audit row."""
        from app.core.enums import AuditAction
        from app.models.audit_log import AuditLog
        from app.models.user import user_airports

        db = admin_session_factory()
        try:
            # an airport that nobody is assigned to yet. ORPN, not ORPH - the
            # orphan-counts test in TestAdminAirports owns ORPH on this shared db
            airport = Airport(
                icao_code="ORPN",
                name="Orphan Airport",
                elevation=120.0,
                location="SRID=4326;POINTZ(17.5 48.5 120)",
            )
            db.add(airport)
            db.flush()
            airport_id = str(airport.id)

            user = db.query(User).filter(User.email == "coord@tmv.com").first()
            user_id = str(user.id)

            assignees_before = (
                db.query(user_airports).filter(user_airports.c.airport_id == airport.id).count()
            )
            assert assignees_before == 0

            audit_before = (
                db.query(AuditLog)
                .filter(AuditLog.action == AuditAction.ASSIGN_AIRPORT.value)
                .count()
            )
            db.commit()
        finally:
            db.close()

        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.put(
            f"/api/v1/admin/users/{user_id}/airports",
            headers={"Authorization": f"Bearer {token}"},
            json={"airport_ids": [airport_id]},
        )
        assert resp.status_code == 200
        assert any(a["id"] == airport_id for a in resp.json()["airports"])

        db = admin_session_factory()
        try:
            # the user_airports row persisted for the formerly-orphaned airport
            row_count = (
                db.query(user_airports)
                .filter(
                    user_airports.c.user_id == user_id,
                    user_airports.c.airport_id == airport_id,
                )
                .count()
            )
            assert row_count == 1

            # exactly one ASSIGN_AIRPORT audit row was written for this call
            audit_after = (
                db.query(AuditLog)
                .filter(AuditLog.action == AuditAction.ASSIGN_AIRPORT.value)
                .count()
            )
            assert audit_after - audit_before == 1
        finally:
            db.close()


class TestAdminAccessControl:
    """test self-action and last-super-admin invariants."""

    def test_deactivate_clears_invitation_token(self, seeded_admin_client, admin_session_factory):
        """deactivating a user revokes any outstanding invitation link."""
        from datetime import datetime, timedelta, timezone
        from uuid import uuid4

        token_value = str(uuid4())
        db = admin_session_factory()
        try:
            user = User(
                email="invite-revoke@tarmacview.com",
                name="Invite Revoke",
                role=UserRole.OPERATOR.value,
                is_active=True,
                invitation_token=token_value,
                invitation_expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
            )
            db.add(user)
            db.commit()
            user_id = str(user.id)
        finally:
            db.close()

        admin_token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.put(
            f"/api/v1/admin/users/{user_id}/deactivate",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp.status_code == 200

        db = admin_session_factory()
        try:
            row = db.query(User).filter(User.id == user_id).first()
            assert row.is_active is False
            assert row.invitation_token is None
            assert row.invitation_expires_at is None
        finally:
            db.close()

    def test_admin_reset_password_rejects_inactive_user(
        self, seeded_admin_client, admin_session_factory
    ):
        """reset-password refuses to issue a fresh token for inactive users."""
        db = admin_session_factory()
        try:
            user = User(
                email="reset-inactive@tarmacview.com",
                name="Reset Inactive",
                role=UserRole.OPERATOR.value,
                is_active=False,
            )
            user.set_password("anchor123")
            db.add(user)
            db.commit()
            user_id = str(user.id)
        finally:
            db.close()

        admin_token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.post(
            f"/api/v1/admin/users/{user_id}/reset-password",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp.status_code == 403
        assert "deactivated" in resp.json()["detail"].lower()

        db = admin_session_factory()
        try:
            row = db.query(User).filter(User.id == user_id).first()
            assert row.invitation_token is None
        finally:
            db.close()

    def test_super_admin_cannot_self_deactivate(self, seeded_admin_client, admin_session_factory):
        """super admin is blocked from deactivating their own account."""
        admin_token = _get_admin_token(seeded_admin_client)
        db = admin_session_factory()
        try:
            admin = db.query(User).filter(User.email == "admin@tmv.com").first()
            admin_id = str(admin.id)
        finally:
            db.close()

        resp = seeded_admin_client.put(
            f"/api/v1/admin/users/{admin_id}/deactivate",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp.status_code == 400
        assert "own account" in resp.json()["detail"].lower()

        db = admin_session_factory()
        try:
            row = db.query(User).filter(User.id == admin_id).first()
            assert row.is_active is True
        finally:
            db.close()

    def test_super_admin_cannot_self_demote(self, seeded_admin_client, admin_session_factory):
        """super admin is blocked from demoting themselves out of super admin role."""
        admin_token = _get_admin_token(seeded_admin_client)
        db = admin_session_factory()
        try:
            admin = db.query(User).filter(User.email == "admin@tmv.com").first()
            admin_id = str(admin.id)
        finally:
            db.close()

        resp = seeded_admin_client.put(
            f"/api/v1/admin/users/{admin_id}",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"role": "OPERATOR"},
        )
        assert resp.status_code == 400
        assert "own account" in resp.json()["detail"].lower()

        db = admin_session_factory()
        try:
            row = db.query(User).filter(User.id == admin_id).first()
            assert row.role == UserRole.SUPER_ADMIN.value
        finally:
            db.close()

    def test_super_admin_cannot_self_delete(self, seeded_admin_client, admin_session_factory):
        """super admin is blocked from deleting their own account."""
        admin_token = _get_admin_token(seeded_admin_client)
        db = admin_session_factory()
        try:
            admin = db.query(User).filter(User.email == "admin@tmv.com").first()
            admin_id = str(admin.id)
        finally:
            db.close()

        resp = seeded_admin_client.delete(
            f"/api/v1/admin/users/{admin_id}",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp.status_code == 400
        assert "own account" in resp.json()["detail"].lower()

        db = admin_session_factory()
        try:
            row = db.query(User).filter(User.id == admin_id).first()
            assert row is not None
        finally:
            db.close()

    def test_last_super_admin_invariant_at_service_layer(self, admin_session_factory):
        """deactivating the sole active super admin raises domain error.

        the route gate forces actor to be an active super admin, so once the
        self-guard runs first the route can never reach the last-super-admin
        check on a different target. exercise it directly so the invariant
        survives future direct service callers (cli, scripts).
        """
        from app.core.exceptions import DomainError
        from app.services import admin_service as admin_svc

        db = admin_session_factory()
        try:
            sole = User(
                email="sole-sa@tarmacview.com",
                name="Sole Super Admin",
                role=UserRole.SUPER_ADMIN.value,
                is_active=True,
            )
            sole.set_password("solepass1")
            db.add(sole)
            db.flush()

            others = (
                db.query(User)
                .filter(
                    User.role == UserRole.SUPER_ADMIN.value,
                    User.is_active.is_(True),
                    User.id != sole.id,
                )
                .all()
            )
            for u in others:
                u.is_active = False
            db.flush()

            with pytest.raises(DomainError, match="last active super admin"):
                admin_svc._assert_not_last_super_admin(db, sole)

            others[0].is_active = True
            db.flush()
            admin_svc._assert_not_last_super_admin(db, sole)
        finally:
            db.rollback()
            db.close()

    def test_super_admin_can_deactivate_other_super_admin_when_one_remains(
        self, seeded_admin_client, admin_session_factory
    ):
        """deactivating one of two active super admins is allowed."""
        db = admin_session_factory()
        try:
            spare = User(
                email="spare-sa@tarmacview.com",
                name="Spare Super Admin",
                role=UserRole.SUPER_ADMIN.value,
                is_active=True,
            )
            spare.set_password("sparepass1")
            db.add(spare)
            db.commit()
            spare_id = str(spare.id)
        finally:
            db.close()

        admin_token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.put(
            f"/api/v1/admin/users/{spare_id}/deactivate",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["is_active"] is False


class TestSystemSettings:
    """test system settings endpoints."""

    def test_get_system_settings(self, seeded_admin_client):
        """admin can read system settings."""
        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.get(
            "/api/v1/admin/system-settings",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "maintenance_mode" in data
        assert "cesium_ion_token" in data
        assert "elevation_api_url" in data
        assert data["elevation_api_fallback_enabled"] is False

    def test_update_system_settings(self, seeded_admin_client):
        """admin can update system settings."""
        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.put(
            "/api/v1/admin/system-settings",
            headers={"Authorization": f"Bearer {token}"},
            json={"maintenance_mode": False, "cesium_ion_token": "test-token"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["maintenance_mode"] is False
        assert data["cesium_ion_token"] == "test-token"

    def test_update_elevation_api_fallback_enabled_round_trip(self, seeded_admin_client):
        """PUT/GET round-trips elevation_api_fallback_enabled and audits the change."""
        from app.services import runtime_settings

        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.put(
            "/api/v1/admin/system-settings",
            headers={"Authorization": f"Bearer {token}"},
            json={"elevation_api_fallback_enabled": True},
        )
        assert resp.status_code == 200
        assert resp.json()["elevation_api_fallback_enabled"] is True

        # the runtime cache must have been invalidated by the route
        assert runtime_settings._CACHE.get("elevation_api_fallback_enabled") is None

        resp = seeded_admin_client.get(
            "/api/v1/admin/system-settings",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["elevation_api_fallback_enabled"] is True

        audit = seeded_admin_client.get(
            "/api/v1/admin/audit-log?action=SYSTEM_SETTING_CHANGE",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert audit.status_code == 200
        latest = audit.json()["data"][0]
        assert latest["details"].get("elevation_api_fallback_enabled") is True

    def test_cache_invalidated_after_commit_not_before(
        self, seeded_admin_client, admin_session_factory, monkeypatch
    ):
        """cache invalidation runs after db.commit() so racing reads see the new value.

        regression: invalidating inside the service (after flush, before route commit)
        let a concurrent reader load the OLD committed value from its own session and
        repopulate the cache with stale data. the route must drop the cache only after
        commit, so the first racing read after invalidation loads the new value.
        """
        from app.models.system_settings import SystemSettings
        from app.services import runtime_settings

        # ground the row in a known committed state so the post-commit assertion
        # below is meaningful regardless of test-execution order
        setup_db = admin_session_factory()
        try:
            row = (
                setup_db.query(SystemSettings)
                .filter(SystemSettings.key == "elevation_api_fallback_enabled")
                .first()
            )
            if row:
                row.value = "false"
            else:
                setup_db.add(SystemSettings(key="elevation_api_fallback_enabled", value="false"))
            setup_db.commit()
        finally:
            setup_db.close()

        runtime_settings.invalidate("elevation_api_fallback_enabled")

        call_log: list[str] = []
        real_invalidate = runtime_settings.invalidate

        def tracking_invalidate(key: str | None = None) -> None:
            """record each invalidate call so we can assert ordering vs commit."""
            # when invalidate runs, the row must already be visible to a fresh session
            # (i.e. db.commit() has happened) - otherwise a racing reader would cache
            # the old value before the new one becomes visible
            with admin_session_factory() as fresh:
                row = (
                    fresh.query(SystemSettings)
                    .filter(SystemSettings.key == "elevation_api_fallback_enabled")
                    .first()
                )
                committed_value = row.value if row else None
            call_log.append(f"invalidate:{key or '*'}:committed={committed_value}")
            real_invalidate(key)

        def tracking_load(_db) -> bool:
            """simulate the racing reader: load from a fresh session (sees committed only)."""
            with admin_session_factory() as fresh:
                row = (
                    fresh.query(SystemSettings)
                    .filter(SystemSettings.key == "elevation_api_fallback_enabled")
                    .first()
                )
                value = row is not None and str(row.value).lower() == "true"
            call_log.append(f"load:{value}")
            return value

        monkeypatch.setattr(
            "app.api.routes.admin.runtime_settings.invalidate",
            tracking_invalidate,
        )
        monkeypatch.setattr(
            "app.services.runtime_settings._load_api_fallback_enabled",
            tracking_load,
        )

        token = _get_admin_token(seeded_admin_client)
        try:
            resp = seeded_admin_client.put(
                "/api/v1/admin/system-settings",
                headers={"Authorization": f"Bearer {token}"},
                json={"elevation_api_fallback_enabled": True},
            )
            assert resp.status_code == 200

            # invalidate fired once, AFTER commit (the fresh session saw the new value)
            assert call_log == ["invalidate:elevation_api_fallback_enabled:committed=true"]
            assert runtime_settings._CACHE.get("elevation_api_fallback_enabled") is None

            # a follow-up reader must repopulate the cache with the new value
            reader_db = admin_session_factory()
            try:
                assert runtime_settings.get_api_fallback_enabled(reader_db) is True
            finally:
                reader_db.close()

            assert call_log[-1] == "load:True"
        finally:
            # global _CACHE is module-level state - reset row + cache so trajectory
            # tests don't inherit the True value via their own runtime_settings reads
            cleanup_db = admin_session_factory()
            try:
                row = (
                    cleanup_db.query(SystemSettings)
                    .filter(SystemSettings.key == "elevation_api_fallback_enabled")
                    .first()
                )
                if row:
                    row.value = "false"
                    cleanup_db.commit()
            finally:
                cleanup_db.close()
            runtime_settings.invalidate("elevation_api_fallback_enabled")

    def test_cache_not_invalidated_when_flag_absent(self, seeded_admin_client, monkeypatch):
        """invalidate is skipped when the request body omits elevation_api_fallback_enabled."""
        from app.services import runtime_settings

        invalidate_log: list[str] = []
        real_invalidate = runtime_settings.invalidate

        def tracking_invalidate(key: str | None = None) -> None:
            """track invalidate calls."""
            invalidate_log.append(key or "*")
            real_invalidate(key)

        monkeypatch.setattr(
            "app.api.routes.admin.runtime_settings.invalidate",
            tracking_invalidate,
        )

        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.put(
            "/api/v1/admin/system-settings",
            headers={"Authorization": f"Bearer {token}"},
            json={"maintenance_mode": False},
        )
        assert resp.status_code == 200
        assert invalidate_log == []

    def test_operator_can_read_but_not_update_settings(self, seeded_admin_client):
        """GET system settings is open to any authenticated user; PUT stays super-admin only.

        the read path also redacts admin-only fields for non-super-admins -
        cesium_ion_token and elevation_api_url come back as empty strings so
        the widened GET cannot leak credentials to coordinators / operators.
        shared toggles (elevation_api_fallback_enabled, maintenance_mode) stay
        readable - that's the whole point of widening the endpoint.
        """
        # seed real values via super-admin PUT so the redaction has something
        # to hide
        admin_token = _get_admin_token(seeded_admin_client)
        seeded_admin_client.put(
            "/api/v1/admin/system-settings",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "cesium_ion_token": "secret-cesium",
                "elevation_api_url": "https://elev.example/lookup",
                "elevation_api_fallback_enabled": False,
                "maintenance_mode": False,
            },
        )

        token = _get_operator_token(seeded_admin_client)
        resp = seeded_admin_client.get(
            "/api/v1/admin/system-settings",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        # admin-only fields blanked
        assert data["cesium_ion_token"] == ""
        assert data["elevation_api_url"] == ""
        # shared toggles still readable
        assert data["elevation_api_fallback_enabled"] is False
        assert data["maintenance_mode"] is False

        # super-admin sees the real values
        admin_resp = seeded_admin_client.get(
            "/api/v1/admin/system-settings",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert admin_resp.status_code == 200
        admin_data = admin_resp.json()
        assert admin_data["cesium_ion_token"] == "secret-cesium"
        assert admin_data["elevation_api_url"] == "https://elev.example/lookup"

        write = seeded_admin_client.put(
            "/api/v1/admin/system-settings",
            headers={"Authorization": f"Bearer {token}"},
            json={"maintenance_mode": True},
        )
        assert write.status_code == 403


class TestElevationProviderSettings:
    """system-settings round-trip for elevation_api_provider + elevation_api_key."""

    def test_provider_round_trip(self, seeded_admin_client):
        """PUT then GET round-trips the provider key."""
        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.put(
            "/api/v1/admin/system-settings",
            headers={"Authorization": f"Bearer {token}"},
            json={"elevation_api_provider": "OPEN_ELEVATION"},
        )
        assert resp.status_code == 200
        assert resp.json()["elevation_api_provider"] == "OPEN_ELEVATION"

        get_resp = seeded_admin_client.get(
            "/api/v1/admin/system-settings",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert get_resp.json()["elevation_api_provider"] == "OPEN_ELEVATION"

    def test_unknown_provider_rejected_422(self, seeded_admin_client):
        """unknown provider keys are rejected at the wire or service layer."""
        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.put(
            "/api/v1/admin/system-settings",
            headers={"Authorization": f"Bearer {token}"},
            json={"elevation_api_provider": "GPXZ"},
        )
        # pydantic Literal -> 422 at the wire; service-layer guard would also surface 422
        assert resp.status_code in (400, 422)

    def test_api_key_masked_on_read(self, seeded_admin_client, admin_session_factory):
        """writing an api key persists the ciphertext; GET returns the mask sentinel."""
        from app.core import config as core_config
        from app.models.system_settings import SystemSettings

        prev_key = core_config.settings.secret_encryption_key
        core_config.settings.secret_encryption_key = "test-key-for-fernet-derivation-2026"
        try:
            token = _get_admin_token(seeded_admin_client)
            resp = seeded_admin_client.put(
                "/api/v1/admin/system-settings",
                headers={"Authorization": f"Bearer {token}"},
                json={"elevation_api_key": "raw-plaintext-key"},
            )
            assert resp.status_code == 200
            assert resp.json()["elevation_api_key"] == "••••••"

            get_resp = seeded_admin_client.get(
                "/api/v1/admin/system-settings",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert get_resp.json()["elevation_api_key"] == "••••••"

            # raw DB column never returns the plaintext - it's a Fernet token
            with admin_session_factory() as fresh:
                row = (
                    fresh.query(SystemSettings)
                    .filter(SystemSettings.key == "elevation_api_key")
                    .first()
                )
                assert row is not None
                assert row.value != "raw-plaintext-key"
                assert row.value != "••••••"
                assert len(row.value) > 0
        finally:
            core_config.settings.secret_encryption_key = prev_key

    def test_api_key_mask_sentinel_on_put_is_noop(self, seeded_admin_client, admin_session_factory):
        """sending the mask sentinel on PUT preserves the stored key (noop write)."""
        from app.models.system_settings import SystemSettings

        token = _get_admin_token(seeded_admin_client)
        # echo the sentinel back as the operator's UI would when editing other fields
        resp = seeded_admin_client.put(
            "/api/v1/admin/system-settings",
            headers={"Authorization": f"Bearer {token}"},
            json={"elevation_api_key": "••••••"},
        )
        assert resp.status_code == 200

        # the column should not have been overwritten with "••••••" verbatim
        with admin_session_factory() as fresh:
            row = (
                fresh.query(SystemSettings)
                .filter(SystemSettings.key == "elevation_api_key")
                .first()
            )
            if row is not None:
                assert row.value != "••••••"

    def test_runtime_cache_invalidated_for_provider_and_key(self, seeded_admin_client):
        """PUT drops the runtime cache entries for the new provider + key keys."""
        from app.services import runtime_settings

        # seed cache values so we can prove invalidation runs
        runtime_settings._CACHE["elevation_api_provider"] = "OPEN_ELEVATION"
        runtime_settings._CACHE["elevation_api_key"] = None

        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.put(
            "/api/v1/admin/system-settings",
            headers={"Authorization": f"Bearer {token}"},
            json={"elevation_api_provider": "OPEN_ELEVATION"},
        )
        assert resp.status_code == 200
        assert "elevation_api_provider" not in runtime_settings._CACHE


class TestAuditLog:
    """test audit log endpoints."""

    def test_list_audit_logs(self, seeded_admin_client):
        """admin can list audit logs."""
        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.get(
            "/api/v1/admin/audit-log",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data
        assert "meta" in data

    def test_audit_log_has_login_entry(self, seeded_admin_client):
        """login creates audit log entry."""
        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.get(
            "/api/v1/admin/audit-log?action=LOGIN",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert len(data) >= 1
        assert data[0]["action"] == "LOGIN"

    def test_export_audit_log_csv(self, seeded_admin_client):
        """admin can export audit log as csv."""
        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.get(
            "/api/v1/admin/audit-log/export",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert "text/csv" in resp.headers.get("content-type", "")

    def test_operator_cannot_access_audit_log(self, seeded_admin_client):
        """operator cannot access audit log."""
        token = _get_operator_token(seeded_admin_client)
        resp = seeded_admin_client.get(
            "/api/v1/admin/audit-log",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403

    def test_system_settings_audit_redacts_token(self, seeded_admin_client):
        """cesium_ion_token is redacted in audit log details."""
        token = _get_admin_token(seeded_admin_client)
        seeded_admin_client.put(
            "/api/v1/admin/system-settings",
            headers={"Authorization": f"Bearer {token}"},
            json={"cesium_ion_token": "secret-token-value"},
        )
        resp = seeded_admin_client.get(
            "/api/v1/admin/audit-log?action=SYSTEM_SETTING_CHANGE",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        entries = resp.json()["data"]
        assert len(entries) >= 1
        details = entries[0]["details"]
        assert details.get("cesium_ion_token") == "***"
        assert "secret-token-value" not in str(details)

    def test_audit_log_server_side_sort(self, seeded_admin_client):
        """audit log supports server-side sorting."""
        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.get(
            "/api/v1/admin/audit-log?sort_by=action&sort_dir=asc",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        if len(data) >= 2:
            actions = [e["action"] for e in data]
            assert actions == sorted(actions)


class TestAdminAirports:
    """test admin airport overview endpoints."""

    def test_list_airports_admin(self, seeded_admin_client):
        """admin can list airports with counts."""
        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.get(
            "/api/v1/admin/airports",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert "data" in resp.json()

    def test_drone_count_is_per_airport(self, seeded_admin_client, admin_session_factory):
        """drone_count reflects distinct drones used at each airport, not global total."""
        from app.models.mission import DroneProfile, Mission

        db = admin_session_factory()
        try:
            airport_a = Airport(
                icao_code="AAAA",
                name="Airport A",
                elevation=50.0,
                location="SRID=4326;POINTZ(10.0 40.0 50)",
            )
            airport_b = Airport(
                icao_code="BBBB",
                name="Airport B",
                elevation=60.0,
                location="SRID=4326;POINTZ(11.0 41.0 60)",
            )
            drone1 = DroneProfile(name="Drone 1")
            drone2 = DroneProfile(name="Drone 2")
            db.add_all([airport_a, airport_b, drone1, drone2])
            db.flush()

            # airport A gets two missions with different drones
            db.add(Mission(name="M1", airport_id=airport_a.id, drone_profile_id=drone1.id))
            db.add(Mission(name="M2", airport_id=airport_a.id, drone_profile_id=drone2.id))
            # airport B gets one mission with one drone
            db.add(Mission(name="M3", airport_id=airport_b.id, drone_profile_id=drone1.id))
            db.commit()
        finally:
            db.close()

        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.get(
            "/api/v1/admin/airports",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        airports = {a["icao_code"]: a for a in resp.json()["data"]}
        assert airports["AAAA"]["drone_count"] == 2
        assert airports["BBBB"]["drone_count"] == 1

    def test_count_subqueries_resolve_all_four_counts(self, admin_session_factory):
        """list_airports_admin returns correct user/coordinator/mission/drone counts."""
        from app.services import admin_service

        db = admin_session_factory()
        try:
            from app.models.mission import DroneProfile, Mission

            airport_a = Airport(
                icao_code="ZZZA",
                name="Counts A",
                elevation=10.0,
                location="SRID=4326;POINTZ(12.0 42.0 10)",
            )
            airport_b = Airport(
                icao_code="ZZZB",
                name="Counts B",
                elevation=20.0,
                location="SRID=4326;POINTZ(13.0 43.0 20)",
            )
            db.add_all([airport_a, airport_b])
            db.flush()

            # airport A: one operator + one coordinator assigned
            op = User(
                email="counts-op@tmv.com",
                name="Counts Op",
                role=UserRole.OPERATOR.value,
            )
            coord = User(
                email="counts-coord@tmv.com",
                name="Counts Coord",
                role=UserRole.COORDINATOR.value,
            )
            op.airports = [airport_a]
            coord.airports = [airport_a]
            db.add_all([op, coord])

            d1 = DroneProfile(name="Counts Drone 1")
            d2 = DroneProfile(name="Counts Drone 2")
            db.add_all([d1, d2])
            db.flush()

            # airport A: 3 missions, 2 distinct drones (one mission has no drone)
            db.add(Mission(name="CA1", airport_id=airport_a.id, drone_profile_id=d1.id))
            db.add(Mission(name="CA2", airport_id=airport_a.id, drone_profile_id=d2.id))
            db.add(Mission(name="CA3", airport_id=airport_a.id, drone_profile_id=None))
            # airport B: 1 mission, 1 drone, no users
            db.add(Mission(name="CB1", airport_id=airport_b.id, drone_profile_id=d1.id))
            db.commit()

            rows = {r["icao_code"]: r for r in admin_service.list_airports_admin(db)}
        finally:
            db.rollback()
            db.close()

        a = rows["ZZZA"]
        assert a["user_count"] == 2
        assert a["coordinator_count"] == 1
        assert a["operator_count"] == 1
        assert a["mission_count"] == 3
        assert a["drone_count"] == 2

        b = rows["ZZZB"]
        assert b["user_count"] == 0
        assert b["coordinator_count"] == 0
        assert b["operator_count"] == 0
        assert b["mission_count"] == 1
        assert b["drone_count"] == 1

    def test_orphaned_airport_reports_zero_coordinator_and_operator(
        self, seeded_admin_client, admin_session_factory
    ):
        """the admin list surfaces an airport with no coordinator/operator as orphaned."""
        db = admin_session_factory()
        try:
            orphaned = Airport(
                icao_code="ORPD",
                name="Orphaned Field",
                elevation=10.0,
                location="SRID=4326;POINTZ(14.0 44.0 10)",
            )
            assigned = Airport(
                icao_code="ASGN",
                name="Assigned Field",
                elevation=10.0,
                location="SRID=4326;POINTZ(15.0 45.0 10)",
            )
            db.add_all([orphaned, assigned])
            db.flush()

            coord = User(
                email="orph-coord@tmv.com",
                name="Orph Coord",
                role=UserRole.COORDINATOR.value,
            )
            coord.airports = [assigned]
            db.add(coord)
            db.commit()
        finally:
            db.close()

        token = _get_admin_token(seeded_admin_client)
        resp = seeded_admin_client.get(
            "/api/v1/admin/airports",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        airports = {a["icao_code"]: a for a in resp.json()["data"]}

        assert airports["ORPD"]["coordinator_count"] == 0
        assert airports["ORPD"]["operator_count"] == 0
        assert airports["ASGN"]["coordinator_count"] == 1
