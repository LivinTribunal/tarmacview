"""mission CRUD, duplication, status transitions, regress-on-trajectory-change entrypoint."""

from uuid import UUID

from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.enums import MissionStatus
from app.core.exceptions import DomainError, NotFoundError
from app.models.airport import Airport
from app.models.flight_plan import FlightPlan, ValidationResult
from app.models.inspection import Inspection
from app.models.mission import TRANSITIONS, DroneProfile, Mission
from app.schemas.mission import MissionCreate, MissionUpdate
from app.services.geometry_converter import apply_schema_update, schema_to_model_data


def transition_mission(db: Session, mission_id: UUID, target_status: str) -> Mission:
    """validate and execute status transition via aggregate root."""
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise NotFoundError("mission not found")

    try:
        mission.transition_to(target_status)
    except ValueError as e:
        raise DomainError(
            str(e),
            status_code=409,
            extra={
                "error": "invalid status transition",
                "current_status": mission.status,
                "target_status": target_status,
                "allowed_transitions": TRANSITIONS.get(mission.status, []),
            },
        )

    # flush only - route commits state change + audit row in one transaction
    db.flush()
    db.refresh(mission)

    return mission


def list_missions(
    db: Session,
    airport_id: UUID | None = None,
    status: str | None = None,
    drone_profile_id: UUID | None = None,
    limit: int = 20,
    offset: int = 0,
    airport_ids: list[UUID] | None = None,
) -> tuple[list[Mission], int]:
    """list missions with optional filters and pagination."""
    if status is not None:
        valid = {s.value for s in MissionStatus}
        if status not in valid:
            raise DomainError(f"invalid status, must be one of {valid}")

    # shared predicates for data and count queries
    filters = []
    if airport_ids is not None:
        filters.append(Mission.airport_id.in_(airport_ids))
    if airport_id:
        filters.append(Mission.airport_id == airport_id)
    if status:
        filters.append(Mission.status == status)
    if drone_profile_id:
        filters.append(Mission.drone_profile_id == drone_profile_id)

    query = (
        db.query(Mission)
        .options(
            joinedload(Mission.inspections),
            joinedload(Mission.flight_plan),
            joinedload(Mission.drone_profile),
        )
        .filter(*filters)
    )

    # count on a clean query to avoid joinedload duplicates
    total = db.query(Mission).filter(*filters).count()

    missions = query.order_by(Mission.created_at.desc()).offset(offset).limit(limit).all()

    return missions, total


def get_mission(db: Session, mission_id: UUID) -> Mission:
    """get mission with inspections."""
    mission = (
        db.query(Mission)
        .options(
            joinedload(Mission.inspections).joinedload(Inspection.config),
            joinedload(Mission.drone_profile),
        )
        .filter(Mission.id == mission_id)
        .first()
    )
    if not mission:
        raise NotFoundError("mission not found")

    return mission


def create_mission(db: Session, schema: MissionCreate) -> Mission:
    """create mission in DRAFT status."""
    airport = db.query(Airport).filter(Airport.id == schema.airport_id).first()
    if not airport:
        raise DomainError("airport not found")

    drone: DroneProfile | None = None
    if schema.drone_profile_id:
        drone = db.query(DroneProfile).filter(DroneProfile.id == schema.drone_profile_id).first()
        if not drone:
            raise DomainError("drone profile not found")

    data = schema_to_model_data(schema)

    # auto-fill from airport default when no drone specified
    if not data.get("drone_profile_id") and airport.default_drone_profile_id:
        data["drone_profile_id"] = airport.default_drone_profile_id
        drone = (
            db.query(DroneProfile)
            .filter(DroneProfile.id == airport.default_drone_profile_id)
            .first()
        )

    mission = Mission(**data)

    try:
        mission.validate_transit_altitude(drone)
    except ValueError as e:
        raise DomainError(str(e), status_code=422)

    db.add(mission)
    db.flush()
    db.refresh(mission)

    return mission


def update_mission(db: Session, mission_id: UUID, schema: MissionUpdate) -> Mission:
    """update mission - invalidates trajectory on config changes."""
    mission = (
        db.query(Mission)
        .options(joinedload(Mission.flight_plan))
        .filter(Mission.id == mission_id)
        .first()
    )
    if not mission:
        raise NotFoundError("mission not found")

    data = schema.model_dump(exclude_unset=True)

    # trajectory-affecting changes regress to DRAFT but keep the stale flight
    # plan so the frontend can render it as a reference until a fresh recompute.
    try:
        mission.regress_if_trajectory_changed(data)
    except ValueError as e:
        raise DomainError(str(e), status_code=409)

    apply_schema_update(mission, schema)

    # validate the new cruise altitude against the (possibly updated) drone
    if "transit_agl" in data or "drone_profile_id" in data:
        drone = None
        drone_id = mission.drone_profile_id
        if drone_id:
            drone = db.query(DroneProfile).filter(DroneProfile.id == drone_id).first()
        try:
            mission.validate_transit_altitude(drone)
        except ValueError as e:
            raise DomainError(str(e), status_code=422)

    db.flush()
    db.refresh(mission)

    return mission


def delete_mission(db: Session, mission_id: UUID):
    """delete mission - allowed from any status."""
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if not mission:
        raise NotFoundError("mission not found")

    db.delete(mission)
    db.flush()


def duplicate_mission(db: Session, mission_id: UUID) -> Mission:
    """duplicate mission as new DRAFT.

    runs in a single db session that auto-rolls back on exception via the
    get_db dependency, so no explicit try/except is needed here.
    """
    original = (
        db.query(Mission)
        .options(
            joinedload(Mission.inspections).joinedload(Inspection.config),
            selectinload(Mission.flight_plan).selectinload(FlightPlan.waypoints),
            selectinload(Mission.flight_plan)
            .selectinload(FlightPlan.validation_result)
            .selectinload(ValidationResult.violations),
        )
        .filter(Mission.id == mission_id)
        .first()
    )
    if not original:
        raise NotFoundError("mission not found")

    copy = original.duplicate()
    db.add(copy)
    db.flush()
    db.refresh(copy)

    return copy
