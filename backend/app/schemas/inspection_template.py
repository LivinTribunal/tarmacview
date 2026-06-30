"""pydantic schemas for inspection template endpoints."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.core.constants import MAX_VERTICAL_PROFILE_ANGLE_DEG, MIN_VERTICAL_PROFILE_ANGLE_DEG
from app.schemas.common import ListMeta, validate_range_order
from app.schemas.mission import (
    AngleSourceStr,
    CaptureModeStr,
    FocusModeStr,
    HoverBearingRefStr,
    InspectionDirectionStr,
    InspectionMethodStr,
    LhaSelectionRule,
    ScanConfigFields,
    WhiteBalanceStr,
)


class InspectionConfigCreate(ScanConfigFields):
    """inspection config create schema."""

    altitude_offset: float | None = None
    angle_offset_above: float | None = Field(default=None, ge=0, le=10)
    angle_offset_below: float | None = Field(default=None, ge=0, le=10)
    measurement_speed_override: float | None = Field(default=None, gt=0)
    measurement_density: int | None = Field(default=None, ge=1)
    custom_tolerances: dict | None = None
    hover_duration: float | None = None
    horizontal_distance: float | None = None
    sweep_angle: float | None = None
    angle_source: AngleSourceStr | None = None
    angle_start: float | None = Field(
        default=None, ge=MIN_VERTICAL_PROFILE_ANGLE_DEG, le=MAX_VERTICAL_PROFILE_ANGLE_DEG
    )
    angle_end: float | None = Field(
        default=None, ge=MIN_VERTICAL_PROFILE_ANGLE_DEG, le=MAX_VERTICAL_PROFILE_ANGLE_DEG
    )
    lha_ids: list[UUID] | None = None
    lha_selection_rules: dict[UUID, LhaSelectionRule] | None = None
    capture_mode: CaptureModeStr | None = None
    recording_setup_duration: float | None = None
    buffer_distance: float | None = Field(default=None, ge=0)
    height_above_lights: float | None = Field(default=None, gt=0)
    lateral_offset: float | None = Field(default=None, gt=0)
    distance_from_lha: float | None = Field(default=None, gt=0)
    height_above_lha: float | None = Field(default=None, gt=0)
    camera_gimbal_angle: float | None = None
    selected_lha_id: UUID | None = None
    lha_setting_angle_override_id: UUID | None = None
    hover_bearing: float | None = None
    hover_bearing_reference: HoverBearingRefStr | None = None
    descent_start_distance: float | None = Field(default=None, gt=0)
    descent_glide_slope_override: float | None = Field(default=None, gt=0, le=10)
    glide_slope_angle_tolerance: float | None = Field(default=None, gt=0)
    direction: InspectionDirectionStr | None = None
    white_balance: WhiteBalanceStr | None = None
    iso: int | None = Field(default=None, gt=0)
    shutter_speed: str | None = Field(default=None, max_length=20)
    focus_mode: FocusModeStr | None = None
    optical_zoom: float | None = Field(default=None, gt=0)
    camera_preset_id: UUID | None = None

    @model_validator(mode="after")
    def _check_angle_band(self) -> "InspectionConfigCreate":
        """reject angle_start >= angle_end when both are supplied."""
        validate_range_order(
            self.angle_start, self.angle_end, "angle_start must be less than angle_end"
        )
        return self


class TemplateConfigResponse(ScanConfigFields):
    """template default-config response schema."""

    id: UUID
    altitude_offset: float | None = None
    angle_offset_above: float | None = None
    angle_offset_below: float | None = None
    measurement_speed_override: float | None = None
    measurement_density: int | None = None
    custom_tolerances: dict | None = None
    hover_duration: float | None = None
    horizontal_distance: float | None = None
    sweep_angle: float | None = None
    angle_source: AngleSourceStr | None = None
    angle_start: float | None = None
    angle_end: float | None = None
    lha_ids: list[UUID] | None = None
    lha_selection_rules: dict[UUID, LhaSelectionRule] | None = None
    capture_mode: CaptureModeStr | None = None
    recording_setup_duration: float | None = None
    buffer_distance: float | None = None
    height_above_lights: float | None = None
    lateral_offset: float | None = None
    distance_from_lha: float | None = None
    height_above_lha: float | None = None
    camera_gimbal_angle: float | None = None
    selected_lha_id: UUID | None = None
    lha_setting_angle_override_id: UUID | None = None
    hover_bearing: float | None = None
    hover_bearing_reference: HoverBearingRefStr | None = None
    descent_start_distance: float | None = None
    descent_glide_slope_override: float | None = None
    glide_slope_angle_tolerance: float | None = None
    direction: InspectionDirectionStr | None = None
    resolved_direction: InspectionDirectionStr | None = None
    white_balance: WhiteBalanceStr | None = None
    iso: int | None = None
    shutter_speed: str | None = None
    focus_mode: FocusModeStr | None = None
    optical_zoom: float | None = None
    camera_preset_id: UUID | None = None

    model_config = {"from_attributes": True}


class InspectionTemplateCreate(BaseModel):
    """inspection template create schema."""

    name: str
    description: str | None = None
    angular_tolerances: dict | None = None
    created_by: str | None = None
    default_config: InspectionConfigCreate | None = None
    target_agl_ids: list[UUID] = []
    methods: list[InspectionMethodStr] = []


class InspectionTemplateUpdate(BaseModel):
    """inspection template update schema."""

    name: str | None = None
    description: str | None = None
    angular_tolerances: dict | None = None
    target_agl_ids: list[UUID] | None = None
    methods: list[InspectionMethodStr] | None = None
    default_config: InspectionConfigCreate | None = None


class InspectionTemplateResponse(BaseModel):
    """inspection template response schema."""

    id: UUID
    name: str
    description: str | None = None
    angular_tolerances: dict | None = None
    created_by: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    default_config: TemplateConfigResponse | None = None
    target_agl_ids: list[UUID] = []
    methods: list[InspectionMethodStr] = []
    mission_count: int = 0

    model_config = {"from_attributes": True}


class InspectionTemplateListResponse(BaseModel):
    """inspection template list response schema."""

    data: list[InspectionTemplateResponse]
    meta: ListMeta


class BulkCreateTemplatesRequest(BaseModel):
    """bulk create inspection templates request schema."""

    airport_id: UUID


class BulkCreateTemplatesResponse(BaseModel):
    """bulk create inspection templates response schema."""

    created: list[InspectionTemplateResponse]
    skipped: int
