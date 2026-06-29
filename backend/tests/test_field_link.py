"""field-link status proxy - hub reachable, hub down, unconfigured, auth gate."""

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.exceptions import DomainError
from app.main import app
from app.schemas.field_link import FieldLinkStatusResponse
from app.services import field_link_service

WAYLINES_BODY = {
    "waylines": [
        {
            "id": "wl-1",
            "mission_id": "m-1",
            "name": "PAPI sweep",
            "drone_model_key": "0-99-1",
            "payload_model_keys": ["1-89-0"],
            "favorited": True,
            "username": "pilot",
            "create_time": 1700000000000,
            "update_time": 1700000100000,
            "object_key": "wayline/wl-1.kmz",
        }
    ]
}

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
        "rc_connected": False,
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


# wayline list/delete service seam (no db - httpx.MockTransport)


def test_list_waylines_maps_hub_payload(hub_configured):
    """hub answers -> mapped waylines with the secret header sent, object_key dropped."""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        """fake hub wayline-list endpoint."""
        seen["path"] = request.url.path
        seen["secret"] = request.headers.get("X-Hub-Secret")
        return httpx.Response(200, json=WAYLINES_BODY)

    result = field_link_service.list_field_link_waylines(transport=httpx.MockTransport(handler))

    assert seen["path"] == "/internal/api/v1/waylines"
    assert seen["secret"] == "s3cret"
    assert len(result.waylines) == 1
    wl = result.waylines[0]
    assert wl.id == "wl-1"
    assert wl.mission_id == "m-1"
    assert wl.name == "PAPI sweep"
    assert wl.drone_model_key == "0-99-1"
    assert wl.payload_model_keys == ["1-89-0"]
    assert wl.favorited is True
    assert wl.username == "pilot"
    assert wl.create_time == 1700000000000
    assert wl.update_time == 1700000100000
    assert not hasattr(wl, "object_key")


def test_list_waylines_degrades_when_hub_errors(hub_configured):
    """hub 5xx -> empty list, not an exception."""
    transport = httpx.MockTransport(lambda request: httpx.Response(503))

    result = field_link_service.list_field_link_waylines(transport=transport)

    assert result.waylines == []


def test_list_waylines_degrades_on_malformed_body(hub_configured):
    """a wayline missing required keys -> empty list, never a 500."""
    body = {"waylines": [{"id": "wl-1"}]}
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json=body))

    result = field_link_service.list_field_link_waylines(transport=transport)

    assert result.waylines == []


def test_list_waylines_skips_network_when_unconfigured(monkeypatch):
    """empty fieldhub_url -> empty list, no network attempt."""
    monkeypatch.setattr(settings, "fieldhub_url", "")

    def handler(request):
        """fail the test if any request goes out."""
        raise AssertionError("no request expected when fieldhub_url is unset")

    result = field_link_service.list_field_link_waylines(transport=httpx.MockTransport(handler))

    assert result.waylines == []


def test_delete_wayline_returns_true_on_deleted(hub_configured):
    """hub deleted:true -> True, DELETE verb + path + secret header sent."""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        """fake hub wayline-delete endpoint."""
        seen["method"] = request.method
        seen["path"] = request.url.path
        seen["secret"] = request.headers.get("X-Hub-Secret")
        return httpx.Response(200, json={"deleted": True})

    result = field_link_service.delete_field_link_wayline(
        "wl-1", transport=httpx.MockTransport(handler)
    )

    assert seen["method"] == "DELETE"
    assert seen["path"] == "/internal/api/v1/waylines/wl-1"
    assert seen["secret"] == "s3cret"
    assert result is True


def test_delete_wayline_returns_false_when_absent(hub_configured):
    """hub deleted:false -> False (route maps to 404)."""
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"deleted": False}))

    result = field_link_service.delete_field_link_wayline("wl-1", transport=transport)

    assert result is False


def test_delete_wayline_raises_502_when_hub_unreachable(hub_configured):
    """connection error -> DomainError(502), not a degraded bool."""

    def handler(request):
        """simulate a refused connection."""
        raise httpx.ConnectError("refused")

    with pytest.raises(DomainError) as exc:
        field_link_service.delete_field_link_wayline("wl-1", transport=httpx.MockTransport(handler))

    assert exc.value.status_code == 502


def test_delete_wayline_raises_502_when_unconfigured(monkeypatch):
    """empty fieldhub_url -> DomainError(502), no network attempt."""
    monkeypatch.setattr(settings, "fieldhub_url", "")

    def handler(request):
        """fail the test if any request goes out."""
        raise AssertionError("no request expected when fieldhub_url is unset")

    with pytest.raises(DomainError) as exc:
        field_link_service.delete_field_link_wayline("wl-1", transport=httpx.MockTransport(handler))

    assert exc.value.status_code == 502


# wayline list/delete routes (need the client fixture -> db)


def test_route_list_waylines_serves_service_response(client, monkeypatch):
    """route serves the service's mapped wayline list."""
    monkeypatch.setattr(
        field_link_service,
        "list_field_link_waylines",
        lambda: field_link_service.FieldLinkWaylineListResponse(
            waylines=[
                field_link_service.FieldLinkWayline(
                    id="wl-1",
                    mission_id="m-1",
                    name="PAPI sweep",
                    create_time=1,
                    update_time=2,
                )
            ]
        ),
    )

    response = client.get("/api/v1/field-link/waylines")

    assert response.status_code == 200
    body = response.json()
    assert len(body["waylines"]) == 1
    assert body["waylines"][0]["id"] == "wl-1"


def test_route_delete_wayline_204_on_deleted(client, monkeypatch):
    """deleted:true -> 204 No Content."""
    monkeypatch.setattr(field_link_service, "delete_field_link_wayline", lambda wid: True)

    response = client.delete("/api/v1/field-link/waylines/wl-1")

    assert response.status_code == 204


def test_route_delete_wayline_404_when_absent(client, monkeypatch):
    """deleted:false -> 404."""
    monkeypatch.setattr(field_link_service, "delete_field_link_wayline", lambda wid: False)

    response = client.delete("/api/v1/field-link/waylines/wl-1")

    assert response.status_code == 404


def test_route_delete_wayline_502_when_hub_down(client, monkeypatch):
    """service DomainError(502) -> 502."""

    def raise_502(wid):
        """simulate hub unreachable."""
        raise DomainError("field hub unreachable", status_code=502)

    monkeypatch.setattr(field_link_service, "delete_field_link_wayline", raise_502)

    response = client.delete("/api/v1/field-link/waylines/wl-1")

    assert response.status_code == 502
