"""route-level tests for the offline terrain endpoint."""

import gzip

from app.services import terrain_service


def test_layer_json_served_200(client, monkeypatch):
    """a resolved layer.json returns 200 with json content-type + cache header."""
    monkeypatch.setattr(
        terrain_service, "get_terrain_file", lambda *a, **k: (b"{}", "application/json", None)
    )
    resp = client.get("/api/v1/terrain/layer.json")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/json"
    assert resp.content == b"{}"
    assert "max-age" in resp.headers["cache-control"]


def test_gzip_terrain_sets_content_encoding(client, monkeypatch):
    """a gzip-encoded .terrain tile returns 200 with content-encoding: gzip."""
    payload = gzip.compress(b"quantised-mesh-tile")
    monkeypatch.setattr(
        terrain_service,
        "get_terrain_file",
        lambda *a, **k: (payload, "application/octet-stream", "gzip"),
    )
    resp = client.get("/api/v1/terrain/5/1/2.terrain")
    assert resp.status_code == 200
    assert resp.headers["content-encoding"] == "gzip"
    # httpx transparently inflates the body on read
    assert resp.content == b"quantised-mesh-tile"


def test_miss_returns_404(client, monkeypatch):
    """a clean miss returns 404 (not 204) so cesium's parser handles absence cleanly."""
    monkeypatch.setattr(terrain_service, "get_terrain_file", lambda *a, **k: None)
    resp = client.get("/api/v1/terrain/5/1/2.terrain")
    assert resp.status_code == 404


def test_endpoint_requires_no_auth(client):
    """the terrain route declares no auth dependency - reachable without a user gate."""
    from app.api.routes.terrain import get_terrain

    assert "current_user" not in get_terrain.__annotations__
