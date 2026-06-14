"""terrain DEM upload/delete + open-elevation download + airport lon/lat."""

import logging
import time
from uuid import UUID

import httpx
from sqlalchemy.orm import Session

from app.core.config import TERRAIN_DIR, settings
from app.core.exceptions import DomainError, NotFoundError
from app.core.geometry import wkt_to_geojson
from app.models.airport import Airport
from app.services.airport.altitude import renormalize_airport_altitudes

logger = logging.getLogger(__name__)

# geotiff nodata sentinel - the raster fill value and the band nodata flag must
# stay identical or rasterio reads filled cells as real elevations.
GEOTIFF_NODATA = -9999

# per-batch ceiling on the open-elevation http timeout, even when the overall
# download budget still has more headroom.
MAX_BATCH_TIMEOUT_SECONDS = 60.0


def upload_terrain_dem(
    db: Session,
    airport_id: UUID,
    file_path: str,
    terrain_source: str = "DEM_UPLOAD",
    *,
    renormalize: bool = True,
) -> tuple[Airport, str | None]:
    """set airport terrain source. returns (airport, old_dem_path) so caller
    can unlink the previous file after committing.

    when ``renormalize`` is true (the default) we run
    :func:`renormalize_airport_altitudes` so existing obstacles / AGLs / LHAs /
    mission takeoff-landing coords resample against the new DEM. without this,
    only entities created AFTER the upload would benefit from the per-point
    elevations and old rows would silently keep their old flat altitudes.
    pass ``renormalize=False`` to opt out - validated
    missions keep their altitudes intact, but exported KMZs may mix old +
    new ground references until the next manual recompute.
    """
    airport = db.query(Airport).filter(Airport.id == airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")

    old_path = airport.dem_file_path

    airport.terrain_source = terrain_source
    airport.dem_file_path = file_path
    db.flush()

    # always rerun for DEM uploads when renormalize is True - even a re-upload of
    # the same source value produces new per-point altitudes against the new
    # file. callers only pass DEM_UPLOAD / DEM_API here; FLAT reverts go through
    # delete_terrain_dem.
    if renormalize:
        renormalize_airport_altitudes(db, airport_id)

    db.refresh(airport)

    return airport, old_path


def get_dem_file_path(db: Session, airport_id: UUID) -> str | None:
    """get dem_file_path for an airport without eager-loading infrastructure."""
    airport = db.query(Airport).filter(Airport.id == airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")
    return airport.dem_file_path


def delete_terrain_dem(db: Session, airport_id: UUID, *, renormalize: bool = True) -> Airport:
    """reset airport terrain source to FLAT and remove DEM path.

    when ``renormalize`` is true (the default) and the previous terrain source
    was not already FLAT, we re-run :func:`renormalize_airport_altitudes` so
    positions snap back to whatever the flat / API-fallback provider returns.
    without the rerun, existing rows would keep DEM-sampled altitudes that no
    longer match the airport's active provider. pass
    ``renormalize=False`` to leave persisted altitudes unchanged - validated
    missions stay validated at the cost of consistency with the new provider.
    """
    airport = db.query(Airport).filter(Airport.id == airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")

    old_terrain_source = airport.terrain_source

    airport.terrain_source = "FLAT"
    airport.dem_file_path = None
    db.flush()

    if old_terrain_source != "FLAT" and renormalize:
        renormalize_airport_altitudes(db, airport_id)

    db.refresh(airport)

    return airport


def get_airport_lonlat(airport: Airport) -> tuple[float, float]:
    """extract lon, lat from airport location geometry."""
    loc = airport.location
    if isinstance(loc, str):
        parsed = wkt_to_geojson(loc)
        coords = parsed.get("coordinates", []) if parsed else []
        if len(coords) < 2:
            raise DomainError("airport location is missing coordinates", status_code=400)
        return coords[0], coords[1]

    coords = loc.get("coordinates", []) if isinstance(loc, dict) else []
    if len(coords) < 2:
        raise DomainError("airport location is missing coordinates", status_code=400)
    return coords[0], coords[1]


def download_terrain_for_location(
    airport_id: UUID,
    apt_lon: float,
    apt_lat: float,
    fallback_elevation: float,
) -> dict:
    """download elevation data from open-elevation API and cache as geotiff.

    session-free - safe to call from a thread pool executor.
    returns file metadata dict; caller is responsible for persisting to db.
    """
    try:
        import numpy as np
        import rasterio
        from rasterio.transform import from_bounds
    except ImportError as e:
        raise DomainError(
            "rasterio/numpy not installed - terrain download not available",
            status_code=501,
        ) from e

    delta_deg = settings.terrain_grid_delta_deg
    min_lon = apt_lon - delta_deg
    max_lon = apt_lon + delta_deg
    min_lat = apt_lat - delta_deg
    max_lat = apt_lat + delta_deg

    step = settings.terrain_grid_step_deg
    lats = []
    lons = []
    lat = min_lat
    while lat <= max_lat:
        lats.append(lat)
        lat += step
    lon = min_lon
    while lon <= max_lon:
        lons.append(lon)
        lon += step

    # build locations for API query
    locations = []
    for la in lats:
        for lo in lons:
            locations.append({"latitude": round(la, 6), "longitude": round(lo, 6)})

    # batch query open-elevation API
    batch_size = settings.terrain_api_batch_size
    all_elevations = []
    total_timeout = settings.terrain_download_timeout
    start_time = time.monotonic()

    try:
        with httpx.Client() as http_client:
            for i in range(0, len(locations), batch_size):
                elapsed = time.monotonic() - start_time
                remaining = total_timeout - elapsed
                if remaining <= 0:
                    raise DomainError(
                        f"terrain download timed out after {elapsed:.0f}s "
                        f"({len(all_elevations)}/{len(locations)} points)",
                        status_code=504,
                    )

                batch = locations[i : i + batch_size]
                batch_timeout = min(MAX_BATCH_TIMEOUT_SECONDS, remaining)
                resp = http_client.post(
                    settings.open_elevation_url,
                    json={"locations": batch},
                    timeout=batch_timeout,
                )
                resp.raise_for_status()
                results = resp.json().get("results", [])

                if len(results) != len(batch):
                    missing = len(batch) - len(results)
                    logger.warning(
                        "short batch response (%d/%d) from elevation API - "
                        "filling %d missing cells with fallback_elevation=%.1f",
                        len(results),
                        len(batch),
                        missing,
                        fallback_elevation,
                    )

                for r in results:
                    raw = r.get("elevation")
                    if raw is not None:
                        try:
                            all_elevations.append(float(raw))
                        except (TypeError, ValueError):
                            all_elevations.append(fallback_elevation)
                    else:
                        all_elevations.append(fallback_elevation)

                # fill missing cells from short batch with fallback
                short_count = len(batch) - len(results)
                for _ in range(short_count):
                    all_elevations.append(fallback_elevation)
    except DomainError:
        raise
    except Exception as e:
        logger.error("open-elevation request failed: %s", e)
        raise DomainError("terrain download failed - upstream API error", status_code=502) from e

    # build geotiff raster
    height = len(lats)
    width = len(lons)
    data = np.full((height, width), GEOTIFF_NODATA, dtype=np.float32)

    idx = 0
    for row in range(height):
        for col in range(width):
            if idx < len(all_elevations):
                data[row][col] = all_elevations[idx]
            idx += 1

    # flip rows - raster origin is top-left
    data = np.flipud(data)

    TERRAIN_DIR.mkdir(parents=True, exist_ok=True)
    final_path = TERRAIN_DIR / f"{airport_id}_api_cache.tif"

    transform = from_bounds(min_lon, min_lat, max_lon, max_lat, width, height)
    with rasterio.open(
        str(final_path),
        "w",
        driver="GTiff",
        height=height,
        width=width,
        count=1,
        dtype="float32",
        crs="EPSG:4326",
        transform=transform,
        nodata=GEOTIFF_NODATA,
    ) as dst:
        dst.write(data, 1)

    return {
        "terrain_source": "DEM_API",
        "points_downloaded": len(all_elevations),
        "bounds": [min_lon, min_lat, max_lon, max_lat],
        "resolution": [step, step],
        "file_path": str(final_path),
    }
