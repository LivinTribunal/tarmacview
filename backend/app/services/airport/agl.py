"""AGL CRUD + along-runway distance autocompute."""

from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.core.exceptions import NotFoundError
from app.core.geometry import wkt_to_geojson
from app.models.agl import AGL
from app.models.airport import AirfieldSurface, Airport
from app.schemas.infrastructure import AGLCreate, AGLUpdate
from app.services.airport.altitude import (
    _normalize_position_altitude,
    _position_unchanged,
    _stored_point_coords,
)
from app.services.airport.surfaces import _along_runway_distance_from_threshold
from app.services.geometry_converter import apply_schema_update, schema_to_model_data


# AGLs
def list_agls(db: Session, airport_id: UUID, surface_id: UUID) -> list[AGL]:
    """list AGLs for surface, validates surface belongs to airport."""
    surface = (
        db.query(AirfieldSurface)
        .filter(AirfieldSurface.id == surface_id, AirfieldSurface.airport_id == airport_id)
        .first()
    )
    if not surface:
        raise NotFoundError("surface not found")

    return db.query(AGL).options(joinedload(AGL.lhas)).filter(AGL.surface_id == surface_id).all()


def create_agl(db: Session, airport_id: UUID, surface_id: UUID, schema: AGLCreate) -> AGL:
    """create AGL for surface, validates surface belongs to airport."""
    surface = (
        db.query(AirfieldSurface)
        .filter(AirfieldSurface.id == surface_id, AirfieldSurface.airport_id == airport_id)
        .first()
    )
    if not surface:
        raise NotFoundError("surface not found")

    # normalize position.z to ground elevation at AGL location
    airport = db.query(Airport).filter(Airport.id == airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")
    if schema.position and schema.position.coordinates:
        _normalize_position_altitude(schema.position.coordinates, airport, db=db)

    data = schema_to_model_data(schema)
    # auto-compute along-runway distance from threshold when not explicitly set
    pos = schema.position.coordinates if schema.position else None
    if data.get("distance_from_threshold") is None and pos:
        auto = _along_runway_distance_from_threshold(surface, pos[0], pos[1])
        if auto is not None:
            data["distance_from_threshold"] = auto
    agl = AGL(surface_id=surface_id, **data)
    db.add(agl)
    db.flush()
    db.refresh(agl)

    return agl


def update_agl(
    db: Session, airport_id: UUID, surface_id: UUID, agl_id: UUID, schema: AGLUpdate
) -> AGL:
    """update AGL, validates surface belongs to airport and AGL belongs to surface."""
    surface = (
        db.query(AirfieldSurface)
        .filter(AirfieldSurface.id == surface_id, AirfieldSurface.airport_id == airport_id)
        .first()
    )
    if not surface:
        raise NotFoundError("surface not found")

    agl = db.query(AGL).filter(AGL.id == agl_id, AGL.surface_id == surface_id).first()
    if not agl:
        raise NotFoundError("agl not found")

    # normalize position.z to ground unless coordinator explicitly preserves altitude.
    # identity round-trips (same lat/lon at 7 dp) preserve the stored z and skip
    # the provider entirely.
    airport = db.query(Airport).filter(Airport.id == airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")
    if schema.position and schema.position.coordinates and not schema.preserve_altitude:
        stored_coords = _stored_point_coords(agl.position)
        if _position_unchanged(schema.position.coordinates, stored_coords):
            if (
                stored_coords is not None
                and len(stored_coords) >= 3
                and len(schema.position.coordinates) >= 3
            ):
                schema.position.coordinates[2] = stored_coords[2]
        else:
            _normalize_position_altitude(schema.position.coordinates, airport, db=db)

    sent_fields = schema.model_dump(exclude_unset=True).keys()

    # capture coords for auto-compute before apply_schema_update converts position to WKT
    coords_for_autocalc: list[float] | None = None
    if "position" in sent_fields and schema.position and schema.position.coordinates:
        coords_for_autocalc = list(schema.position.coordinates)
    elif agl.position is not None:
        try:
            geojson = wkt_to_geojson(agl.position)
            coords_for_autocalc = geojson.get("coordinates") if geojson else None
        except Exception:
            coords_for_autocalc = None

    apply_schema_update(agl, schema)

    # auto-compute distance from threshold when position changed but field
    # was not explicitly provided, or when field was explicitly cleared to null.
    should_autocompute = agl.distance_from_threshold is None or (
        "position" in sent_fields and "distance_from_threshold" not in sent_fields
    )
    if should_autocompute and coords_for_autocalc:
        auto = _along_runway_distance_from_threshold(
            surface, coords_for_autocalc[0], coords_for_autocalc[1]
        )
        if auto is not None:
            agl.distance_from_threshold = auto

    db.flush()
    db.refresh(agl)

    return agl


def delete_agl(db: Session, airport_id: UUID, surface_id: UUID, agl_id: UUID):
    """delete AGL, validates surface belongs to airport and AGL belongs to surface."""
    surface = (
        db.query(AirfieldSurface)
        .filter(AirfieldSurface.id == surface_id, AirfieldSurface.airport_id == airport_id)
        .first()
    )
    if not surface:
        raise NotFoundError("surface not found")

    agl = db.query(AGL).filter(AGL.id == agl_id, AGL.surface_id == surface_id).first()
    if not agl:
        raise NotFoundError("agl not found")

    db.delete(agl)
    db.flush()
