"""pydantic schemas for inspection-config overrides and lha selection rules."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Discriminator, Field, Tag, field_validator, model_validator

from app.core.constants import (
    MAX_VERTICAL_PROFILE_ANGLE_DEG,
    MIN_TRANSIT_ALTITUDE_AGL_M,
    MIN_VERTICAL_PROFILE_ANGLE_DEG,
)
from app.schemas.common import FocusModeStr, WhiteBalanceStr, validate_range_order

# angle source for vertical profile climbs.
# PAPI = derive bookends from LHA setting angles + offsets.
# CUSTOM = use operator-supplied angle_start / angle_end directly.
AngleSourceStr = Literal["PAPI", "CUSTOM"]

# capture mode values - used by trajectory_computation to choose camera_action
CaptureModeStr = Literal["VIDEO_CAPTURE", "PHOTO_CAPTURE"]
# camera_mode values - AUTO = drone-controlled, MANUAL = coordinator values applied
CameraModeStr = Literal["AUTO", "MANUAL"]
# hover bearing reference frames - RUNWAY = 0 is approach side, COMPASS = absolute
HoverBearingRefStr = Literal["RUNWAY", "COMPASS"]
# inspection direction - NATURAL or REVERSED. NULL on inspection means inherit from mission.
InspectionDirectionStr = Literal["NATURAL", "REVERSED"]
# surface-scan along-track extent. null = FULL (whole surface).
ScanLengthModeStr = Literal["FULL", "MAX_LENGTH", "INTERVAL"]
# which runway end the along-track window is measured from. null = THRESHOLD.
ScanLengthAnchorStr = Literal["THRESHOLD", "ENDPOINT"]
# surface-scan band side relative to the surface bearing. null = centered (full width).
ScanWidthSideStr = Literal["LEFT", "RIGHT"]
# surface-scan run orientation. null = LENGTH_WISE.
ScanRunOrientationStr = Literal["LENGTH_WISE", "WIDTH_WISE"]

# lha selection rule modes - mirrors LhaSelectionMode helper modes.
LhaSelectionModeStr = Literal["ALL", "RANGE", "FROM_THRESHOLD", "CUSTOM"]
# threshold endpoint anchor for FROM_THRESHOLD mode.
ThresholdAnchorStr = Literal["START", "END"]


class LhaSelectionRuleAll(BaseModel):
    """select every lha on the agl."""

    mode: Literal["ALL"]


class LhaSelectionRuleRangeParams(BaseModel):
    """range params: from <= to in lha sequence_number space."""

    from_: int | None = Field(default=None, ge=1, alias="from")
    to: int | None = Field(default=None, ge=1)

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def _check_bounds(self) -> "LhaSelectionRuleRangeParams":
        """reject from > to (both must be supplied for the check to fire)."""
        validate_range_order(self.from_, self.to, "range from must be <= to", allow_equal=True)
        return self


class LhaSelectionRuleRange(BaseModel):
    """select lhas with sequence_number in [from, to]."""

    mode: Literal["RANGE"]
    params: LhaSelectionRuleRangeParams


class LhaSelectionRuleFromThresholdParams(BaseModel):
    """along-track distance from runway threshold (start or end)."""

    threshold: ThresholdAnchorStr
    distance_m: float = Field(ge=0)


class LhaSelectionRuleFromThreshold(BaseModel):
    """select lhas within distance_m along-track of threshold/end."""

    mode: Literal["FROM_THRESHOLD"]
    params: LhaSelectionRuleFromThresholdParams


class LhaSelectionRuleCustom(BaseModel):
    """free-form per-lha selection - canonical lha_ids list owns truth."""

    mode: Literal["CUSTOM"]


def _rule_discriminator(v) -> str | None:
    """pull the mode key off both dict and model inputs."""
    if isinstance(v, dict):
        return v.get("mode")
    return getattr(v, "mode", None)


LhaSelectionRule = Annotated[
    Annotated[LhaSelectionRuleAll, Tag("ALL")]
    | Annotated[LhaSelectionRuleRange, Tag("RANGE")]
    | Annotated[LhaSelectionRuleFromThreshold, Tag("FROM_THRESHOLD")]
    | Annotated[LhaSelectionRuleCustom, Tag("CUSTOM")],
    Discriminator(_rule_discriminator),
]


def _validate_transit_altitude(value: float | None) -> float | None:
    """enforce transit altitude minimum without importing from services."""
    if value is None:
        return None
    if value < MIN_TRANSIT_ALTITUDE_AGL_M:
        raise ValueError(f"transit_agl must be at least {MIN_TRANSIT_ALTITUDE_AGL_M:.0f}m AGL")
    return value


class ScanConfigFields(BaseModel):
    """surface-scan config fields shared across the inspection-config schemas."""

    # surface-scan fields - target is a surface, not an AGL.
    scan_surface_id: UUID | None = None
    scan_length_mode: ScanLengthModeStr | None = None
    scan_length_anchor: ScanLengthAnchorStr | None = None
    scan_length_from: float | None = Field(default=None, ge=0)
    scan_length_to: float | None = Field(default=None, ge=0)
    scan_width: float | None = Field(default=None, gt=0)
    scan_width_side: ScanWidthSideStr | None = None
    scan_height: float | None = Field(default=None, gt=0)
    scan_run_count: int | None = Field(default=None, ge=1)
    scan_run_orientation: ScanRunOrientationStr | None = None
    scan_sidelap_percent: float | None = Field(default=None, ge=0, le=80)
    scan_frontlap_percent: float | None = Field(default=None, ge=0, le=80)

    @model_validator(mode="after")
    def _check_scan_interval(self) -> "ScanConfigFields":
        """reject scan_length_from >= scan_length_to for INTERVAL mode."""
        if (
            self.scan_length_mode == "INTERVAL"
            and self.scan_length_from is not None
            and self.scan_length_to is not None
            and self.scan_length_from >= self.scan_length_to
        ):
            raise ValueError("scan_length_from must be less than scan_length_to")
        return self


class InspectionConfigOverride(ScanConfigFields):
    """config overrides for an inspection within a mission."""

    altitude_offset: float | None = None
    # PAPI offsets for vertical profile and horizontal range. angle_offset_above
    # is added to max(setting_angles) for the arc-side angle and the VP top
    # bookend; angle_offset_below is subtracted from min(setting_angles) for the
    # VP bottom bookend. legacy clients may still send angle_offset; the
    # validator promotes it to angle_offset_above for one release.
    angle_offset_above: float | None = Field(default=None, ge=0, le=10)
    angle_offset_below: float | None = Field(default=None, ge=0, le=10)
    measurement_speed_override: float | None = Field(default=None, gt=0)
    measurement_density: int | None = Field(default=None, ge=1)
    custom_tolerances: dict[str, float] | None = None
    hover_duration: float | None = None
    horizontal_distance: float | None = Field(default=None, gt=0)
    sweep_angle: float | None = None
    angle_source: AngleSourceStr | None = None
    angle_start: float | None = Field(
        default=None, ge=MIN_VERTICAL_PROFILE_ANGLE_DEG, le=MAX_VERTICAL_PROFILE_ANGLE_DEG
    )
    angle_end: float | None = Field(
        default=None, ge=MIN_VERTICAL_PROFILE_ANGLE_DEG, le=MAX_VERTICAL_PROFILE_ANGLE_DEG
    )
    lha_ids: list[UUID] | None = None
    # per-AGL selection rule keyed by AGL id. resolver writes the resolved set
    # to lha_ids on save. omit / null = no rule change on this update.
    lha_selection_rules: dict[UUID, LhaSelectionRule] | None = None
    capture_mode: CaptureModeStr | None = None
    recording_setup_duration: float | None = None
    buffer_distance: float | None = Field(default=None, ge=0)
    # method-specific config fields
    height_above_lights: float | None = Field(default=None, gt=0)
    lateral_offset: float | None = Field(default=None, gt=0)
    distance_from_lha: float | None = Field(default=None, gt=0)
    height_above_lha: float | None = Field(default=None, gt=0)
    camera_gimbal_angle: float | None = None
    selected_lha_id: UUID | None = None
    lha_setting_angle_override_id: UUID | None = None
    hover_bearing: float | None = None
    hover_bearing_reference: HoverBearingRefStr | None = None
    # approach-descent fields
    descent_start_distance: float | None = Field(default=None, gt=0)
    descent_glide_slope_override: float | None = Field(default=None, gt=0, le=10)
    # results-time glidepath verdict tolerance (deg) - never a trajectory input
    glide_slope_angle_tolerance: float | None = Field(default=None, gt=0)
    camera_mode: CameraModeStr | None = None
    # NULL means inherit from mission. NATURAL or REVERSED pin direction.
    direction: InspectionDirectionStr | None = None
    white_balance: WhiteBalanceStr | None = None
    iso: int | None = Field(default=None, gt=0)
    shutter_speed: str | None = Field(default=None, max_length=20)
    focus_mode: FocusModeStr | None = None
    optical_zoom: float | None = Field(default=None, gt=0)
    camera_preset_id: UUID | None = None

    @field_validator("lha_ids", mode="before")
    @classmethod
    def validate_lha_ids(cls, v: list | None) -> list[UUID] | None:
        """coerce mixed uuid/string lists so downstream jsonb storage is consistent."""
        if v is None:
            return None
        return [UUID(str(i)) if not isinstance(i, UUID) else i for i in v]

    @model_validator(mode="after")
    def _check_angle_band(self) -> "InspectionConfigOverride":
        """reject angle_start >= angle_end when both are supplied."""
        validate_range_order(
            self.angle_start, self.angle_end, "angle_start must be less than angle_end"
        )
        return self


class InspectionConfigResponse(ScanConfigFields):
    """inspection configuration values."""

    altitude_offset: float | None = None
    angle_offset_above: float | None = None
    angle_offset_below: float | None = None
    measurement_speed_override: float | None = None
    measurement_density: int | None = None
    custom_tolerances: dict[str, float] | None = None
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
    camera_mode: CameraModeStr | None = None
    direction: InspectionDirectionStr | None = None
    resolved_direction: InspectionDirectionStr | None = None
    white_balance: WhiteBalanceStr | None = None
    iso: int | None = None
    shutter_speed: str | None = None
    focus_mode: FocusModeStr | None = None
    optical_zoom: float | None = None
    camera_preset_id: UUID | None = None

    model_config = {"from_attributes": True}
