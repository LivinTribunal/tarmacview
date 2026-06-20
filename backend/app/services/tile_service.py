"""raster map tiles - minio mbtiles bundle -> disk cache -> upstream cdn chain."""

import logging
import sqlite3
import threading
import time
from pathlib import Path

import httpx

from app.core.config import settings
from app.services import object_storage

logger = logging.getLogger(__name__)

# guards the one-time per-layer bundle download from minio
_BUNDLE_LOCK = threading.Lock()
# layers confirmed absent from minio - skip re-downloading every request
_MISSING_BUNDLES: set[str] = set()
# sub-threshold upstream responses are blank/error tiles, not imagery
MIN_TILE_BYTES = 100


def is_valid_layer(layer: str) -> bool:
    """true when layer is one of the configured tile layers."""
    return layer in settings.tile_upstream_urls


def _xyz_to_tms_row(y: int, z: int) -> int:
    """flip an XYZ tile row to the TMS row mbtiles stores (origin at bottom)."""
    return (1 << z) - 1 - y


def _sniff_content_type(data: bytes) -> str:
    """guess the image media type from the tile's magic bytes."""
    if data[:4] == b"\x89PNG":
        return "image/png"
    if data[:2] == b"\xff\xd8":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"


def _format_upstream_url(template: str, z: int, x: int, y: int) -> str:
    """substitute {z}/{x}/{y} placeholders in an upstream tile url template."""
    return template.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))


def _bundle_local_path(layer: str) -> Path:
    """local path the layer's mbtiles bundle is cached at after the minio pull."""
    return settings.tile_cache_dir / "bundles" / f"{layer}.mbtiles"


def _tile_cache_path(layer: str, z: int, x: int, y: int) -> Path:
    """local path for one previously-proxied tile (raw bytes, no extension)."""
    return settings.tile_cache_dir / "tiles" / layer / str(z) / str(x) / str(y)


def _ensure_bundle(layer: str) -> Path | None:
    """return the local mbtiles path, pulling it from minio once if needed."""
    if layer in _MISSING_BUNDLES:
        return None
    path = _bundle_local_path(layer)
    if path.exists():
        return path
    with _BUNDLE_LOCK:
        if path.exists():
            return path
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            object_storage.download_file(
                f"{settings.tile_bundle_prefix}/{layer}.mbtiles", str(path)
            )
        except Exception:
            logger.warning("tile bundle %s unavailable from minio", layer, exc_info=True)
            _MISSING_BUNDLES.add(layer)
            return None
    return path


def _read_from_bundle(layer: str, z: int, x: int, y: int) -> bytes | None:
    """read one tile from the layer's mbtiles bundle, applying the XYZ->TMS flip."""
    path = _ensure_bundle(layer)
    if path is None:
        return None
    # fresh read-only connection per request - sync routes run in a threadpool
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            row = conn.execute(
                "SELECT tile_data FROM tiles "
                "WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
                (z, x, _xyz_to_tms_row(y, z)),
            ).fetchone()
        finally:
            conn.close()
    except sqlite3.Error:
        logger.warning("tile bundle %s read failed", layer, exc_info=True)
        return None
    return row[0] if row else None


def _read_from_disk_cache(layer: str, z: int, x: int, y: int) -> bytes | None:
    """read one previously-proxied tile from disk, dropping it if stale."""
    path = _tile_cache_path(layer, z, x, y)
    if not path.exists():
        return None
    if settings.tile_cache_max_age_days > 0:
        max_age = settings.tile_cache_max_age_days * 86400
        if (path.stat().st_mtime + max_age) < time.time():
            path.unlink(missing_ok=True)
            return None
    return path.read_bytes()


def _write_disk_cache(layer: str, z: int, x: int, y: int, data: bytes) -> None:
    """persist one proxied tile to the disk cache, then evict if over cap."""
    path = _tile_cache_path(layer, z, x, y)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    except OSError:
        logger.warning("failed to write tile cache %s/%s/%s/%s", layer, z, x, y, exc_info=True)
        return
    _evict_if_over_cap()


def _evict_if_over_cap() -> None:
    """drop the oldest proxied tiles until the cache is back under its size cap."""
    tiles_dir = settings.tile_cache_dir / "tiles"
    if not tiles_dir.exists():
        return
    try:
        files = [p for p in tiles_dir.rglob("*") if p.is_file()]
        total = sum(p.stat().st_size for p in files)
        if total <= settings.tile_cache_max_bytes:
            return
        for p in sorted(files, key=lambda f: f.stat().st_mtime):
            if total <= settings.tile_cache_max_bytes:
                break
            size = p.stat().st_size
            p.unlink(missing_ok=True)
            total -= size
    except OSError:
        logger.warning("tile cache eviction failed", exc_info=True)


def _fetch_upstream(layer: str, z: int, x: int, y: int) -> bytes | None:
    """fetch one tile from the layer's upstream cdn, or None on error/blank."""
    template = settings.tile_upstream_urls.get(layer)
    if not template:
        return None
    try:
        resp = httpx.get(
            _format_upstream_url(template, z, x, y),
            timeout=settings.tile_upstream_timeout,
            follow_redirects=True,
        )
        resp.raise_for_status()
    except httpx.HTTPError:
        logger.warning("upstream tile fetch failed for %s/%s/%s/%s", layer, z, x, y, exc_info=True)
        return None
    data = resp.content
    return data if len(data) >= MIN_TILE_BYTES else None


def get_tile(layer: str, z: int, x: int, y: int) -> tuple[bytes, str] | None:
    """resolve one tile: bundle -> disk cache -> upstream (unless offline)."""
    data = _read_from_bundle(layer, z, x, y)
    if data is not None:
        return data, _sniff_content_type(data)

    data = _read_from_disk_cache(layer, z, x, y)
    if data is not None:
        return data, _sniff_content_type(data)

    if settings.tile_mode != "offline":
        data = _fetch_upstream(layer, z, x, y)
        if data is not None:
            _write_disk_cache(layer, z, x, y, data)
            return data, _sniff_content_type(data)

    return None
