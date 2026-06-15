"""field-link status proxy - hub reachable, hub down, unconfigured, auth gate."""

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.schemas.field_link import FieldLinkStatusResponse
from app.services import field_link_service

HUB_BODY = {
    "broker_connected": True,
    "connect_url": "https://192.168.8.50:8443",
    "public_host": "192.168.8.50",
    "devices": [
        {
            "sn": "1ZNBJ7R0010078",
            "domain": 0,
            "model_key": "0-89-0",
            "model_name": "Matrice 350 RTK",
            "nickname": None,
            "gateway_sn": "5YSZK1400B00A1",
            "online": True,
            "bound": True,
            "bound_at": "2026-06-09T10:00:00+00:00",
        }
    ],
}


@pytest.fixture
def hub_configured(monkeypatch):
    """point the service at a fake hub url with a secret."""
    monkeypatch.setattr(settings, "fieldhub_url", "https://fieldhub:8443")
    monkeypatch.setattr(settings, "fieldhub_shared_secret", "s3cret")


def test_status_happy_path_maps_hub_payload(hub_configured):
    """hub answers -> hub_online with mapped devices and the secret header sent."""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        """fake hub internal endpoint."""
        seen["path"] = request.url.path
        seen["secret"] = request.headers.get("X-Hub-Secret")
        return httpx.Response(200, json=HUB_BODY)

    result = field_link_service.get_field_link_status(transport=httpx.MockTransport(handler))

    assert seen["path"] == "/internal/api/v1/status"
    assert seen["secret"] == "s3cret"
    assert result.hub_online is True
    assert result.broker_connected is True
    assert result.connect_url == "https://192.168.8.50:8443"
    assert result.public_host == "192.168.8.50"
    assert result.devices[0].sn == "1ZNBJ7R0010078"
    assert result.devices[0].model_name == "Matrice 350 RTK"
    assert result.devices[0].online is True


def test_status_leaves_connect_url_none_when_hub_omits_it(hub_configured):
    """a hub body without the connect fields maps to None, not a KeyError."""
    body = {"broker_connected": True, "devices": []}
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=body))

    result = field_link_service.get_field_link_status(transport=transport)

    assert result.hub_online is True
    assert result.connect_url is None
    assert result.public_host is None


def test_no_hub_leaves_connect_url_none(hub_configured):
    """degraded response carries no connect address."""
    transport = httpx.MockTransport(lambda request: httpx.Response(503))

    result = field_link_service.get_field_link_status(transport=transport)

    assert result.connect_url is None
    assert result.public_host is None


def test_status_degrades_when_hub_errors(hub_configured):
    """hub 5xx -> degraded offline response, not an exception."""
    transport = httpx.MockTransport(lambda request: httpx.Response(503))

    result = field_link_service.get_field_link_status(transport=transport)

    assert result == FieldLinkStatusResponse(hub_online=False)


def test_status_degrades_when_hub_unreachable(hub_configured):
    """connection error -> degraded offline response."""

    def handler(request):
        """simulate a refused connection."""
        raise httpx.ConnectError("refused")

    result = field_link_service.get_field_link_status(transport=httpx.MockTransport(handler))

    assert result.hub_online is False
    assert result.devices == []


def test_status_degrades_on_malformed_hub_body(hub_configured):
    """garbage device entries -> degraded offline response, never a 500."""
    body = {"broker_connected": True, "devices": ["not-a-device"]}
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=body))

    result = field_link_service.get_field_link_status(transport=transport)

    assert result.hub_online is False


def test_status_skips_network_when_unconfigured(monkeypatch):
    """empty fieldhub_url -> no hub, no network attempt."""
    monkeypatch.setattr(settings, "fieldhub_url", "")

    def handler(request):
        """fail the test if any request goes out."""
        raise AssertionError("no request expected when fieldhub_url is unset")

    result = field_link_service.get_field_link_status(transport=httpx.MockTransport(handler))

    assert result == FieldLinkStatusResponse(hub_online=False)


def test_route_returns_degraded_payload(client, monkeypatch):
    """backend up, hub absent -> 200 with the degraded shape."""
    monkeypatch.setattr(settings, "fieldhub_url", "")

    response = client.get("/api/v1/field-link/status")

    assert response.status_code == 200
    assert response.json() == {
        "hub_online": False,
        "broker_connected": False,
        "devices": [],
        "connect_url": None,
        "public_host": None,
    }


def test_route_maps_hub_payload(client, monkeypatch):
    """route serves the service's mapped response."""
    monkeypatch.setattr(
        field_link_service,
        "get_field_link_status",
        lambda: FieldLinkStatusResponse(hub_online=True, broker_connected=True),
    )

    response = client.get("/api/v1/field-link/status")

    assert response.status_code == 200
    body = response.json()
    assert body["hub_online"] is True
    assert body["broker_connected"] is True


def test_route_requires_auth():
    """401 without a jwt."""
    saved_overrides = dict(app.dependency_overrides)
    app.dependency_overrides.clear()
    try:
        response = TestClient(app).get("/api/v1/field-link/status")
        assert response.status_code == 401
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(saved_overrides)


def test_ca_cert_serves_the_configured_file(client, monkeypatch, tmp_path):
    """a configured CA file downloads as an attachment."""
    ca_file = tmp_path / "ca.crt"
    ca_file.write_text("-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n")
    monkeypatch.setattr(settings, "fieldhub_ca", str(ca_file))

    response = client.get("/api/v1/field-link/ca-cert")

    assert response.status_code == 200
    assert "fieldhub-ca.crt" in response.headers["content-disposition"]
    assert response.content.startswith(b"-----BEGIN CERTIFICATE-----")


def test_ca_cert_404_when_unconfigured(client, monkeypatch):
    """no CA configured -> 404, not a 500."""
    monkeypatch.setattr(settings, "fieldhub_ca", "")

    assert client.get("/api/v1/field-link/ca-cert").status_code == 404


def test_ca_cert_404_when_file_missing(client, monkeypatch):
    """configured path that doesn't exist -> 404."""
    monkeypatch.setattr(settings, "fieldhub_ca", "/no/such/ca.crt")

    assert client.get("/api/v1/field-link/ca-cert").status_code == 404
