"""raster map tile endpoint - minio bundle -> disk cache -> upstream cdn."""

from fastapi import APIRouter, HTTPException, Path
from fastapi.responses import Response

from app.services import tile_service

router = APIRouter(prefix="/api/v1/tiles", tags=["tiles"])


@router.get("/{layer}/{z}/{x}/{y}")
def get_tile(
    layer: str,
    z: int = Path(ge=0, le=24),
    x: int = Path(ge=0),
    y: int = Path(ge=0),
) -> Response:
    """serve one raster tile, resolving bundle -> disk cache -> upstream.

    unauthenticated by design: maplibre/cesium fetch tiles directly and can't
    attach a jwt, and basemap raster tiles are public read-only. a clean miss
    returns 204 so absent tiles don't spam the browser network panel.
    """
    if not tile_service.is_valid_layer(layer):
        raise HTTPException(status_code=404, detail="unknown tile layer")
    result = tile_service.get_tile(layer, z, x, y)
    if result is None:
        return Response(status_code=204)
    data, content_type = result
    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )
