"""offline cesium terrain - minio quantised-mesh tileset -> disk cache, served same-origin."""

import logging
from pathlib import Path

from app.core.config import settings
from app.services import object_storage

logger = logging.getLogger(__name__)

# object keys confirmed absent from minio - skip re-downloading every request
_MISSING: set[str] = set()


def _is_safe_relpath(rel_path: str) -> bool:
    """reject path traversal: empty, absolute, backslash, or `..` / empty segments."""
    if not rel_path or rel_path.startswith("/") or "\\" in rel_path:
        return False
    return all(part not in ("", "..") for part in rel_path.split("/"))


def _content_type(rel_path: str) -> str:
    """json for layer.json, octet-stream for the quantised-mesh .terrain tiles."""
    return "application/json" if rel_path.endswith(".json") else "application/octet-stream"


def _cache_path(rel_path: str) -> Path:
    """local path the terrain file is cached at after the minio pull."""
    return settings.tile_cache_dir / "terrain" / rel_path


def _read_object(rel_path: str) -> bytes | None:
    """return the file bytes from disk cache or minio, pulling + caching once."""
    key = f"{settings.terrain_bundle_prefix}/{rel_path}"
    if key in _MISSING:
        return None
    path = _cache_path(rel_path)
    if path.exists():
        return path.read_bytes()
    try:
        data = object_storage.get_object(key)
    except Exception:
        logger.warning("terrain object %s unavailable from minio", key, exc_info=True)
        _MISSING.add(key)
        return None
    # best-effort write-through to the disk cache
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    except OSError:
        logger.warning("failed to write terrain cache %s", rel_path, exc_info=True)
    return data


def get_terrain_file(rel_path: str) -> tuple[bytes, str, str | None] | None:
    """resolve one terrain file: disk cache -> minio. returns (bytes, content_type, encoding)."""
    if not _is_safe_relpath(rel_path):
        return None
    data = _read_object(rel_path)
    if data is None:
        return None
    # ctb writes gzip-compressed .terrain tiles; let the client inflate transparently
    encoding = "gzip" if data[:2] == b"\x1f\x8b" else None
    return data, _content_type(rel_path), encoding
