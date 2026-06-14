"""safety zone CRUD + boundary/altitude-band invariants."""

from uuid import UUID

from sqlalchemy.orm import Session

from app.core.enums import SafetyZoneType
from app.core.exceptions import ConflictError, DomainError, NotFoundError
from app.models.airport import Airport, SafetyZone
from app.schemas.infrastructure import SafetyZoneCreate, SafetyZoneUpdate
from app.services.geometry_converter import apply_schema_update, schema_to_model_data


# safety zones
def list_safety_zones(db: Session, airport_id: UUID) -> list[SafetyZone]:
    """list safety zones for airport."""
    return db.query(SafetyZone).filter(SafetyZone.airport_id == airport_id).all()


def create_safety_zone(db: Session, airport_id: UUID, schema: SafetyZoneCreate) -> SafetyZone:
    """create safety zone via airport aggregate root."""
    airport = db.query(Airport).filter(Airport.id == airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")

    data = schema_to_model_data(schema)
    zone = SafetyZone(**data)
    airport.add_safety_zone(zone)
    db.flush()
    db.refresh(zone)

    return zone


def update_safety_zone(
    db: Session, airport_id: UUID, zone_id: UUID, schema: SafetyZoneUpdate
) -> SafetyZone:
    """update safety zone, validates it belongs to airport."""
    zone = (
        db.query(SafetyZone)
        .filter(SafetyZone.id == zone_id, SafetyZone.airport_id == airport_id)
        .first()
    )
    if not zone:
        raise NotFoundError("safety zone not found")

    # enforce max-one-boundary invariant when switching a non-boundary zone to AIRPORT_BOUNDARY
    if (
        schema.type == SafetyZoneType.AIRPORT_BOUNDARY.value
        and zone.type != SafetyZoneType.AIRPORT_BOUNDARY.value
    ):
        existing = (
            db.query(SafetyZone)
            .filter(
                SafetyZone.airport_id == airport_id,
                SafetyZone.type == SafetyZoneType.AIRPORT_BOUNDARY.value,
                SafetyZone.id != zone_id,
            )
            .first()
        )
        if existing:
            raise ConflictError("Airport boundary already exists. Delete the existing one first.")

    # determine target type - schema.type may be None on partial update
    target_type = schema.type if schema.type is not None else zone.type

    # boundary zones ignore altitude band - reject altitude payload for clarity
    if target_type == SafetyZoneType.AIRPORT_BOUNDARY.value:
        if schema.altitude_floor is not None or schema.altitude_ceiling is not None:
            raise DomainError(
                "altitude_floor and altitude_ceiling are not allowed for AIRPORT_BOUNDARY zones"
            )

    apply_schema_update(zone, schema)

    # boundary zones never carry altitude - clear stale floor/ceiling that
    # may be persisted from a prior non-boundary state (the schema validator
    # only inspects the inbound payload, not the persisted row)
    if target_type == SafetyZoneType.AIRPORT_BOUNDARY.value:
        zone.altitude_floor = None
        zone.altitude_ceiling = None

    # cross-field check after merge - partial updates can invert the envelope
    if (
        zone.altitude_floor is not None
        and zone.altitude_ceiling is not None
        and zone.altitude_floor > zone.altitude_ceiling
    ):
        raise DomainError("altitude_floor must be <= altitude_ceiling", status_code=422)

    db.flush()
    db.refresh(zone)

    return zone


def delete_safety_zone(db: Session, airport_id: UUID, zone_id: UUID):
    """delete safety zone, validates it belongs to airport."""
    zone = (
        db.query(SafetyZone)
        .filter(SafetyZone.id == zone_id, SafetyZone.airport_id == airport_id)
        .first()
    )
    if not zone:
        raise NotFoundError("safety zone not found")

    db.delete(zone)
    db.flush()
