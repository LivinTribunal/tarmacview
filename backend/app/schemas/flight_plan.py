"""pydantic schemas for flight plan endpoints."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, computed_field, field_validator, model_validator

from app.core.enums import MissionStatus

# legacy violation-kind classification lives in its own module; re-imported here
# so the public schemas.flight_plan surface (consumed by tests) stays unchanged
from app.schemas._violation_classifier import (
    _CONSTRAINT_NAME_MAP,
    _classify_violation,
    _extract_waypoint_ref,
)
from app.schemas.geometry import PointZ


class WaypointResponse(BaseModel):
    """waypoint in flight plan."""

    id: UUID
    flight_plan_id: UUID
    inspection_id: UUID | None = None
    sequence_order: int
    position: PointZ
    heading: float | None = None
    speed: float | None = None
    hover_duration: float | None = None
    camera_action: str | None = None
    waypoint_type: str
    camera_target: PointZ | None = None
    gimbal_pitch: float | None = None
    # rendering-only: per-point AGL relative to local sampled ground. populated by
    # build_enriched_response from a single batched elevation lookup; the renderer
    # places the dot at sampled_cesium_terrain(lng, lat) + agl, no airport-wide math.
    agl: float | None = None
    camera_target_agl: float | None = None

    model_config = {"from_attributes": True}


class ValidationViolationResponse(BaseModel):
    """validation violation."""

    id: UUID
    category: Literal["violation", "warning", "suggestion"]
    message: str
    constraint_id: UUID | None = None
    waypoint_ids: list[str] = []
    # stored at emission; null on legacy rows -> classified from message below
    violation_kind: str | None = None

    @field_validator("waypoint_ids", mode="before")
    @classmethod
    def _coerce_none_to_list(cls, v: list[str] | None) -> list[str]:
        """coerce null waypoint_ids from db to empty list."""
        return v if v else []

    @model_validator(mode="after")
    def _classify_legacy_kind(self) -> "ValidationViolationResponse":
        """legacy rows persisted before structured kinds: classify from message."""
        if self.violation_kind is None:
            self.violation_kind = _classify_violation(self.message)
        return self

    @computed_field
    @property
    def is_warning(self) -> bool:
        """backwards-compat computed property."""
        return self.category != "violation"

    @computed_field
    @property
    def severity(self) -> str:
        """return category as severity - they are now equivalent."""
        return self.category

    @computed_field
    @property
    def constraint_name(self) -> str | None:
        """human-readable constraint name derived from violation kind."""
        kind = self.violation_kind
        return _CONSTRAINT_NAME_MAP.get(kind) if kind else None

    @computed_field
    @property
    def waypoint_ref(self) -> str | None:
        """waypoint reference extracted from message text."""
        return _extract_waypoint_ref(self.message)

    model_config = {"from_attributes": True}


class ValidationResultResponse(BaseModel):
    """validation result."""

    id: UUID
    passed: bool
    validated_at: datetime | None = None
    violations: list[ValidationViolationResponse] = []

    model_config = {"from_attributes": True}


class InspectionFlightStats(BaseModel):
    """per-inspection computed flight stats."""

    inspection_id: UUID
    min_altitude_agl: float
    max_altitude_agl: float
    min_altitude_msl: float
    max_altitude_msl: float
    waypoint_count: int
    segment_duration: float | None = None
    # displayed-only bearing between first and last measurement waypoint, 0-359.
    # None for single-wp trajectories and methods where lateral direction is not meaningful.
    direction_bearing: int | None = None


class FlightPlanResponse(BaseModel):
    """flight plan response."""

    id: UUID
    mission_id: UUID
    airport_id: UUID
    total_distance: float | None = None
    estimated_duration: float | None = None
    is_validated: bool
    generated_at: datetime | None = None
    waypoints: list[WaypointResponse] = []
    validation_result: ValidationResultResponse | None = None

    # flight statistics
    min_altitude_agl: float | None = None
    max_altitude_agl: float | None = None
    min_altitude_msl: float | None = None
    max_altitude_msl: float | None = None
    transit_speed: float | None = None
    average_speed: float | None = None
    inspection_stats: list[InspectionFlightStats] = []

    model_config = {"from_attributes": True}


class WaypointPositionUpdate(BaseModel):
    """single waypoint position update in a batch."""

    waypoint_id: UUID
    position: PointZ
    camera_target: PointZ | None = None


class WaypointBatchUpdateRequest(BaseModel):
    """batch update request for waypoint positions."""

    updates: list[WaypointPositionUpdate]


class TransitWaypointInsertRequest(BaseModel):
    """insert a new transit waypoint after a given sequence position."""

    position: PointZ
    after_sequence: int


class GenerateTrajectoryResponse(BaseModel):
    """response from trajectory generation."""

    flight_plan: FlightPlanResponse
    mission_status: MissionStatus
