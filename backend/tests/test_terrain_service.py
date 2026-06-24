"""unit tests for the offline terrain resolution chain (disk cache -> minio)."""

import pytest

from app.core.config import settings
from app.services import terrain_service


@pytest.fixture(autouse=True)
def _terrain_cache(tmp_path, monkeypatch):
    """point the terrain cache at a temp dir and reset module state per test."""
    monkeypatch.setattr(settings, "tile_cache_dir", tmp_path)
    terrain_service._MISSING.clear()
    yield
    terrain_service._MISSING.clear()


def test_layer_json_from_minio_caches_and_sets_json_type(monkeypatch):
    """layer.json resolves from minio, caches to disk, and is typed application/json."""
    calls = {"n": 0}

    def _get(key):
        """count minio reads and return a quantised-mesh layer descriptor."""
        calls["n"] += 1
        return b'{"format":"quantized-mesh-1.0"}'

    monkeypatch.setattr(terrain_service.object_storage, "get_object", _get)
    result = terrain_service.get_terrain_file("layer.json")
    assert result == (b'{"format":"quantized-mesh-1.0"}', "application/json", None)
    # second call serves from the disk cache, no second minio read
    terrain_service.get_terrain_file("layer.json")
    assert calls["n"] == 1


def test_terrain_tile_gzip_encoding_detected(monkeypatch):
    """a gzip-magic .terrain tile is octet-stream with gzip encoding."""
    monkeypatch.setattr(
        terrain_service.object_storage, "get_object", lambda key: b"\x1f\x8b\x08rest"
    )
    data, content_type, encoding = terrain_service.get_terrain_file("5/1/2.terrain")
    assert content_type == "application/octet-stream"
    assert encoding == "gzip"


def test_plain_terrain_tile_no_encoding(monkeypatch):
    """bytes without the gzip magic carry no content-encoding."""
    monkeypatch.setattr(terrain_service.object_storage, "get_object", lambda key: b"plainbytes")
    _, _, encoding = terrain_service.get_terrain_file("5/1/2.terrain")
    assert encoding is None


def test_missing_object_degrades_to_none_and_records(monkeypatch):
    """a missing minio object returns None, records the key, and short-circuits next time."""
    calls = {"n": 0}

    def _raise(key):
        calls["n"] += 1
        raise RuntimeError("no such object")

    monkeypatch.setattr(terrain_service.object_storage, "get_object", _raise)
    assert terrain_service.get_terrain_file("9/3/4.terrain") is None
    assert f"{settings.terrain_bundle_prefix}/9/3/4.terrain" in terrain_service._MISSING
    # second call short-circuits on the missing set without re-fetching
    assert terrain_service.get_terrain_file("9/3/4.terrain") is None
    assert calls["n"] == 1


def test_path_traversal_rejected(monkeypatch):
    """traversal / absolute / empty-segment paths return None and never hit minio."""

    def _fail(key):
        raise AssertionError("get_object must not be called on an unsafe path")

    monkeypatch.setattr(terrain_service.object_storage, "get_object", _fail)
    for bad in ("../secrets", "/etc/passwd", "a//b", "", "a\\b"):
        assert terrain_service.get_terrain_file(bad) is None
