"""obstacle CRUD + boundary-derived position/radius."""

from uuid import UUID

from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.models.airport import Airport, Obstacle
from app.schemas.geometry import PolygonZ
from app.schemas.infrastructure import ObstacleCreate, ObstacleUpdate
from app.services.airport.altitude import (
    _normalize_boundary_altitude,
    _renormalize_boundary_with_stored,
)
from app.services.geometry_converter import (
    apply_schema_update,
    geojson_to_wkt,
    schema_to_model_data,
)
from app.utils.geo import polygon_oriented_dimensions


def list_obstacles(db: Session, airport_id: UUID) -> list[Obstacle]:
    """list obstacles for airport."""
    return db.query(Obstacle).filter(Obstacle.airport_id == airport_id).all()


def _derive_position_and_radius(boundary: PolygonZ) -> tuple[str, float]:
    """compute centroid position WKT and radius from a polygon boundary."""
    ring = boundary.coordinates[0]
    pts = ring[:-1] if len(ring) >= 2 and ring[0] == ring[-1] else list(ring)
    n = len(pts)
    lon = sum(p[0] for p in pts) / n
    lat = sum(p[1] for p in pts) / n
    alt = sum((p[2] if len(p) >= 3 else 0) for p in pts) / n
    position = geojson_to_wkt({"type": "Point", "coordinates": [lon, lat, alt]})

    _, width, _ = polygon_oriented_dimensions(ring)
    radius = width / 2.0 if width > 0 else 0.0

    return position, radius


def create_obstacle(db: Session, airport_id: UUID, schema: ObstacleCreate) -> Obstacle:
    """create obstacle via airport aggregate root."""
    airport = db.query(Airport).filter(Airport.id == airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")

    _normalize_boundary_altitude(schema.boundary, airport)

    data = schema_to_model_data(schema)
    position, radius = _derive_position_and_radius(schema.boundary)
    data["position"] = position
    data["radius"] = radius
    obstacle = Obstacle(**data)
    airport.add_obstacle(obstacle)
    db.flush()
    db.refresh(obstacle)

    return obstacle


def update_obstacle(
    db: Session, airport_id: UUID, obstacle_id: UUID, schema: ObstacleUpdate
) -> Obstacle:
    """update obstacle, validates it belongs to airport."""
    airport = db.query(Airport).filter(Airport.id == airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")

    obstacle = (
        db.query(Obstacle)
        .filter(Obstacle.id == obstacle_id, Obstacle.airport_id == airport_id)
        .first()
    )
    if not obstacle:
        raise NotFoundError("obstacle not found")

    # normalize boundary z unless coordinator explicitly preserves altitude.
    # unchanged vertices keep their stored z byte-for-byte and skip the provider;
    # moved vertices get resampled.
    if schema.boundary and schema.boundary.coordinates and not schema.preserve_altitude:
        _renormalize_boundary_with_stored(schema.boundary, obstacle.boundary, airport)

    apply_schema_update(obstacle, schema)

    if schema.boundary and schema.boundary.coordinates:
        position, radius = _derive_position_and_radius(schema.boundary)
        obstacle.position = position
        obstacle.radius = radius

    db.flush()
    db.refresh(obstacle)

    return obstacle


def delete_obstacle(db: Session, airport_id: UUID, obstacle_id: UUID):
    """delete obstacle, validates it belongs to airport."""
    obstacle = (
        db.query(Obstacle)
        .filter(Obstacle.id == obstacle_id, Obstacle.airport_id == airport_id)
        .first()
    )
    if not obstacle:
        raise NotFoundError("obstacle not found")

    db.delete(obstacle)
    db.flush()


def recalculate_obstacle_dimensions(db: Session, airport_id: UUID, obstacle_id: UUID) -> dict:
    """compute obstacle dimensions from boundary, returns current + recalculated."""
    obstacle = (
        db.query(Obstacle)
        .filter(Obstacle.id == obstacle_id, Obstacle.airport_id == airport_id)
        .first()
    )
    if not obstacle:
        raise NotFoundError("obstacle not found")

    recalculated = obstacle.recalculate_dimensions()
    # obstacles have no stored length/width/heading/radius columns - all dimensions
    # are derived from the boundary polygon, so "current" is always None
    return {
        "current": {
            "length": None,
            "width": None,
            "heading": None,
            "radius": None,
        },
        "recalculated": recalculated,
    }
