"""terrain DEM upload / download / delete with own filesystem cleanup."""

import asyncio
import logging
import os
import shutil
import tempfile
from functools import partial
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile
from sqlalchemy.orm import Session

from app.api.dependencies import CoordinatorUser, check_airport_access
from app.core.config import settings
from app.core.database import get_db
from app.core.enums import AuditAction
from app.core.exceptions import DomainError, NotFoundError
from app.schemas.airport import (
    TerrainCoverage,
    TerrainDownloadResponse,
    TerrainUploadResponse,
)
from app.schemas.common import DeleteResponse
from app.services import airport_service
from app.utils.audit import log_audit

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_DEM_SIZE = 500 * 1024 * 1024  # 500MB


def _stream_upload_to_tempfile(file: UploadFile) -> str:
    """stream an upload into a temp .tif enforcing the size cap; returns the temp path."""
    with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as tmp:
        tmp_path = tmp.name
        try:
            size = 0
            while chunk := file.file.read(8192):
                size += len(chunk)
                if size > MAX_DEM_SIZE:
                    os.unlink(tmp_path)
                    raise HTTPException(status_code=400, detail="file exceeds 500MB limit")
                tmp.write(chunk)
        except HTTPException:
            raise
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise HTTPException(status_code=400, detail="upload stream interrupted")
    return tmp_path


def _read_dem_bounds_and_resolution(rasterio_module, tmp_path: str) -> tuple[list, float, float]:
    """validate the DEM is WGS84 and return its (bounds, res_x, res_y)."""
    with rasterio_module.open(tmp_path) as dataset:
        if dataset.crs is None or dataset.crs.to_epsg() != 4326:
            raise HTTPException(status_code=400, detail="DEM must be in WGS84 (EPSG:4326)")

        bounds = list(dataset.bounds)
        res_x = abs(dataset.transform.a)
        res_y = abs(dataset.transform.e)
    return bounds, res_x, res_y


@router.post("/{airport_id}/terrain-dem", response_model=TerrainUploadResponse)
def upload_terrain_dem(
    airport_id: UUID,
    file: UploadFile,
    request: Request,
    current_user: CoordinatorUser,
    rewrite_existing: bool = Query(default=True),
    db: Session = Depends(get_db),
):
    """upload a GeoTIFF DEM file for terrain-following altitude."""
    # rewrite_existing true (default) -> the service resamples every persisted obstacle /
    # AGL / LHA / mission takeoff-landing coord against the new DEM; rewrite_existing=false
    # lets new entities use the DEM while persisted altitudes stay untouched
    check_airport_access(current_user, airport_id)
    try:
        import rasterio
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="rasterio not installed - DEM upload not available",
        )

    if not file.filename or not file.filename.lower().endswith((".tif", ".tiff")):
        raise HTTPException(status_code=400, detail="file must be a GeoTIFF (.tif/.tiff)")

    # validate into a temp file first, only move to the final path once it parses
    tmp_path = _stream_upload_to_tempfile(file)

    # tracks which file to remove on error - starts as tmp, becomes final after move
    cleanup_path = tmp_path

    try:
        bounds, res_x, res_y = _read_dem_bounds_and_resolution(rasterio, tmp_path)

        airport = airport_service.get_airport(db, airport_id)
        apt_lon, apt_lat = airport_service.get_airport_lonlat(airport)

        if not (bounds[0] <= apt_lon <= bounds[2] and bounds[1] <= apt_lat <= bounds[3]):
            raise HTTPException(status_code=400, detail="DEM does not cover airport location")

        settings.terrain_dir.mkdir(parents=True, exist_ok=True)
        final_path = settings.terrain_dir / f"{airport_id}.tif"
        shutil.move(tmp_path, str(final_path))
        cleanup_path = str(final_path)

        airport, old_dem_path = airport_service.upload_terrain_dem(
            db,
            airport_id,
            str(final_path),
            terrain_source="DEM_UPLOAD",
            renormalize=rewrite_existing,
        )
        log_audit(
            db,
            current_user,
            AuditAction.CREATE,
            entity_type="TerrainDEM",
            entity_id=airport_id,
            entity_name=airport.name,
            details={"terrain_source": "DEM_UPLOAD", "rewrite_existing": rewrite_existing},
            ip_address=request.client.host if request.client else None,
            airport_id=airport_id,
        )
        db.commit()

        # clean up old DEM file only after successful commit
        if old_dem_path and old_dem_path != str(final_path) and os.path.exists(old_dem_path):
            try:
                os.unlink(old_dem_path)
            except OSError:
                logger.warning("failed to remove old DEM file: %s", old_dem_path)

        return TerrainUploadResponse(
            terrain_source="DEM_UPLOAD",
            coverage=TerrainCoverage(bounds=bounds, resolution=[res_x, res_y]),
        )

    except HTTPException:
        try:
            if os.path.exists(cleanup_path):
                os.unlink(cleanup_path)
        except OSError:
            pass
        raise
    except (NotFoundError, DomainError) as e:
        try:
            if os.path.exists(cleanup_path):
                os.unlink(cleanup_path)
        except OSError:
            pass
        logger.exception("DEM upload service error")
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except Exception:
        try:
            if os.path.exists(cleanup_path):
                os.unlink(cleanup_path)
        except OSError:
            pass
        logger.exception("DEM upload failed")
        raise HTTPException(status_code=400, detail="invalid or unsupported GeoTIFF file")


@router.delete("/{airport_id}/terrain-dem", response_model=DeleteResponse)
def delete_terrain_dem(
    airport_id: UUID,
    request: Request,
    current_user: CoordinatorUser,
    rewrite_existing: bool = Query(default=True),
    db: Session = Depends(get_db),
):
    """remove DEM file and revert airport to flat terrain."""
    # rewrite_existing true (default) -> the service snaps persisted altitudes back to
    # whatever the flat / api-fallback provider returns; rewrite_existing=false leaves
    # existing DEM-sampled altitudes intact
    check_airport_access(current_user, airport_id)
    old_dem_path = airport_service.get_dem_file_path(db, airport_id)

    airport = airport_service.delete_terrain_dem(db, airport_id, renormalize=rewrite_existing)
    log_audit(
        db,
        current_user,
        AuditAction.DELETE,
        entity_type="TerrainDEM",
        entity_id=airport_id,
        entity_name=airport.name,
        details={"rewrite_existing": rewrite_existing},
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()

    if old_dem_path and os.path.exists(old_dem_path):
        try:
            os.unlink(old_dem_path)
        except OSError:
            logger.warning("failed to unlink old DEM file: %s", old_dem_path)

    return DeleteResponse(deleted=True)


@router.post("/{airport_id}/terrain-download", response_model=TerrainDownloadResponse)
async def download_terrain_data(
    airport_id: UUID,
    request: Request,
    current_user: CoordinatorUser,
    rewrite_existing: bool = Query(default=True),
    db: Session = Depends(get_db),
):
    """download elevation data from Open-Elevation API and cache as GeoTIFF."""
    # rewrite_existing true (default) -> the service resamples every persisted obstacle /
    # AGL / LHA / mission takeoff-landing coord against the new DEM; rewrite_existing=false
    # leaves persisted altitudes intact
    check_airport_access(current_user, airport_id)

    # read airport data in the async context where the session lives
    airport = airport_service.get_airport(db, airport_id)
    apt_lon, apt_lat = airport_service.get_airport_lonlat(airport)

    loop = asyncio.get_running_loop()

    try:
        result = await loop.run_in_executor(
            None,
            partial(
                airport_service.download_terrain_for_location,
                airport_id=airport_id,
                apt_lon=apt_lon,
                apt_lat=apt_lat,
                fallback_elevation=airport.elevation,
            ),
        )
    except DomainError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))

    # persist terrain data back in the async context with the original session
    try:
        updated, old_dem_path = airport_service.upload_terrain_dem(
            db,
            airport_id,
            result["file_path"],
            terrain_source="DEM_API",
            renormalize=rewrite_existing,
        )
        log_audit(
            db,
            current_user,
            AuditAction.CREATE,
            entity_type="TerrainDEM",
            entity_id=airport_id,
            entity_name=updated.name,
            details={
                "terrain_source": "DEM_API",
                "points_downloaded": result["points_downloaded"],
                "rewrite_existing": rewrite_existing,
            },
            ip_address=request.client.host if request.client else None,
            airport_id=airport_id,
        )
        db.commit()
    except (NotFoundError, DomainError) as e:
        try:
            if os.path.exists(result["file_path"]):
                os.unlink(result["file_path"])
        except OSError:
            pass
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except Exception:
        try:
            if os.path.exists(result["file_path"]):
                os.unlink(result["file_path"])
        except OSError:
            pass
        raise

    # clean up old DEM file only after successful commit
    if old_dem_path and old_dem_path != result["file_path"] and os.path.exists(old_dem_path):
        try:
            os.unlink(old_dem_path)
        except OSError:
            logger.warning("failed to remove old DEM file: %s", old_dem_path)

    return TerrainDownloadResponse(
        terrain_source=result["terrain_source"],
        points_downloaded=result["points_downloaded"],
        coverage=TerrainCoverage(
            bounds=result["bounds"],
            resolution=result["resolution"],
        ),
    )
