"""pydantic schemas for mission and inspection endpoints."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import FocusModeStr, ListMeta, WhiteBalanceStr
from app.schemas.geometry import PointZ
from app.schemas.inspection_config import (  # noqa: F401
    AngleSourceStr,
    CameraModeStr,
    CaptureModeStr,
    HoverBearingRefStr,
    InspectionConfigOverride,
    InspectionConfigResponse,
    InspectionDirectionStr,
    LhaSelectionModeStr,
    LhaSelectionRule,
    LhaSelectionRuleAll,
    LhaSelectionRuleCustom,
    LhaSelectionRuleFromThreshold,
    LhaSelectionRuleFromThresholdParams,
    LhaSelectionRuleRange,
    LhaSelectionRuleRangeParams,
    ScanConfigFields,
    ScanLengthModeStr,
    ScanRunOrientationStr,
    ScanWidthSideStr,
    ThresholdAnchorStr,
    _rule_discriminator,
    _validate_transit_altitude,
)

# computation status values - mirrors ComputationStatus enum
ComputationStatusStr = Literal["IDLE", "COMPUTING", "COMPLETED", "FAILED"]

# flight plan scope values - mirrors FlightPlanScope enum
FlightPlanScopeStr = Literal["FULL", "MEASUREMENTS_ONLY"]

# inspection method values - mirrors InspectionMethod enum
InspectionMethodStr = Literal[
    "VERTICAL_PROFILE",
    "HORIZONTAL_RANGE",
    "APPROACH_DESCENT",
    "FLY_OVER",
    "PARALLEL_SIDE_SWEEP",
    "HOVER_POINT_LOCK",
    "MEHT_CHECK",
    "SURFACE_SCAN",
    "RUNWAY_HORIZONTAL_RANGE",
]
# mission-wide direction default - AUTO = solver picks, NATURAL/REVERSED = pin all inspections.
MissionDirectionStr = Literal["AUTO", "NATURAL", "REVERSED"]
# dji wpml heading mode override. smoothTransition (default) interpolates
# body yaw between per-WP angles - works on every documented model and
# depends only on static-angle interpolation, no runtime POI math.
# towardPOI is experimental continuous POI tracking. followWayline is the
# proven fallback that snaps body heading at each waypoint.
DjiHeadingModeStr = Literal["smoothTransition", "towardPOI", "followWayline"]


class InspectionCreate(BaseModel):
    """add inspection to mission."""

    template_id: UUID
    method: InspectionMethodStr
    config: InspectionConfigOverride | None = None


class InspectionUpdate(BaseModel):
    """update inspection within mission."""

    method: InspectionMethodStr | None = None
    config: InspectionConfigOverride | None = None
    sequence_order: int | None = None


class InspectionResponse(BaseModel):
    """inspection response."""

    id: UUID
    mission_id: UUID
    template_id: UUID
    config_id: UUID | None = None
    method: InspectionMethodStr
    sequence_order: int
    lha_ids: list[UUID] | None = None
    config: InspectionConfigResponse | None = None

    model_config = {"from_attributes": True}


class ReorderRequest(BaseModel):
    """reorder inspections by sequence."""

    inspection_ids: list[UUID]


class ReorderResponse(BaseModel):
    """reorder response."""

    reordered: bool


class MissionCreate(BaseModel):
    """create mission."""

    name: str
    airport_id: UUID
    drone_profile_id: UUID | None = None
    operator_notes: str | None = None
    default_speed: float | None = None
    measurement_speed_override: float | None = Field(default=None, gt=0)
    default_altitude_offset: float | None = None
    takeoff_coordinate: PointZ | None = None
    landing_coordinate: PointZ | None = None
    default_capture_mode: CaptureModeStr | None = None
    default_buffer_distance: float | None = Field(default=None, ge=0)
    camera_mode: CameraModeStr = "AUTO"
    default_white_balance: WhiteBalanceStr | None = None
    default_iso: int | None = Field(default=None, gt=0)
    default_shutter_speed: str | None = Field(default=None, max_length=20)
    default_focus_mode: FocusModeStr | None = None
    transit_agl: float | None = None
    require_perpendicular_runway_crossing: bool = True
    keep_inside_airport_boundary: bool = True
    flight_plan_scope: FlightPlanScopeStr = "FULL"
    direction: MissionDirectionStr = "AUTO"
    dji_heading_mode: DjiHeadingModeStr | None = None

    @field_validator("transit_agl")
    @classmethod
    def _check_transit_altitude(cls, v: float | None) -> float | None:
        """enforce minimum AGL floor on mission-level cruise altitude."""
        return _validate_transit_altitude(v)


class MissionUpdate(BaseModel):
    """update mission."""

    name: str | None = None
    drone_profile_id: UUID | None = None
    operator_notes: str | None = None
    default_speed: float | None = None
    measurement_speed_override: float | None = Field(default=None, gt=0)
    default_altitude_offset: float | None = None
    takeoff_coordinate: PointZ | None = None
    landing_coordinate: PointZ | None = None
    date_time: datetime | None = None
    default_capture_mode: CaptureModeStr | None = None
    default_buffer_distance: float | None = Field(default=None, ge=0)
    camera_mode: CameraModeStr | None = None
    default_white_balance: WhiteBalanceStr | None = None
    default_iso: int | None = Field(default=None, gt=0)
    default_shutter_speed: str | None = Field(default=None, max_length=20)
    default_focus_mode: FocusModeStr | None = None
    transit_agl: float | None = None
    require_perpendicular_runway_crossing: bool | None = None
    keep_inside_airport_boundary: bool | None = None
    flight_plan_scope: FlightPlanScopeStr | None = None
    direction: MissionDirectionStr | None = None
    dji_heading_mode: DjiHeadingModeStr | None = None

    @field_validator("transit_agl")
    @classmethod
    def _check_transit_altitude(cls, v: float | None) -> float | None:
        """enforce minimum AGL floor on mission-level cruise altitude."""
        return _validate_transit_altitude(v)


class MissionResponse(BaseModel):
    """mission response."""

    id: UUID
    name: str
    status: str
    airport_id: UUID
    created_at: datetime
    updated_at: datetime
    operator_notes: str | None = None
    drone_profile_id: UUID | None = None
    date_time: datetime | None = None
    default_speed: float | None = None
    measurement_speed_override: float | None = None
    default_altitude_offset: float | None = None
    takeoff_coordinate: PointZ | None = None
    landing_coordinate: PointZ | None = None
    default_capture_mode: CaptureModeStr | None = None
    default_buffer_distance: float | None = None
    camera_mode: CameraModeStr = "AUTO"
    default_white_balance: WhiteBalanceStr | None = None
    default_iso: int | None = None
    default_shutter_speed: str | None = None
    default_focus_mode: FocusModeStr | None = None
    transit_agl: float | None = None
    require_perpendicular_runway_crossing: bool = True
    keep_inside_airport_boundary: bool = True
    flight_plan_scope: FlightPlanScopeStr = "FULL"
    direction: MissionDirectionStr = "AUTO"
    dji_heading_mode: DjiHeadingModeStr | None = None
    has_unsaved_map_changes: bool = False
    computation_status: ComputationStatusStr = "IDLE"
    computation_error: str | None = None
    computation_started_at: datetime | None = None
    inspection_count: int = 0
    estimated_duration: float | None = None
    # mirrors DroneProfile.supports_geozone_upload from the linked drone profile
    # so the export panel can decide whether to enable the geozone-bundle flag
    # without a second round-trip.
    supports_geozone_upload: bool | None = None

    model_config = {"from_attributes": True}


class MissionDetailResponse(MissionResponse):
    """mission with inspections."""

    inspections: list[InspectionResponse] = []


class ComputationStatusResponse(BaseModel):
    """lightweight computation status for polling."""

    computation_status: ComputationStatusStr
    computation_error: str | None = None
    computation_started_at: datetime | None = None

    model_config = {"from_attributes": True}


class MissionListResponse(BaseModel):
    """mission list response."""

    data: list[MissionResponse]
    meta: ListMeta
