"""airport CRUD + default-drone / bulk-change-drone."""

from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.core.enums import MissionStatus, UserRole
from app.core.exceptions import DomainError, NotFoundError
from app.models.agl import AGL
from app.models.airport import AirfieldSurface, Airport
from app.models.mission import DroneProfile, Mission
from app.models.user import User
from app.schemas.airport import AirportCreate, AirportSummaryResponse, AirportUpdate
from app.services.airport.altitude import renormalize_airport_altitudes
from app.services.geometry_converter import apply_schema_update, schema_to_model_data


# airports
def list_airports(db: Session, airport_ids: list[UUID] | None = None) -> list[Airport]:
    """list airports, optionally filtered by id list."""
    query = db.query(Airport)
    if airport_ids is not None:
        query = query.filter(Airport.id.in_(airport_ids))
    return query.all()


def list_airports_with_counts(
    db: Session, airport_ids: list[UUID] | None = None
) -> list[AirportSummaryResponse]:
    """list airports with infrastructure and mission counts, optionally filtered."""
    surfaces_sub = (
        db.query(
            AirfieldSurface.airport_id,
            func.count(AirfieldSurface.id).label("surfaces_count"),
        )
        .group_by(AirfieldSurface.airport_id)
        .subquery()
    )

    agls_sub = (
        db.query(
            AirfieldSurface.airport_id,
            func.count(AGL.id).label("agls_count"),
        )
        .join(AGL, AGL.surface_id == AirfieldSurface.id)
        .group_by(AirfieldSurface.airport_id)
        .subquery()
    )

    missions_sub = (
        db.query(
            Mission.airport_id,
            func.count(Mission.id).label("missions_count"),
        )
        .group_by(Mission.airport_id)
        .subquery()
    )

    query = (
        db.query(
            Airport,
            func.coalesce(surfaces_sub.c.surfaces_count, 0).label("surfaces_count"),
            func.coalesce(agls_sub.c.agls_count, 0).label("agls_count"),
            func.coalesce(missions_sub.c.missions_count, 0).label("missions_count"),
        )
        .outerjoin(surfaces_sub, Airport.id == surfaces_sub.c.airport_id)
        .outerjoin(agls_sub, Airport.id == agls_sub.c.airport_id)
        .outerjoin(missions_sub, Airport.id == missions_sub.c.airport_id)
    )
    if airport_ids is not None:
        query = query.filter(Airport.id.in_(airport_ids))
    rows = query.all()

    results = []
    for airport, s_count, a_count, m_count in rows:
        data = AirportSummaryResponse.model_validate(airport, from_attributes=True)
        data.surfaces_count = s_count
        data.agls_count = a_count
        data.missions_count = m_count
        results.append(data)

    return results


def get_airport(db: Session, airport_id: UUID) -> Airport:
    """get airport with nested infrastructure."""
    airport = (
        db.query(Airport)
        .options(
            joinedload(Airport.surfaces).joinedload(AirfieldSurface.agls).joinedload(AGL.lhas),
            joinedload(Airport.obstacles),
            joinedload(Airport.safety_zones),
        )
        .filter(Airport.id == airport_id)
        .first()
    )
    if not airport:
        raise NotFoundError("airport not found")

    return airport


def create_airport(db: Session, schema: AirportCreate, *, creator: User | None = None) -> Airport:
    """create airport - icao validation happens at the schema layer.

    a coordinator creator is auto-assigned so the new airport is never orphaned
    (it would otherwise be invisible to the coordinator who made it). super
    admins bypass the airport-access check by design, so their airports stay
    unassigned and surface to admins as orphaned.
    """
    airport = Airport(**schema_to_model_data(schema))
    db.add(airport)
    db.flush()

    if creator is not None and creator.role == UserRole.COORDINATOR.value:
        creator.airports.append(airport)
        db.flush()

    db.refresh(airport)

    return airport


ELEVATION_FIELDS: frozenset[str] = frozenset({"elevation", "terrain_source", "dem_file_path"})


def elevation_fields_changed(schema: AirportUpdate) -> bool:
    """return true when the inbound update touches an elevation-related column."""
    return bool(schema.model_fields_set & ELEVATION_FIELDS)


def update_airport(
    db: Session, airport_id: UUID, schema: AirportUpdate, *, renormalize: bool = True
) -> Airport:
    """update airport; resample existing altitudes when an elevation field changed.

    with ``renormalize`` true (default) and an elevation field changed, every
    existing obstacle / AGL / LHA / mission takeoff-landing altitude resamples
    against the new terrain provider. ``renormalize=False`` leaves persisted
    altitudes intact (only entities created afterwards sample the new terrain).
    """
    airport = db.query(Airport).filter(Airport.id == airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")

    elevation_changed = elevation_fields_changed(schema)

    # value objects are immutable, ORM models are mutable - updates apply to ORM instances
    apply_schema_update(airport, schema)

    db.flush()
    if elevation_changed and renormalize:
        renormalize_airport_altitudes(db, airport_id)

    db.refresh(airport)

    return airport


def delete_airport(db: Session, airport_id: UUID):
    """delete airport."""
    airport = db.query(Airport).filter(Airport.id == airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")

    db.delete(airport)
    db.flush()


def set_default_drone(db: Session, airport_id: UUID, drone_profile_id: UUID | None) -> Airport:
    """set or clear the default drone profile for an airport."""
    airport = db.query(Airport).filter(Airport.id == airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")

    if drone_profile_id:
        drone = db.query(DroneProfile).filter(DroneProfile.id == drone_profile_id).first()
        if not drone:
            raise DomainError("drone profile not found")

    airport.default_drone_profile_id = drone_profile_id
    db.flush()
    db.refresh(airport)

    return airport


def bulk_change_drone(
    db: Session,
    airport_id: UUID,
    drone_profile_id: UUID,
    from_drone_id: UUID | None = None,
    scope: str = "ALL_DRAFT",
    mission_ids: list[UUID] | None = None,
) -> tuple[int, int, list[UUID]]:
    """change drone profile on missions at an airport.

    scope ALL_DRAFT updates all draft missions (optionally filtered by from_drone_id).
    scope SELECTED updates only the listed mission_ids (draft + planned allowed).
    """
    airport = db.query(Airport).filter(Airport.id == airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")

    drone = db.query(DroneProfile).filter(DroneProfile.id == drone_profile_id).first()
    if not drone:
        raise DomainError("drone profile not found")

    updated_ids: list[UUID] = []
    regressed_count = 0

    if scope == "SELECTED":
        if not mission_ids:
            return 0, 0, []
        missions = (
            db.query(Mission)
            .filter(
                Mission.airport_id == airport_id,
                Mission.id.in_(mission_ids),
                Mission.status.in_(Mission.PRE_PLAN_STATUSES),
            )
            .all()
        )
        for mission in missions:
            was_planned = mission.status == MissionStatus.PLANNED
            mission.change_drone_profile(drone_profile_id)
            updated_ids.append(mission.id)
            if was_planned:
                regressed_count += 1
    else:
        # ALL_DRAFT
        query = db.query(Mission).filter(
            Mission.airport_id == airport_id, Mission.status == MissionStatus.DRAFT
        )
        if from_drone_id:
            query = query.filter(Mission.drone_profile_id == from_drone_id)
        draft_missions = query.all()
        for mission in draft_missions:
            mission.change_drone_profile(drone_profile_id)
            updated_ids.append(mission.id)

    db.flush()

    return len(updated_ids), regressed_count, updated_ids
