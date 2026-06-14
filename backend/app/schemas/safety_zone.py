"""pydantic schemas for airport safety-zone endpoints."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, model_validator

from app.schemas.common import ListMeta
from app.schemas.geometry import PolygonZ

# enum-bounded string alias - mirrors the db check constraint so invalid
# values fail with a clean 422 instead of a 500 IntegrityError at commit
SafetyZoneTypeStr = Literal[
    "CTR", "RESTRICTED", "PROHIBITED", "TEMPORARY_NO_FLY", "AIRPORT_BOUNDARY"
]


class SafetyZoneCreate(BaseModel):
    """safety zone create schema."""

    name: str
    type: SafetyZoneTypeStr
    geometry: PolygonZ
    altitude_floor: float | None = None
    altitude_ceiling: float | None = None
    is_active: bool = True

    @model_validator(mode="after")
    def _validate_altitude_range(self) -> "SafetyZoneCreate":
        """reject inverted altitude envelopes and boundary zones with altitude bounds."""
        if self.type == "AIRPORT_BOUNDARY" and (
            self.altitude_floor is not None or self.altitude_ceiling is not None
        ):
            raise ValueError(
                "altitude_floor and altitude_ceiling are not allowed for AIRPORT_BOUNDARY zones"
            )
        if (
            self.altitude_floor is not None
            and self.altitude_ceiling is not None
            and self.altitude_floor > self.altitude_ceiling
        ):
            raise ValueError("altitude_floor must be <= altitude_ceiling")
        return self


class SafetyZoneUpdate(BaseModel):
    """safety zone update schema."""

    name: str | None = None
    type: SafetyZoneTypeStr | None = None
    geometry: PolygonZ | None = None
    altitude_floor: float | None = None
    altitude_ceiling: float | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def _validate_altitude_range(self) -> "SafetyZoneUpdate":
        """reject inverted altitude envelopes and boundary zones with altitude bounds."""
        # partial patches (no type field) skip the boundary check here;
        # the service layer re-checks against the persisted zone type and
        # nulls any stale altitude columns when target_type is AIRPORT_BOUNDARY.
        if self.type == "AIRPORT_BOUNDARY" and (
            self.altitude_floor is not None or self.altitude_ceiling is not None
        ):
            raise ValueError(
                "altitude_floor and altitude_ceiling are not allowed for AIRPORT_BOUNDARY zones"
            )
        if (
            self.altitude_floor is not None
            and self.altitude_ceiling is not None
            and self.altitude_floor > self.altitude_ceiling
        ):
            raise ValueError("altitude_floor must be <= altitude_ceiling")
        return self


class SafetyZoneResponse(BaseModel):
    """safety zone response schema."""

    id: UUID
    airport_id: UUID
    name: str
    type: SafetyZoneTypeStr
    geometry: PolygonZ
    altitude_floor: float | None = None
    altitude_ceiling: float | None = None
    is_active: bool

    model_config = {"from_attributes": True}


class SafetyZoneListResponse(BaseModel):
    """safety zone list response."""

    data: list[SafetyZoneResponse]
    meta: ListMeta
