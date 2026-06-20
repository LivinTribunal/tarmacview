"""cesium quantised-mesh terrain endpoint - minio tileset served same-origin."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.services import terrain_service

router = APIRouter(prefix="/api/v1/terrain", tags=["terrain"])


@router.get("/{path:path}")
def get_terrain(path: str) -> Response:
    """serve one terrain tileset file (layer.json or a .terrain tile) from the minio bundle.

    unauthenticated by design: cesium fetches terrain directly and can't attach a jwt,
    and quantised-mesh tiles are public read-only. a miss returns 404 (not 204) so
    cesium's terrain-availability handling treats absent tiles cleanly - an empty body
    would make the quantised-mesh parser choke.
    """
    result = terrain_service.get_terrain_file(path)
    if result is None:
        raise HTTPException(status_code=404, detail="terrain file not found")
    data, content_type, encoding = result
    headers = {"Cache-Control": "public, max-age=86400"}
    if encoding:
        headers["Content-Encoding"] = encoding
    return Response(content=data, media_type=content_type, headers=headers)
