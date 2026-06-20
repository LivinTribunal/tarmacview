"""unit tests for the offline tile resolution chain (bundle -> disk -> upstream)."""

import sqlite3

import pytest

from app.core.config import settings
from app.services import tile_service

# minimal valid png + jpeg byte strings (header is enough for content-type sniffing)
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"\x00" * 200


@pytest.fixture(autouse=True)
def _tile_cache(tmp_path, monkeypatch):
    """point the tile cache at a temp dir and reset module state per test."""
    monkeypatch.setattr(settings, "tile_cache_dir", tmp_path)
    monkeypatch.setattr(settings, "tile_mode", "online")
    tile_service._MISSING_BUNDLES.clear()
    yield
    tile_service._MISSING_BUNDLES.clear()


def _write_bundle(layer: str, entries: list[tuple[int, int, int, bytes]]) -> None:
    """build an mbtiles bundle at the layer's local path with the given XYZ tiles."""
    path = tile_service._bundle_local_path(layer)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    try:
        conn.execute(
            "CREATE TABLE tiles "
            "(zoom_level integer, tile_column integer, tile_row integer, tile_data blob)"
        )
        for z, x, y, data in entries:
            conn.execute(
                "INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) "
                "VALUES (?, ?, ?, ?)",
                (z, x, tile_service._xyz_to_tms_row(y, z), data),
            )
        conn.commit()
    finally:
        conn.close()


def test_bundle_hit_returns_tile_and_png_content_type():
    """a tile present in the bundle is served with the XYZ->TMS flip applied."""
    _write_bundle("imagery", [(10, 552, 346, PNG_BYTES)])
    result = tile_service.get_tile("imagery", 10, 552, 346)
    assert result == (PNG_BYTES, "image/png")


def test_bundle_miss_then_disk_cache_hit(monkeypatch):
    """an empty bundle falls through to a disk-cached tile without hitting upstream."""
    _write_bundle("imagery", [])

    def _fail(*args, **kwargs):
        raise AssertionError("upstream must not be called on a disk-cache hit")

    monkeypatch.setattr(tile_service, "_fetch_upstream", _fail)
    tile_service._write_disk_cache("imagery", 5, 1, 2, JPEG_BYTES)
    result = tile_service.get_tile("imagery", 5, 1, 2)
    assert result == (JPEG_BYTES, "image/jpeg")


def test_offline_mode_returns_none_and_skips_upstream(monkeypatch):
    """offline mode never reaches upstream and returns a clean miss."""
    monkeypatch.setattr(settings, "tile_mode", "offline")

    def _fail(*args, **kwargs):
        raise AssertionError("upstream must not be called in offline mode")

    monkeypatch.setattr(tile_service, "_fetch_upstream", _fail)
    assert tile_service.get_tile("imagery", 1, 0, 0) is None


def test_cached_mode_proxies_upstream_once_then_serves_disk(monkeypatch):
    """upstream is fetched + written through once, then served from disk."""
    monkeypatch.setattr(settings, "tile_mode", "cached")
    calls = {"n": 0}

    def _fetch(layer, z, x, y):
        """count upstream calls and return png bytes."""
        calls["n"] += 1
        return PNG_BYTES

    monkeypatch.setattr(tile_service, "_fetch_upstream", _fetch)
    assert tile_service.get_tile("imagery", 3, 4, 5) == (PNG_BYTES, "image/png")
    assert tile_service.get_tile("imagery", 3, 4, 5) == (PNG_BYTES, "image/png")
    assert calls["n"] == 1


def test_unknown_layer_is_invalid():
    """layers outside the configured set are rejected."""
    assert tile_service.is_valid_layer("imagery") is True
    assert tile_service.is_valid_layer("nope") is False


def test_eviction_drops_oldest_and_never_touches_bundle(monkeypatch):
    """eviction shrinks the tiles dir under cap but leaves the bundle in place."""
    _write_bundle("imagery", [(1, 0, 0, PNG_BYTES)])
    bundle_path = tile_service._bundle_local_path("imagery")
    monkeypatch.setattr(settings, "tile_cache_max_bytes", 500)

    # write several tiles, each ~200 bytes, well over the 500-byte cap
    for i in range(5):
        tile_service._write_disk_cache("imagery", 2, i, 0, PNG_BYTES)

    tiles_dir = settings.tile_cache_dir / "tiles"
    total = sum(p.stat().st_size for p in tiles_dir.rglob("*") if p.is_file())
    assert total <= 500
    assert bundle_path.exists()


def test_content_type_sniffing():
    """magic-byte sniffing covers png / jpeg / webp / unknown fallback."""
    assert tile_service._sniff_content_type(PNG_BYTES) == "image/png"
    assert tile_service._sniff_content_type(JPEG_BYTES) == "image/jpeg"
    assert tile_service._sniff_content_type(b"RIFF\x00\x00\x00\x00WEBP....") == "image/webp"
    assert tile_service._sniff_content_type(b"garbage") == "image/jpeg"


def test_missing_minio_bundle_degrades_to_none(monkeypatch):
    """a missing minio bundle records the layer and returns None without raising."""

    def _raise(object_key, dest_path):
        raise RuntimeError("no such object")

    monkeypatch.setattr(tile_service.object_storage, "download_file", _raise)
    monkeypatch.setattr(settings, "tile_mode", "offline")
    assert tile_service._ensure_bundle("imagery") is None
    assert "imagery" in tile_service._MISSING_BUNDLES
    # second call short-circuits on the missing set, still None
    assert tile_service._ensure_bundle("imagery") is None


def test_stale_disk_cache_tile_is_dropped(monkeypatch):
    """a disk-cached tile older than the age cap is removed on read."""
    tile_service._write_disk_cache("imagery", 7, 1, 1, PNG_BYTES)
    path = tile_service._tile_cache_path("imagery", 7, 1, 1)
    # backdate the tile well past the 30-day cap
    import os

    old = path.stat().st_mtime - (40 * 86400)
    os.utime(path, (old, old))
    assert tile_service._read_from_disk_cache("imagery", 7, 1, 1) is None
    assert not path.exists()
