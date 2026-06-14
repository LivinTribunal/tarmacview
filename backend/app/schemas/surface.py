"""pydantic schemas for airport surface endpoints."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.core.constants import DEFAULT_BUFFER_DISTANCE_M
from app.schemas.agl import AGLResponse
from app.schemas.common import ListMeta
from app.schemas.geometry import LineStringZ, PointZ, PolygonZ

# enum-bounded string alias - mirrors the db check constraint so invalid
# values fail with a clean 422 instead of a 500 IntegrityError at commit
SurfaceTypeStr = Literal["RUNWAY", "TAXIWAY"]


class SurfaceCreate(BaseModel):
    """surface create schema."""

    identifier: str
    surface_type: SurfaceTypeStr
    geometry: LineStringZ
    boundary: PolygonZ | None = None
    # 0 = use raw boundary, no expansion
    buffer_distance: float = Field(default=DEFAULT_BUFFER_DISTANCE_M, ge=0)
    heading: float | None = Field(default=None, ge=0, lt=360)
    length: float | None = None
    width: float | None = None
    threshold_position: PointZ | None = None
    end_position: PointZ | None = None
    touchpoint_latitude: float | None = Field(default=None, ge=-90, le=90)
    touchpoint_longitude: float | None = Field(default=None, ge=-180, le=180)
    touchpoint_altitude: float | None = None

    @model_validator(mode="after")
    def _validate_touchpoint_completeness(self) -> "SurfaceCreate":
        """touchpoint fields are all-or-nothing to avoid partial state."""
        fields = (self.touchpoint_latitude, self.touchpoint_longitude, self.touchpoint_altitude)
        provided = sum(1 for f in fields if f is not None)
        if 0 < provided < 3:
            raise ValueError("touchpoint requires all three coordinates or none")
        return self


class SurfaceUpdate(BaseModel):
    """surface update schema."""

    identifier: str | None = None
    geometry: LineStringZ | None = None
    boundary: PolygonZ | None = None
    buffer_distance: float | None = Field(default=None, ge=0)
    heading: float | None = Field(default=None, ge=0, lt=360)
    length: float | None = None
    width: float | None = None
    threshold_position: PointZ | None = None
    end_position: PointZ | None = None
    touchpoint_latitude: float | None = Field(default=None, ge=-90, le=90)
    touchpoint_longitude: float | None = Field(default=None, ge=-180, le=180)
    touchpoint_altitude: float | None = None

    @model_validator(mode="after")
    def _validate_touchpoint_completeness(self) -> "SurfaceUpdate":
        """touchpoint fields are all-or-nothing to avoid partial state."""
        # check model_fields_set to catch explicit nulls - apply_schema_update
        # uses exclude_unset, so an unsent field is safe but a partial payload
        # with explicit nulls would otherwise slip through
        tp_fields = {"touchpoint_latitude", "touchpoint_longitude", "touchpoint_altitude"}
        set_tp = tp_fields & self.model_fields_set
        if 0 < len(set_tp) < 3:
            raise ValueError("touchpoint requires all three coordinates or none")
        return self


class SurfaceResponse(BaseModel):
    """surface response schema."""

    id: UUID
    airport_id: UUID
    identifier: str
    surface_type: SurfaceTypeStr
    geometry: LineStringZ
    boundary: PolygonZ | None = None
    buffer_distance: float = DEFAULT_BUFFER_DISTANCE_M
    heading: float | None = None
    length: float | None = None
    width: float | None = None
    threshold_position: PointZ | None = None
    end_position: PointZ | None = None
    touchpoint_latitude: float | None = None
    touchpoint_longitude: float | None = None
    touchpoint_altitude: float | None = None
    paired_surface_id: UUID | None = None
    agls: list["AGLResponse"] = []

    model_config = {"from_attributes": True}


# pair-link request bodies
class SurfaceCoupleRequest(BaseModel):
    """couple two RUNWAY surfaces; primary chooses which side overwrites geometry."""

    target_surface_id: UUID
    primary: Literal["self", "target"] = "self"


class SurfaceCreateReverseRequest(BaseModel):
    """create the reverse direction of a runway and auto-couple it.

    identifier override is optional; service derives the reciprocal when omitted.
    """

    identifier: str | None = Field(default=None, min_length=1, max_length=10)


# recalculate dimensions responses
class SurfaceDimensions(BaseModel):
    """surface dimensions snapshot."""

    length: float | None = None
    width: float | None = None
    heading: float | None = None


class SurfaceRecalculateResponse(BaseModel):
    """response for surface recalculate dimensions endpoint."""

    current: SurfaceDimensions
    recalculated: SurfaceDimensions


class SurfaceListResponse(BaseModel):
    """surface list response."""

    data: list[SurfaceResponse]
    meta: ListMeta


# AGLResponse lives in a sibling module now, so the agls forward-ref must be
# resolved explicitly - it used to resolve implicitly when both classes shared
# infrastructure.py's namespace.
SurfaceResponse.model_rebuild()
