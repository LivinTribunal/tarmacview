"""unit tests for the maintenance-mode predicates extracted from main.py."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from jose import jwt

from app.core.config import settings
from app.main import _is_maintenance_exempt_path, _is_super_admin_request
from app.services import auth_service


class TestMaintenanceExemptPath:
    """paths that bypass the 503 while maintenance mode is on."""

    def test_auth_prefix_exempt(self):
        """auth endpoints stay reachable."""
        assert _is_maintenance_exempt_path("/api/v1/auth/login")

    def test_admin_prefix_exempt(self):
        """admin endpoints stay reachable."""
        assert _is_maintenance_exempt_path("/api/v1/admin/users")

    def test_health_exact_exempt(self):
        """the health check is reachable (exact match)."""
        assert _is_maintenance_exempt_path("/api/v1/health")

    def test_docs_and_openapi_exempt(self):
        """api docs and the openapi schema stay reachable."""
        assert _is_maintenance_exempt_path("/api/docs")
        assert _is_maintenance_exempt_path("/api/openapi.json")

    def test_regular_route_not_exempt(self):
        """ordinary api routes are gated."""
        assert not _is_maintenance_exempt_path("/api/v1/missions")

    def test_health_prefix_only_not_exempt(self):
        """health is matched exactly, not by prefix."""
        assert not _is_maintenance_exempt_path("/api/v1/healthcheck")


def _token(role: str, *, token_type: str = "access", expired: bool = False) -> str:
    """encode a jwt for the super-admin predicate under test."""
    exp = datetime.now(timezone.utc) + timedelta(minutes=-5 if expired else 30)
    payload = {"sub": str(uuid4()), "role": role, "type": token_type, "exp": exp}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


class TestSuperAdminRequest:
    """super-admin bearer-token predicate."""

    def test_valid_super_admin_access_token(self):
        """a valid SUPER_ADMIN access token passes."""
        token = auth_service.create_access_token(uuid4(), "SUPER_ADMIN")
        assert _is_super_admin_request(f"Bearer {token}")

    def test_missing_header(self):
        """no header -> not a super-admin request."""
        assert not _is_super_admin_request("")

    def test_non_bearer_header(self):
        """a non-bearer scheme -> not a super-admin request."""
        token = auth_service.create_access_token(uuid4(), "SUPER_ADMIN")
        assert not _is_super_admin_request(f"Basic {token}")

    def test_wrong_role(self):
        """a valid token for a non-super-admin role is rejected."""
        assert not _is_super_admin_request(f"Bearer {_token('OPERATOR')}")

    def test_refresh_token_rejected(self):
        """a refresh token (type != access) is rejected even for super admin."""
        token = _token("SUPER_ADMIN", token_type="refresh")
        assert not _is_super_admin_request(f"Bearer {token}")

    def test_expired_token(self):
        """an expired token is rejected (DomainError swallowed)."""
        assert not _is_super_admin_request(f"Bearer {_token('SUPER_ADMIN', expired=True)}")
