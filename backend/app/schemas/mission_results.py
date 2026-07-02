"""mission-level protocol-style results DTOs - per runway/AGL/LHA aggregation.

flat protocol rows the frontend renders in reference-protocol order. unmeasured
parameters serialize as explicit null / "NOT_MEASURED" so placeholders never read
as a real FAIL. distinct from the per-run ``MeasurementResultsResponse`` in
``measurement.py`` - keep both.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

DeviceEvaluationStr = Literal["PASS", "FAIL", "PENDING", "NOT_MEASURED"]


class MissionResultsHeader(BaseModel):
    """session header - airport / mission identity plus placeholder session fields."""

    airport_icao: str
    airport_name: str
    mission_name: str
    measurement_date: datetime | None = None
    drone_model: str | None = None
    # placeholder session fields (rendered N/A)
    optical_sensor: str | None = None
    reference_system: str | None = None
    certificate_number: str | None = None


class MissionWeatherPlaceholder(BaseModel):
    """weather section - all placeholder until captured at measurement time."""

    temperature_c: float | None = None
    wind: str | None = None
    visibility: str | None = None
    conditions: str | None = None


class MissionLightResult(BaseModel):
    """one LHA row (A/B/C/D) - measured transition angle vs setting angle +/- tolerance."""

    lha_id: UUID | None = None
    unit_designator: str | None = None
    light_name: str
    setting_angle: float | None = None
    tolerance: float | None = None
    measured_transition_angle: float | None = None
    measured_transition_angle_touchpoint: float | None = None
    transition_angle_min: float | None = None
    transition_angle_middle: float | None = None
    transition_angle_max: float | None = None
    transition_angle_min_touchpoint: float | None = None
    transition_angle_middle_touchpoint: float | None = None
    transition_angle_max_touchpoint: float | None = None
    passed: bool | None = None
    not_measured: bool = False


class MissionGlideSlopeResult(BaseModel):
    """measured glide slope vs the configured angle +/- tolerance."""

    measured_glide_slope_angle: float | None = None
    configured_glide_slope_angle: float | None = None
    glide_slope_angle_tolerance: float | None = None
    within_tolerance: bool | None = None


class MissionIlsHarmonizationResult(BaseModel):
    """touchpoint-referenced on-slope glidepath vs the published angle +/- ils tolerance."""

    measured_glide_slope_angle_touchpoint: float | None = None
    configured_glide_slope_angle: float | None = None
    ils_harmonization_tolerance: float | None = None
    within_tolerance: bool | None = None
    evaluation: DeviceEvaluationStr = "NOT_MEASURED"


class DeviceResults(BaseModel):
    """one AGL device (PAPI / ALS / RLS) - glide slope, per-light rows, placeholder rows."""

    agl_id: UUID | None = None
    device_type: str
    device_label: str
    inspection_id: UUID | None = None
    inspection_method: str | None = None
    measurement_id: UUID | None = None
    status: str  # MeasurementStatus value or "NOT_MEASURED"
    evaluation: DeviceEvaluationStr
    glide_slope: MissionGlideSlopeResult | None = None
    ils_harmonization: MissionIlsHarmonizationResult | None = None
    lights: list[MissionLightResult] = []
    placeholder_rows: list[str] = []  # catalog keys the FE renders as greyed N/A rows


class RunwayResults(BaseModel):
    """one runway (surface) bucket - its measured + placeholder devices."""

    surface_id: UUID | None = None
    runway_identifier: str | None = None
    runway_heading: float | None = None
    devices: list[DeviceResults] = []


class DeviceEvaluationRow(BaseModel):
    """one row of the mission-level evaluation table."""

    device_label: str
    result: DeviceEvaluationStr
    restrictions: str | None = None  # placeholder
    recommendations: str | None = None  # placeholder


class MissionResultsResponse(BaseModel):
    """mission-scale protocol-style aggregation - header, weather, runways, evaluation."""

    mission_id: UUID
    mission_name: str
    header: MissionResultsHeader
    weather: MissionWeatherPlaceholder
    runways: list[RunwayResults] = []
    evaluation: list[DeviceEvaluationRow] = []
    recommendations: str | None = None  # placeholder
