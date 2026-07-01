"""pluggable elevation provider abstraction for terrain-following altitude.

remote elevation lookups are a separate strategy from the DEM / flat providers.
:class:`RemoteElevationProvider` is the abstract seam; :class:`OpenElevationProvider`
is the first concrete implementation. :data:`REMOTE_PROVIDER_REGISTRY` maps the
admin-selected backend key to its class so a future provider lands as one class
plus one registry entry.

:func:`create_elevation_provider` returns a bare DEM / flat provider unless the
caller explicitly opts in with ``allow_api=True`` AND the master toggle is on
AND the resolved provider would be flat. DEM short-circuits the wrap because
DEM is authoritative.
"""

from __future__ import annotations

import logging
import math
import threading
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)


class ElevationProvider(ABC):
    """base class for terrain elevation data sources."""

    @abstractmethod
    def get_elevation(self, lat: float, lon: float) -> float:
        """return ground elevation in meters MSL at given point."""

    @abstractmethod
    def get_elevations_batch(self, points: list[tuple[float, float]]) -> list[float]:
        """return ground elevations for a batch of (lat, lon) points."""


class FlatElevationProvider(ElevationProvider):
    """returns constant airport elevation for all queries."""

    def __init__(self, airport_elevation: float):
        """initialize with airport elevation."""
        self.elevation = airport_elevation

    def get_elevation(self, lat: float, lon: float) -> float:
        """return airport elevation for any point."""
        return self.elevation

    def get_elevations_batch(self, points: list[tuple[float, float]]) -> list[float]:
        """return airport elevation for all points."""
        return [self.elevation] * len(points)


class DEMElevationProvider(ElevationProvider):
    """reads terrain elevation from a GeoTIFF file via rasterio."""

    def __init__(self, file_path: str, fallback_elevation: float):
        """open raster dataset and cache handle."""
        import rasterio

        self.fallback_elevation = fallback_elevation
        self.file_path = file_path
        self._dataset = rasterio.open(file_path)

    def get_elevation(self, lat: float, lon: float) -> float:
        """sample raster at (lon, lat) - rasterio uses x=lon, y=lat."""
        try:
            values = list(self._dataset.sample([(lon, lat)]))
            if values and len(values[0]) > 0:
                val = float(values[0][0])
                nodata = self._dataset.nodata
                if nodata is not None and val == nodata:
                    return self.fallback_elevation
                if math.isnan(val):
                    return self.fallback_elevation
                return val
        except Exception as e:
            logger.warning(
                "DEM sample failed at lat=%.6f lon=%.6f: %s, using fallback", lat, lon, e
            )

        return self.fallback_elevation

    def get_elevations_batch(self, points: list[tuple[float, float]]) -> list[float]:
        """batch sample - points are (lat, lon) tuples."""
        if not points:
            return []

        coords = [(lon, lat) for lat, lon in points]
        results: list[float] = []

        try:
            nodata = self._dataset.nodata
            for val_array in self._dataset.sample(coords):
                val = float(val_array[0])
                if (nodata is not None and val == nodata) or math.isnan(val):
                    results.append(self.fallback_elevation)
                else:
                    results.append(val)
        except Exception as e:
            remaining = len(points) - len(results)
            logger.warning(
                "DEM batch sample failed after %d/%d points: %s, using fallback for rest",
                len(results),
                len(points),
                e,
            )
            results.extend([self.fallback_elevation] * remaining)

        return results

    def close(self):
        """close the raster dataset."""
        if hasattr(self, "_dataset") and self._dataset:
            self._dataset.close()
            self._dataset = None

    def __enter__(self):
        """support use as context manager."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """close dataset on context exit."""
        self.close()
        return False


# remote-lookup keys are rounded to this many decimal places before keying the
# in-process cache, so nearby clicks reuse a single network query. ~1.1 m at 5dp.
_REMOTE_CACHE_DECIMALS = 5
_REMOTE_CACHE_MAX = 1024


class RemoteElevationProvider(ABC):
    """abstract remote elevation backend - one HTTP lookup per point."""

    @abstractmethod
    def lookup(self, lat: float, lon: float) -> float | None:
        """try one remote query at (lat, lon); return None on any failure."""


class OpenElevationProvider(RemoteElevationProvider):
    """concrete Open-Elevation implementation of :class:`RemoteElevationProvider`."""

    def __init__(self, api_key: str | None = None):
        """store optional api key - open-elevation ignores it but the seam is uniform."""
        self.api_key = api_key

    def lookup(self, lat: float, lon: float) -> float | None:
        """POST one (lat, lon) to Open-Elevation and return the parsed elevation."""
        import httpx

        from app.core.config import settings

        timeout = getattr(settings, "elevation_api_lookup_timeout", 2.0)
        url = settings.open_elevation_url
        try:
            with httpx.Client(timeout=timeout) as http_client:
                resp = http_client.post(
                    url,
                    json={"locations": [{"latitude": lat, "longitude": lon}]},
                )
                resp.raise_for_status()
                results = resp.json().get("results", [])
                if not results:
                    return None
                raw = results[0].get("elevation")
                if raw is None:
                    return None
                return float(raw)
        except Exception as e:
            logger.warning(
                "open-elevation lookup failed at lat=%.6f lon=%.6f: %s; using flat fallback",
                lat,
                lon,
                e,
            )
            return None


# strategy dispatch: admin-selected backend key -> RemoteElevationProvider class.
# narrow union today; a future provider lands as one class plus one entry here.
REMOTE_PROVIDER_REGISTRY: dict[str, type[RemoteElevationProvider]] = {
    "OPEN_ELEVATION": OpenElevationProvider,
}

# default backend key when no admin selection is persisted - single source for
# runtime_settings / admin_service. distinct from the registry dict key above:
# that literal is a registry identifier, this is the default-selection value.
DEFAULT_REMOTE_PROVIDER_KEY = "OPEN_ELEVATION"


class _RemoteAwareFlatProvider(ElevationProvider):
    """wraps a flat provider with a remote backend; queries are cached per request.

    falls back to the wrapped FlatElevationProvider on any error (network
    failure, non-2xx, missing entry, master toggle off). gated by the DB-backed
    ``elevation_api_fallback_enabled`` system_settings row, read through the
    ``runtime_settings`` cache so the per-call site does not hit the DB and
    super-admin toggles take effect on the next request.

    cache is in-process FIFO keyed on rounded (lat, lon); a single instance is
    shared within one request through ``_normalize_position_altitude`` and the
    renormalize-airport loop.

    no ``close()`` method - this wrapper owns no file handle; the httpx client
    is scoped to each ``lookup`` call inside the remote backend.
    """

    def __init__(
        self,
        fallback: FlatElevationProvider,
        remote: RemoteElevationProvider,
        db=None,
    ):
        """wrap a flat fallback provider with a configured remote backend."""
        self._fallback = fallback
        self._remote = remote
        self._cache: dict[tuple[float, float], float] = {}
        self._lock = threading.Lock()
        self._db = db

    def _enabled(self) -> bool:
        """return whether the master toggle is on; reads runtime cache when db present."""
        from app.core.config import settings
        from app.services import runtime_settings

        if self._db is not None:
            return runtime_settings.get_api_fallback_enabled(self._db)
        return bool(getattr(settings, "elevation_api_fallback_enabled", False))

    def _resolve(self, lat: float, lon: float) -> tuple[float, bool]:
        """return (elevation, came_from_api) for one point, cached."""
        key = (round(lat, _REMOTE_CACHE_DECIMALS), round(lon, _REMOTE_CACHE_DECIMALS))
        with self._lock:
            cached = self._cache.get(key)
        if cached is not None:
            return cached, True
        if not self._enabled():
            return self._fallback.get_elevation(lat, lon), False
        value = self._remote.lookup(lat, lon)
        if value is None:
            return self._fallback.get_elevation(lat, lon), False
        with self._lock:
            if len(self._cache) >= _REMOTE_CACHE_MAX:
                # crude FIFO - drop the oldest inserted entry; the working set is tiny
                self._cache.pop(next(iter(self._cache)))
            self._cache[key] = value
        return value, True

    def get_elevation(self, lat: float, lon: float) -> float:
        """try the remote backend, otherwise return the flat fallback."""
        elevation, _ = self._resolve(lat, lon)
        return elevation

    def get_elevation_with_source(self, lat: float, lon: float) -> tuple[float, str]:
        """return (elevation, source_label) - source is API or FLAT."""
        elevation, from_api = self._resolve(lat, lon)
        return elevation, "API" if from_api else "FLAT"

    def get_elevations_batch(self, points: list[tuple[float, float]]) -> list[float]:
        """sample each point individually - small per-request fanout, cache hits dominate."""
        return [self.get_elevation(lat, lon) for lat, lon in points]


def _resolve_remote_backend(db) -> RemoteElevationProvider | None:
    """instantiate the admin-selected remote backend; return None if it can't be resolved."""
    from app.services import runtime_settings

    provider_key = (
        runtime_settings.get_api_provider(db) if db is not None else DEFAULT_REMOTE_PROVIDER_KEY
    )
    try:
        api_key = runtime_settings.get_api_key(db) if db is not None else None
    except Exception as e:
        # a missing / rotated SECRET_ENCRYPTION_KEY must not 500 callers on the
        # allow_api path (e.g. LHA placement) - the remote backend just can't be
        # configured here, so degrade to flat instead of crashing.
        logger.warning("remote elevation key unavailable (%s) - falling back to flat", e)
        return None
    cls = REMOTE_PROVIDER_REGISTRY.get(provider_key)
    if cls is None:
        logger.warning(
            "unknown remote elevation provider key %r - falling back to flat", provider_key
        )
        return None
    return cls(api_key=api_key)


def resolve_dem_file_path(stored_path: str | None) -> str | None:
    """map a stored dem_file_path to a tarmacview-local absolute path.

    a legacy absolute path (e.g. into the old drone-mission-planning-module
    repo) that no longer exists, or a portable basename, both resolve to
    settings.terrain_dir / <basename>. an absolute path that still exists is
    returned as-is (custom deployments).
    """
    if not stored_path:
        return None

    import os

    from app.core.config import settings

    if os.path.isabs(stored_path) and os.path.exists(stored_path):
        return stored_path
    return str(settings.terrain_dir / os.path.basename(stored_path))


def create_elevation_provider(airport, *, allow_api: bool = False, db=None) -> ElevationProvider:
    """select provider based on airport terrain source and the opt-in flag.

    ``allow_api=False`` (default) returns a bare DEM / flat provider with no
    remote-lookup wrap. ``allow_api=True`` wraps a flat-resolved provider with
    the admin-selected remote backend so per-point queries hit the configured
    service before falling back to ``airport.elevation``. DEM-backed providers
    ignore the flag because they already vary by (lat, lon). The optional ``db``
    session is forwarded to the wrapper so it can read the DB-backed
    ``elevation_api_fallback_enabled`` row through the runtime cache (no DB hit
    on cache hit, lazy seed on miss, invalidated by admin update).
    """
    terrain_source = getattr(airport, "terrain_source", None) or "FLAT"

    if terrain_source in ("DEM", "DEM_UPLOAD", "DEM_API", "DEM_SRTM"):
        dem_path = resolve_dem_file_path(getattr(airport, "dem_file_path", None))
        if dem_path:
            try:
                return DEMElevationProvider(dem_path, airport.elevation)
            except ImportError:
                logger.warning("rasterio not installed, falling back to flat elevation")
            except Exception as e:
                logger.warning("failed to create DEM provider: %s, falling back to flat", e)

    flat = FlatElevationProvider(airport.elevation)
    if not allow_api:
        return flat
    remote = _resolve_remote_backend(db)
    if remote is None:
        return flat
    return _RemoteAwareFlatProvider(flat, remote, db=db)


def resolve_elevation_with_source(
    provider: ElevationProvider, terrain_source: str, lat: float, lon: float
) -> tuple[float, str]:
    """sample one point and label the source so the route can surface it."""
    if isinstance(provider, _RemoteAwareFlatProvider):
        return provider.get_elevation_with_source(lat, lon)

    elevation = provider.get_elevation(lat, lon)
    if isinstance(provider, DEMElevationProvider):
        source = (
            terrain_source
            if terrain_source in ("DEM_UPLOAD", "DEM_API", "DEM_SRTM")
            else "DEM_UPLOAD"
        )
    else:
        source = "FLAT"
    return elevation, source
