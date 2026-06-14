"""surface CRUD + runway pair-link write paths and dimension recompute."""

import math
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.core.exceptions import DomainError, NotFoundError
from app.core.geometry import wkt_to_geojson
from app.models.agl import AGL
from app.models.airport import AirfieldSurface, Airport
from app.schemas.infrastructure import SurfaceCreate, SurfaceUpdate
from app.services.geometry_converter import apply_schema_update, schema_to_model_data
from app.utils.geo import bearing_between, distance_between


# surfaces
def list_surfaces(db: Session, airport_id: UUID) -> list[AirfieldSurface]:
    """list surfaces for airport."""
    return (
        db.query(AirfieldSurface)
        .options(joinedload(AirfieldSurface.agls).joinedload(AGL.lhas))
        .filter(AirfieldSurface.airport_id == airport_id)
        .all()
    )


def _derive_taxiway_heading(surface: AirfieldSurface) -> None:
    """set heading from the centerline first-to-last bearing; no-op for runways."""
    if surface.surface_type != "TAXIWAY":
        return
    derived = surface.recalculate_dimensions()["heading"]
    if derived is not None:
        surface.heading = derived


def create_surface(db: Session, airport_id: UUID, schema: SurfaceCreate) -> AirfieldSurface:
    """create surface via airport aggregate root."""
    airport = db.query(Airport).filter(Airport.id == airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")

    data = schema_to_model_data(schema)
    surface = AirfieldSurface(**data)

    # taxiway heading derives from the centerline when not explicitly provided
    if surface.heading is None:
        _derive_taxiway_heading(surface)

    airport.add_surface(surface)
    db.flush()
    db.refresh(surface)

    return surface


def update_surface(
    db: Session, airport_id: UUID, surface_id: UUID, schema: SurfaceUpdate
) -> AirfieldSurface:
    """update surface, validates it belongs to airport.

    when the surface is coupled, geometry-affecting fields propagate to the
    paired surface (centerline reversed, threshold/end swapped, heading
    reciprocated). identifier rename is rejected while coupled.
    """
    surface = (
        db.query(AirfieldSurface)
        .filter(AirfieldSurface.id == surface_id, AirfieldSurface.airport_id == airport_id)
        .with_for_update()
        .first()
    )
    if not surface:
        raise NotFoundError("surface not found")

    sent_fields = schema.model_fields_set
    pair = _load_paired_for_update(db, surface)

    if pair is not None and "identifier" in sent_fields:
        raise DomainError(
            "identifier cannot be renamed while the surface is coupled; decouple first",
            status_code=422,
        )

    apply_schema_update(surface, schema)

    # re-derive taxiway heading when geometry changes without an explicit heading
    if "geometry" in sent_fields and "heading" not in sent_fields:
        _derive_taxiway_heading(surface)

    db.flush()

    if pair is not None:
        _propagate_pair_geometry(surface, pair, sent_fields)
        db.flush()

    if pair is not None and (sent_fields & {"threshold_position", "end_position"}):
        _recompute_agls_distance_from_threshold(db, surface)
        _recompute_agls_distance_from_threshold(db, pair)
        db.flush()

    db.refresh(surface)
    if pair is not None:
        db.refresh(pair)

    return surface


def delete_surface(
    db: Session, airport_id: UUID, surface_id: UUID
) -> tuple[AirfieldSurface | None, AirfieldSurface | None]:
    """delete surface, cascading to the paired surface when coupled.

    returns ``(deleted, paired_deleted)`` so the route can emit a per-side
    audit row. paired_deleted is ``None`` when the surface was uncoupled.
    """
    surface = (
        db.query(AirfieldSurface)
        .filter(AirfieldSurface.id == surface_id, AirfieldSurface.airport_id == airport_id)
        .with_for_update()
        .first()
    )
    if not surface:
        raise NotFoundError("surface not found")

    pair = _load_paired_for_update(db, surface)

    # break the symmetric link before deleting - SET NULL would handle the
    # surviving side once a row goes away, but in a single-statement cascade
    # we may delete both rows in either order, and the FK on the not-yet-deleted
    # row could reject. clearing both ids first keeps the delete order free.
    if pair is not None:
        surface.paired_surface_id = None
        pair.paired_surface_id = None
        db.flush()
        db.delete(pair)

    db.delete(surface)
    db.flush()

    return surface, pair


def couple_surfaces(
    db: Session, airport_id: UUID, surface_id: UUID, schema
) -> tuple[AirfieldSurface, AirfieldSurface]:
    """couple two RUNWAY surfaces; primary side overwrites the secondary's geometry."""
    primary = (
        db.query(AirfieldSurface)
        .filter(AirfieldSurface.id == surface_id, AirfieldSurface.airport_id == airport_id)
        .with_for_update()
        .first()
    )
    if not primary:
        raise NotFoundError("surface not found")

    target_id = schema.target_surface_id
    if target_id == surface_id:
        raise DomainError("cannot couple a surface to itself", status_code=422)

    target = (
        db.query(AirfieldSurface).filter(AirfieldSurface.id == target_id).with_for_update().first()
    )
    if not target:
        raise NotFoundError("target surface not found")

    if target.airport_id != primary.airport_id:
        raise DomainError("paired surfaces must belong to the same airport", status_code=422)

    if primary.surface_type != "RUNWAY" or target.surface_type != "RUNWAY":
        raise DomainError("only RUNWAY surfaces can be coupled", status_code=422)

    if primary.paired_surface_id is not None or target.paired_surface_id is not None:
        raise DomainError("one or both surfaces are already coupled", status_code=422)

    src, dst = (primary, target) if schema.primary == "self" else (target, primary)

    _overwrite_pair_geometry(src, dst)

    primary.paired_surface_id = target.id
    target.paired_surface_id = primary.id

    db.flush()
    _recompute_agls_distance_from_threshold(db, primary)
    _recompute_agls_distance_from_threshold(db, target)
    db.flush()
    db.refresh(primary)
    db.refresh(target)

    return primary, target


def decouple_surfaces(
    db: Session, airport_id: UUID, surface_id: UUID
) -> tuple[AirfieldSurface, AirfieldSurface]:
    """clear paired_surface_id on both sides; geometry stays as-is."""
    surface = (
        db.query(AirfieldSurface)
        .filter(AirfieldSurface.id == surface_id, AirfieldSurface.airport_id == airport_id)
        .with_for_update()
        .first()
    )
    if not surface:
        raise NotFoundError("surface not found")

    pair = _load_paired_for_update(db, surface)
    if pair is None:
        raise DomainError("surface is not coupled", status_code=422)

    surface.paired_surface_id = None
    pair.paired_surface_id = None

    db.flush()
    db.refresh(surface)
    db.refresh(pair)

    return surface, pair


def create_reverse_surface(
    db: Session, airport_id: UUID, surface_id: UUID, schema
) -> tuple[AirfieldSurface, AirfieldSurface]:
    """create the reverse direction of a runway, auto-couple, and return both."""
    base = (
        db.query(AirfieldSurface)
        .filter(AirfieldSurface.id == surface_id, AirfieldSurface.airport_id == airport_id)
        .with_for_update()
        .first()
    )
    if not base:
        raise NotFoundError("surface not found")

    if base.surface_type != "RUNWAY":
        raise DomainError("only RUNWAY surfaces can have a reverse direction", status_code=422)

    if base.paired_surface_id is not None:
        raise DomainError("surface is already coupled", status_code=422)

    identifier = schema.identifier or _reciprocal_runway_identifier(base.identifier)

    reverse = AirfieldSurface(
        airport_id=base.airport_id,
        identifier=identifier,
        surface_type="RUNWAY",
        geometry=_reverse_linestring_wkt(base.geometry),
        boundary=base.boundary,
        buffer_distance=base.buffer_distance,
        heading=_reciprocal_heading(base.heading),
        length=base.length,
        width=base.width,
        threshold_position=base.end_position,
        end_position=base.threshold_position,
    )
    db.add(reverse)
    db.flush()

    base.paired_surface_id = reverse.id
    reverse.paired_surface_id = base.id

    db.flush()
    _recompute_agls_distance_from_threshold(db, base)
    _recompute_agls_distance_from_threshold(db, reverse)
    db.flush()
    db.refresh(base)
    db.refresh(reverse)

    return base, reverse


# pair-link helpers
_PAIR_PROPAGATING_FIELDS = {
    "boundary",
    "buffer_distance",
    "length",
    "width",
}


def _load_paired_for_update(db: Session, surface: AirfieldSurface) -> AirfieldSurface | None:
    """load the paired surface with FOR UPDATE, returning None when uncoupled."""
    if surface.paired_surface_id is None:
        return None
    return (
        db.query(AirfieldSurface)
        .filter(AirfieldSurface.id == surface.paired_surface_id)
        .with_for_update()
        .first()
    )


def _propagate_pair_geometry(
    src: AirfieldSurface, dst: AirfieldSurface, sent_fields: set[str]
) -> None:
    """copy geometry-affecting fields from src to dst, reversed/swapped per pair semantics."""
    for f in _PAIR_PROPAGATING_FIELDS & sent_fields:
        setattr(dst, f, getattr(src, f))

    if "geometry" in sent_fields and src.geometry is not None:
        dst.geometry = _reverse_linestring_wkt(src.geometry)

    if "heading" in sent_fields and src.heading is not None:
        dst.heading = _reciprocal_heading(src.heading)

    if "threshold_position" in sent_fields or "end_position" in sent_fields:
        new_threshold = src.end_position
        new_end = src.threshold_position
        dst.threshold_position = new_threshold
        dst.end_position = new_end


def _overwrite_pair_geometry(src: AirfieldSurface, dst: AirfieldSurface) -> None:
    """overwrite dst geometry with src on couple - centerline reversed, threshold/end swapped."""
    dst.boundary = src.boundary
    dst.buffer_distance = src.buffer_distance
    dst.length = src.length
    dst.width = src.width
    if src.geometry is not None:
        dst.geometry = _reverse_linestring_wkt(src.geometry)
    if src.heading is not None:
        dst.heading = _reciprocal_heading(src.heading)
    dst.threshold_position = src.end_position
    dst.end_position = src.threshold_position


def _reverse_linestring_wkt(geom: str | None) -> str | None:
    """return a new LINESTRING Z WKT string with the points in reversed order."""
    if geom is None:
        return None
    parsed = wkt_to_geojson(geom)
    coords = parsed.get("coordinates", []) if parsed else []
    if len(coords) < 2:
        return geom
    reversed_coords = list(reversed(coords))
    pts = ", ".join(f"{c[0]} {c[1]} {c[2] if len(c) >= 3 else 0}" for c in reversed_coords)
    return f"LINESTRING Z ({pts})"


def _reciprocal_heading(heading: float | None) -> float | None:
    """return the reciprocal heading (180 deg opposite), normalized to [0, 360)."""
    if heading is None:
        return None
    return (heading + 180.0) % 360.0


def _recompute_agls_distance_from_threshold(db: Session, surface: AirfieldSurface) -> None:
    """recompute distance_from_threshold for every AGL on this surface."""
    agls = db.query(AGL).filter(AGL.surface_id == surface.id).all()
    for agl in agls:
        if agl.position is None:
            continue
        try:
            geojson = wkt_to_geojson(agl.position)
            coords = geojson.get("coordinates") if geojson else None
        except ValueError:
            # malformed WKT on a single AGL shouldn't block the rest of the recompute
            continue
        if not coords or len(coords) < 2:
            continue
        auto = _along_runway_distance_from_threshold(surface, coords[0], coords[1])
        if auto is not None:
            agl.distance_from_threshold = auto


def _reciprocal_runway_identifier(identifier: str) -> str:
    """derive the reciprocal runway identifier (e.g. 01->19, 09L->27R, 36C->18C).

    falls back to a "-R" suffix when the input is not in the standard
    NN[L|R|C] form so the coordinator still gets a deterministic name.
    """
    raw = (identifier or "").strip().upper()
    digits = ""
    suffix = ""
    for ch in raw:
        if ch.isdigit() and len(digits) < 2:
            digits += ch
        else:
            suffix = raw[len(digits) :]
            break
    if not digits:
        return f"{raw}-R"
    try:
        n = int(digits)
    except ValueError:
        return f"{raw}-R"

    reciprocal = ((n - 1 + 18) % 36) + 1
    digit_str = f"{reciprocal:02d}"

    if suffix == "L":
        suffix_out = "R"
    elif suffix == "R":
        suffix_out = "L"
    else:
        suffix_out = suffix

    return digit_str + suffix_out


def recalculate_surface_dimensions(db: Session, airport_id: UUID, surface_id: UUID) -> dict:
    """compute surface length/width/heading from geometry, returns current + recalculated."""
    surface = (
        db.query(AirfieldSurface)
        .filter(AirfieldSurface.id == surface_id, AirfieldSurface.airport_id == airport_id)
        .first()
    )
    if not surface:
        raise NotFoundError("surface not found")

    return {
        "current": {
            "length": surface.length,
            "width": surface.width,
            "heading": surface.heading,
        },
        "recalculated": surface.recalculate_dimensions(),
    }


def _along_runway_distance_from_threshold(
    surface: AirfieldSurface, lon: float, lat: float
) -> float | None:
    """along-centerline distance from runway threshold to (lon, lat).

    projects the point onto the runway axis defined by threshold -> end,
    returns the signed along-track distance in meters. None if the surface
    has no threshold/end positions.
    """
    if surface.threshold_position is None or surface.end_position is None:
        return None
    try:
        t_geo = wkt_to_geojson(surface.threshold_position)
        e_geo = wkt_to_geojson(surface.end_position)
        t = t_geo.get("coordinates") if t_geo else None
        e = e_geo.get("coordinates") if e_geo else None
    except Exception:
        return None
    if not t or not e:
        return None

    # runway heading from threshold to end
    rwy_bearing = bearing_between(t[0], t[1], e[0], e[1])
    # bearing and distance from threshold to the point
    pt_bearing = bearing_between(t[0], t[1], lon, lat)
    pt_distance = distance_between(t[0], t[1], lon, lat)
    # along-track component
    delta = math.radians(pt_bearing - rwy_bearing)
    return pt_distance * math.cos(delta)
