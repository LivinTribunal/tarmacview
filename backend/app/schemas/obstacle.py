"""pydantic schemas for airport obstacle endpoints."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.core.constants import DEFAULT_BUFFER_DISTANCE_M
from app.schemas.common import ListMeta
from app.schemas.geometry import PolygonZ

# enum-bounded string alias - mirrors the db check constraint so invalid
# values fail with a clean 422 instead of a 500 IntegrityError at commit
ObstacleTypeStr = Literal["BUILDING", "TOWER", "ANTENNA", "VEGETATION", "OTHER"]


class ObstacleCreate(BaseModel):
    """obstacle create schema."""

    name: str
    height: float
    boundary: PolygonZ
    # 0 = use raw boundary, no expansion
    buffer_distance: float = Field(default=DEFAULT_BUFFER_DISTANCE_M, ge=0)
    type: ObstacleTypeStr


class ObstacleUpdate(BaseModel):
    """obstacle update schema."""

    name: str | None = None
    height: float | None = None
    boundary: PolygonZ | None = None
    buffer_distance: float | None = Field(default=None, ge=0)
    type: ObstacleTypeStr | None = None
    # transport-only flag - skip ground-altitude renormalization on this update
    preserve_altitude: bool = False


class ObstacleResponse(BaseModel):
    """obstacle response schema."""

    id: UUID
    airport_id: UUID
    name: str
    height: float
    boundary: PolygonZ
    buffer_distance: float
    type: ObstacleTypeStr

    model_config = {"from_attributes": True}


# recalculate dimensions responses
class ObstacleDimensions(BaseModel):
    """obstacle dimensions snapshot."""

    length: float | None = None
    width: float | None = None
    heading: float | None = None
    radius: float | None = None


class ObstacleRecalculateResponse(BaseModel):
    """response for obstacle recalculate dimensions endpoint."""

    current: ObstacleDimensions
    recalculated: ObstacleDimensions


class ObstacleListResponse(BaseModel):
    """obstacle list response."""

    data: list[ObstacleResponse]
    meta: ListMeta
