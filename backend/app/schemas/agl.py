"""pydantic schemas for agl and lha endpoints."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.core.constants import DEFAULT_LHA_TOLERANCE_DEG
from app.schemas.common import ListMeta
from app.schemas.geometry import PointZ

# enum-bounded string aliases - mirror the db check constraints so invalid
# values fail with a clean 422 instead of a 500 IntegrityError at commit
LampTypeStr = Literal["HALOGEN", "LED"]
PAPISideStr = Literal["LEFT", "RIGHT"]
AglTypeStr = Literal["PAPI", "RUNWAY_EDGE_LIGHTS"]


class LHACreate(BaseModel):
    """lha create schema."""

    unit_designator: str = Field(min_length=1, max_length=4)
    setting_angle: float | None = None
    transition_sector_width: float | None = None
    lamp_type: LampTypeStr
    position: PointZ
    tolerance: float | None = None
    # omitted = server assigns max+1; explicit value triggers shift
    sequence_number: int | None = Field(default=None, ge=1)
    # PAPI-only lens height; null for non-PAPI units
    lens_height_msl_m: float | None = None
    lens_height_agl_m: float | None = None


class LHAUpdate(BaseModel):
    """lha update schema."""

    unit_designator: str | None = Field(default=None, min_length=1, max_length=4)
    setting_angle: float | None = None
    transition_sector_width: float | None = None
    lamp_type: LampTypeStr | None = None
    position: PointZ | None = None
    tolerance: float | None = None
    sequence_number: int | None = Field(default=None, ge=1)
    # PAPI-only lens height; null for non-PAPI units
    lens_height_msl_m: float | None = None
    lens_height_agl_m: float | None = None
    # transport-only flag - skip ground-altitude renormalization on this update
    preserve_altitude: bool = False


class LHAResponse(BaseModel):
    """lha response schema."""

    id: UUID
    agl_id: UUID
    unit_designator: str
    setting_angle: float | None = None
    transition_sector_width: float | None = None
    lamp_type: LampTypeStr
    position: PointZ
    tolerance: float | None = None
    sequence_number: int
    lens_height_msl_m: float | None = None
    lens_height_agl_m: float | None = None

    model_config = {"from_attributes": True}


class AGLCreate(BaseModel):
    """agl create schema."""

    agl_type: AglTypeStr
    name: str
    position: PointZ
    side: PAPISideStr | None = None
    glide_slope_angle: float | None = None
    glide_slope_angle_tolerance: float | None = Field(default=None, gt=0)
    ils_harmonization_tolerance: float | None = Field(default=None, gt=0)
    distance_from_threshold: float | None = None
    meht_height_m: float | None = None
    offset_from_centerline: float | None = None


class AGLUpdate(BaseModel):
    """agl update schema."""

    agl_type: AglTypeStr | None = None
    name: str | None = None
    position: PointZ | None = None
    side: PAPISideStr | None = None
    glide_slope_angle: float | None = None
    glide_slope_angle_tolerance: float | None = Field(default=None, gt=0)
    ils_harmonization_tolerance: float | None = Field(default=None, gt=0)
    distance_from_threshold: float | None = None
    meht_height_m: float | None = None
    offset_from_centerline: float | None = None
    # transport-only flag - skip ground-altitude renormalization on this update
    preserve_altitude: bool = False


class AGLResponse(BaseModel):
    """agl response schema."""

    id: UUID
    surface_id: UUID
    agl_type: AglTypeStr
    name: str
    position: PointZ
    side: PAPISideStr | None = None
    glide_slope_angle: float | None = None
    glide_slope_angle_tolerance: float | None = None
    ils_harmonization_tolerance: float | None = None
    distance_from_threshold: float | None = None
    meht_height_m: float | None = None
    offset_from_centerline: float | None = None
    lhas: list[LHAResponse] = []

    model_config = {"from_attributes": True}


# bulk LHA generation
class LHABulkGenerateRequest(BaseModel):
    """bulk LHA generation request - linearly interpolate between two points."""

    first_position: PointZ
    last_position: PointZ
    spacing_m: float = Field(gt=0, le=1000)
    setting_angle: float | None = None
    tolerance: float | None = DEFAULT_LHA_TOLERANCE_DEG
    lamp_type: LampTypeStr = "HALOGEN"

    @model_validator(mode="after")
    def _validate_positions_differ(self) -> "LHABulkGenerateRequest":
        """first and last positions must not be identical - zero-length interpolation is invalid."""
        if self.first_position.coordinates == self.last_position.coordinates:
            raise ValueError("first and last positions must differ")
        return self


class LHABulkGenerateResponse(BaseModel):
    """bulk LHA generation response."""

    generated: list[LHAResponse]


# list responses
class AGLListResponse(BaseModel):
    """agl list response."""

    data: list[AGLResponse]
    meta: ListMeta


class LHAListResponse(BaseModel):
    """lha list response."""

    data: list[LHAResponse]
    meta: ListMeta
