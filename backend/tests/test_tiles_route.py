"""route-level tests for the offline tile endpoint."""

from app.services import tile_service

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200


def test_tile_served_from_bundle(client, monkeypatch):
    """a resolved tile returns 200 with the sniffed content-type + cache header."""
    monkeypatch.setattr(tile_service, "get_tile", lambda *a, **k: (PNG_BYTES, "image/png"))
    resp = client.get("/api/v1/tiles/imagery/10/552/346")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content == PNG_BYTES
    assert "max-age" in resp.headers["cache-control"]


def test_clean_miss_returns_204(client, monkeypatch):
    """a clean miss returns 204 with an empty body."""
    monkeypatch.setattr(tile_service, "get_tile", lambda *a, **k: None)
    resp = client.get("/api/v1/tiles/imagery/10/552/346")
    assert resp.status_code == 204
    assert resp.content == b""


def test_unknown_layer_returns_404(client):
    """an unknown layer is rejected before any resolution."""
    resp = client.get("/api/v1/tiles/bogus/1/0/0")
    assert resp.status_code == 404


def test_invalid_zoom_rejected(client):
    """zoom outside [0, 24] is a 422 from the path validator."""
    assert client.get("/api/v1/tiles/imagery/-1/0/0").status_code == 422
    assert client.get("/api/v1/tiles/imagery/99/0/0").status_code == 422


def test_endpoint_requires_no_auth(client):
    """the tile route declares no auth dependency - reachable without a user gate."""
    from app.api.routes.tiles import get_tile

    params = get_tile.__annotations__
    # no OperatorUser / CoordinatorUser / Depends gate in the signature
    assert "current_user" not in params
