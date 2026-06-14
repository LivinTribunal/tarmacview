"""report data container and the single db-touching loader."""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.core.exceptions import ConflictError, NotFoundError
from app.models.agl import AGL
from app.models.airport import AirfieldSurface, Airport
from app.models.flight_plan import (
    ConstraintRule,
    FlightPlan,
    ValidationResult,
    ValidationViolation,
    Waypoint,
)
from app.models.inspection import Inspection, InspectionTemplate
from app.models.mission import DroneProfile, Mission


@dataclass
class ReportData:
    """internal data container for pdf generation."""

    mission: Mission
    flight_plan: FlightPlan
    airport: Airport
    drone_profile: DroneProfile | None
    waypoints: list[Waypoint]
    inspections: list[Inspection]
    validation_result: ValidationResult | None
    violations: list[ValidationViolation]
    constraints: list[ConstraintRule]
    operator_label: str = "N/A"


def _load_report_data(db: Session, mission_id: UUID) -> ReportData:
    """load all data needed for the mission report."""
    mission = (
        db.query(Mission)
        .options(
            joinedload(Mission.inspections).joinedload(Inspection.config),
            joinedload(Mission.inspections)
            .joinedload(Inspection.template)
            .joinedload(InspectionTemplate.default_config),
            joinedload(Mission.constraints),
        )
        .filter(Mission.id == mission_id)
        .first()
    )
    if not mission:
        raise NotFoundError("mission not found")

    flight_plan = (
        db.query(FlightPlan)
        .options(
            joinedload(FlightPlan.waypoints),
            joinedload(FlightPlan.validation_result).joinedload(ValidationResult.violations),
        )
        .filter(FlightPlan.mission_id == mission_id)
        .first()
    )
    if not flight_plan:
        raise ConflictError("no flight plan exists for this mission")

    airport = (
        db.query(Airport)
        .options(
            joinedload(Airport.surfaces).joinedload(AirfieldSurface.agls).joinedload(AGL.lhas),
            joinedload(Airport.safety_zones),
        )
        .filter(Airport.id == mission.airport_id)
        .first()
    )
    if not airport:
        raise NotFoundError("airport not found")

    drone_profile = None
    if mission.drone_profile_id:
        drone_profile = db.get(DroneProfile, mission.drone_profile_id)

    waypoints = sorted(flight_plan.waypoints, key=lambda w: w.sequence_order)
    inspections = sorted(mission.inspections, key=lambda i: i.sequence_order)
    validation_result = flight_plan.validation_result
    violations = validation_result.violations if validation_result else []
    constraints = list(mission.constraints)

    return ReportData(
        mission=mission,
        flight_plan=flight_plan,
        airport=airport,
        drone_profile=drone_profile,
        waypoints=waypoints,
        inspections=inspections,
        validation_result=validation_result,
        violations=violations,
        constraints=constraints,
    )
