"""LHA CRUD + parent-locked sequence reorder and PAPI invariant."""

from uuid import UUID

from sqlalchemy import cast
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from app.core.constants import DEFAULT_LHA_TOLERANCE_DEG
from app.core.exceptions import DomainError, NotFoundError
from app.models.agl import AGL, LHA
from app.models.airport import AirfieldSurface, Airport
from app.models.inspection import InspectionConfiguration
from app.schemas.infrastructure import LHABulkGenerateRequest, LHACreate, LHAUpdate
from app.services.airport.altitude import (
    _normalize_position_altitude,
    _position_unchanged,
    _stored_point_coords,
)
from app.services.elevation_provider import create_elevation_provider
from app.services.geometry_converter import apply_schema_update, schema_to_model_data


# LHAs
def list_lhas(db: Session, airport_id: UUID, surface_id: UUID, agl_id: UUID) -> list[LHA]:
    """list LHAs for AGL, validates surface belongs to airport."""
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

    return db.query(LHA).filter(LHA.agl_id == agl_id).all()


# PAPI is defined to have exactly 4 lights; the chr(64 + seq) / chr(96 + seq)
# sentinels also stop producing letters past sequence_number 26.
PAPI_MAX_LIGHTS = 4

# upper bound on non-PAPI edge-light units per AGL - bounds bulk-generate so a
# huge spacing/distance ratio cannot run away.
MAX_EDGE_LIGHT_UNITS = 200


def _apply_papi_invariant(db: Session, agl_id: UUID) -> None:
    """rewrite PAPI LHA unit_designators to chr(64 + sequence_number).

    PAPI LHAs treat unit_designator as a presentation of sequence_number
    (1=A, 2=B, 3=C, 4=D). this helper enforces that invariant after any
    write that could let the two columns drift. no-op for non-PAPI parents.

    caller must hold the parent AGL lock. uses a two-pass sentinel so the
    in-place rewrite cannot collide on the (agl_id, unit_designator) unique
    constraint mid-update: phase 1 parks each row at chr(96 + seq) which is
    distinct per row (sequence_number is dense + unique within an AGL),
    phase 2 sets the final uppercase letter.
    """
    agl = db.query(AGL).filter(AGL.id == agl_id).first()
    if not agl or agl.agl_type != "PAPI":
        return

    lhas = db.query(LHA).filter(LHA.agl_id == agl_id).all()
    # defensive: chr(64 + seq) only produces uppercase letters for seq in 1..26,
    # and PAPI is capped at 4 by domain. anything above means an upstream
    # validator was bypassed - fail loudly rather than write '{' / '}' / etc.
    for lha in lhas:
        if not 1 <= lha.sequence_number <= PAPI_MAX_LIGHTS:
            raise DomainError(
                f"PAPI sequence_number {lha.sequence_number} out of range 1..{PAPI_MAX_LIGHTS}",
                status_code=422,
            )

    # phase 1: lowercase sentinels dodge the unique constraint
    for lha in lhas:
        lha.unit_designator = chr(96 + lha.sequence_number)
    db.flush()

    # phase 2: final uppercase letter from sequence_number
    for lha in lhas:
        lha.unit_designator = chr(64 + lha.sequence_number)
    db.flush()


def _shift_lha_sequence(db: Session, agl_id: UUID, lha_id: UUID, target: int) -> None:
    """shift sibling LHAs by +/-1 to make room for lha_id at target sequence_number.

    must run inside the same transaction as the caller's mutation. uses a
    SELECT FOR UPDATE on the parent AGL row to serialise concurrent edits,
    and parks the moving LHA one above the current max as a positive sentinel
    so neither the unique constraint nor the > 0 check fires mid-shift.

    on PAPI parents, also relabels unit_designators after the shift so the
    letter (1=A, 2=B, 3=C, 4=D) tracks the new sequence.

    note on concurrency: end-to-end races aren't directly tested - SQLAlchemy
    fixtures don't model multi-session behaviour cleanly. the SELECT FOR UPDATE
    is the correctness invariant; if it ever gets removed or weakened, both
    create_lha and update_lha can race into the same target slot.
    """
    # lock parent AGL row so two simultaneous edits cannot both compute
    # the same shift window before either commits
    db.query(AGL).filter(AGL.id == agl_id).with_for_update().first()

    siblings = db.query(LHA).filter(LHA.agl_id == agl_id).all()
    n = len(siblings)
    moving = next((lha for lha in siblings if lha.id == lha_id), None)
    if moving is None:
        raise NotFoundError("lha not found")

    LHA.validate_sequence_target(target, n)

    current = moving.sequence_number
    if current == target:
        return

    # park moving row one above the current max so the +/-1 shift of siblings
    # cannot collide with it on the (agl_id, sequence_number) unique
    # constraint. the parent-row lock above guarantees no second writer is
    # touching this AGL, so max+1 is sufficient.
    sentinel = max(lha.sequence_number for lha in siblings) + 1
    moving.sequence_number = sentinel
    db.flush()

    # the per-row flushes below are intentional: the unique (agl_id,
    # sequence_number) constraint is non-deferrable, so PostgreSQL checks it
    # tuple-by-tuple during a multi-row UPDATE. iterating in topological order
    # (top-down for +1, bottom-up for -1) keeps each individual UPDATE clear of
    # the next still-occupied slot. N is bounded (PAPI=4, edge lights<=200), so
    # the round-trip cost is acceptable; making the constraint deferrable would
    # let us batch but is out of scope here.
    if target < current:
        # moving up the list: bump siblings in [target, current-1] by +1.
        # iterate top-down so the +1 update never collides with an existing row.
        affected = [
            lha
            for lha in siblings
            if lha.id != lha_id and target <= lha.sequence_number <= current - 1
        ]
        for lha in sorted(affected, key=lambda x: x.sequence_number, reverse=True):
            lha.sequence_number += 1
            db.flush()
    else:
        # moving down the list: bump siblings in [current+1, target] by -1.
        # iterate bottom-up.
        affected = [
            lha
            for lha in siblings
            if lha.id != lha_id and current + 1 <= lha.sequence_number <= target
        ]
        for lha in sorted(affected, key=lambda x: x.sequence_number):
            lha.sequence_number -= 1
            db.flush()

    moving.sequence_number = target
    db.flush()

    _apply_papi_invariant(db, agl_id)


def create_lha(
    db: Session, airport_id: UUID, surface_id: UUID, agl_id: UUID, schema: LHACreate
) -> LHA:
    """create LHA for AGL, validates surface belongs to airport."""
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

    # normalize position.z to ground elevation at LHA location. LHA placement
    # is the one call site that opts into the configured remote provider -
    # downstream PAPI geometry (vertical profile angle, horizontal range
    # standoff, glide-slope reference) depends on the per-point elevation.
    airport = db.query(Airport).filter(Airport.id == airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")
    if schema.position and schema.position.coordinates:
        _normalize_position_altitude(schema.position.coordinates, airport, db=db, allow_api=True)

    data = schema_to_model_data(schema)
    target = data.pop("sequence_number", None)

    # lens height is PAPI-only optics metadata - non-PAPI units never carry it
    if agl.agl_type != "PAPI":
        data["lens_height_msl_m"] = None
        data["lens_height_agl_m"] = None
    # lock parent AGL row before reading sibling sequence numbers so concurrent
    # creates can't both compute the same auto-assigned slot
    db.query(AGL).filter(AGL.id == agl_id).with_for_update().first()
    siblings = db.query(LHA).filter(LHA.agl_id == agl_id).all()
    next_max = max((lha.sequence_number for lha in siblings), default=0) + 1

    # PAPI has exactly 4 lights by domain; reject the 5th create up front so
    # _apply_papi_invariant never has to deal with seq > 4.
    if agl.agl_type == "PAPI" and len(siblings) >= PAPI_MAX_LIGHTS:
        raise DomainError(
            f"PAPI agl already has {PAPI_MAX_LIGHTS} lights (A-D); "
            "delete one before adding another",
            status_code=422,
        )

    if target is not None:
        LHA.validate_sequence_target(target, next_max)

    # PAPI: unit_designator is owned by the invariant (1=A..4=D), so what the
    # caller supplied can collide with an already-relabeled sibling. park the
    # new row at a per-row lowercase sentinel that won't clash with the
    # uppercase letters siblings currently hold; _apply_papi_invariant rewrites
    # to the canonical letter at the end.
    if agl.agl_type == "PAPI":
        sentinel_seq = target if target is not None else next_max
        data["unit_designator"] = chr(96 + sentinel_seq)

    if target is None or target == next_max:
        # insert directly at the next slot - no shift needed
        lha = LHA(agl_id=agl_id, sequence_number=next_max, **data)
        db.add(lha)
    else:
        # park new row one above the current max while we shift siblings up,
        # then drop it into target. positive sentinel keeps both the > 0 check
        # and the unique (agl_id, sequence_number) constraint satisfied. the
        # parent-row lock above guarantees no concurrent writer, so max+1 is
        # sufficient (no padding needed).
        sentinel = next_max + 1
        lha = LHA(agl_id=agl_id, sequence_number=sentinel, **data)
        db.add(lha)
        db.flush()
        # iterate top-down so each +1 update lands in an empty slot - the
        # unique constraint is non-deferrable so we can't batch this.
        for sib in sorted(
            (s for s in siblings if s.sequence_number >= target),
            key=lambda s: s.sequence_number,
            reverse=True,
        ):
            sib.sequence_number += 1
            db.flush()
        lha.sequence_number = target

    _apply_papi_invariant(db, agl_id)

    db.flush()
    db.refresh(lha)

    return lha


def update_lha(
    db: Session, airport_id: UUID, surface_id: UUID, agl_id: UUID, lha_id: UUID, schema: LHAUpdate
) -> LHA:
    """update LHA, validates surface belongs to airport and LHA belongs to AGL."""
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

    lha = db.query(LHA).filter(LHA.id == lha_id, LHA.agl_id == agl_id).first()
    if not lha:
        raise NotFoundError("lha not found")

    # normalize position.z to ground unless coordinator explicitly preserves
    # altitude. LHA opts into the configured remote provider (allow_api=True);
    # obstacle / AGL update paths leave it default (DEM-or-flat). identity
    # round-trips (same lat/lon at 7 dp) preserve the stored z and skip the
    # provider entirely.
    airport = db.query(Airport).filter(Airport.id == airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")
    if schema.position and schema.position.coordinates and not schema.preserve_altitude:
        stored_coords = _stored_point_coords(lha.position)
        if _position_unchanged(schema.position.coordinates, stored_coords):
            if (
                stored_coords is not None
                and len(stored_coords) >= 3
                and len(schema.position.coordinates) >= 3
            ):
                schema.position.coordinates[2] = stored_coords[2]
        else:
            _normalize_position_altitude(
                schema.position.coordinates, airport, db=db, allow_api=True
            )

    sent_fields = schema.model_fields_set
    target_seq: int | None = None
    if "sequence_number" in sent_fields and schema.sequence_number is not None:
        target_seq = int(schema.sequence_number)

    # PAPI: unit_designator is a presentation of sequence_number, so translate
    # an incoming letter into a seq target and route through the shift logic.
    is_papi = agl.agl_type == "PAPI"
    if is_papi and "unit_designator" in sent_fields and schema.unit_designator is not None:
        letter = schema.unit_designator.strip().upper()
        if letter not in {"A", "B", "C", "D"}:
            raise DomainError(
                "PAPI unit_designator must be one of A, B, C, D",
                status_code=422,
            )
        letter_seq = ord(letter) - 64
        if target_seq is not None and target_seq != letter_seq:
            raise DomainError(
                "conflicting sequence_number and unit_designator on PAPI LHA",
                status_code=422,
            )
        target_seq = letter_seq

    # apply non-sequence fields first - the sequence shift owns its own writes.
    # PAPI letter is derived from sequence_number, so it goes through the same
    # shift path and must not be written directly here.
    skip = {"sequence_number"}
    if is_papi:
        skip.add("unit_designator")
    apply_schema_update(lha, schema, skip=skip)

    # lens height is PAPI-only optics metadata - keep it null on non-PAPI units
    if not is_papi:
        lha.lens_height_msl_m = None
        lha.lens_height_agl_m = None

    if target_seq is not None:
        _shift_lha_sequence(db, agl_id, lha.id, target_seq)

    db.flush()
    db.refresh(lha)

    return lha


def delete_lha(db: Session, airport_id: UUID, surface_id: UUID, agl_id: UUID, lha_id: UUID):
    """delete LHA, renumber remaining LHAs, and clean up inspection config refs."""
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

    # lock parent AGL row so two concurrent deletes (or a delete racing a
    # create) cannot both compute their gap-close shift on the same range
    # and violate the (agl_id, sequence_number) unique constraint.
    db.query(AGL).filter(AGL.id == agl_id).with_for_update().first()

    lha = db.query(LHA).filter(LHA.id == lha_id, LHA.agl_id == agl_id).first()
    if not lha:
        raise NotFoundError("lha not found")

    deleted_id_str = str(lha.id)
    deleted_seq = lha.sequence_number
    db.delete(lha)
    db.flush()

    # close the gap left by the deleted row so sequence_number stays dense.
    # bump-down in ascending order to avoid colliding with existing rows;
    # the unique constraint is non-deferrable so we can't batch this.
    remaining = (
        db.query(LHA)
        .filter(LHA.agl_id == agl_id, LHA.sequence_number > deleted_seq)
        .order_by(LHA.sequence_number.asc())
        .all()
    )
    for sib in remaining:
        sib.sequence_number -= 1
        db.flush()

    _apply_papi_invariant(db, agl_id)

    # drop deleted id from any inspection configs that reference it.
    # scoped by jsonb containment so we only touch configs that actually hold this id -
    # avoids the full-table scan we'd get from loading every config with non-null lha_ids.
    configs = (
        db.query(InspectionConfiguration)
        .filter(InspectionConfiguration.lha_ids.op("@>")(cast([deleted_id_str], JSONB)))
        .all()
    )
    for cfg in configs:
        ids = cfg.lha_ids or []
        cfg.lha_ids = [i for i in ids if i != deleted_id_str]

    db.flush()


def bulk_generate_lhas(
    db: Session,
    airport_id: UUID,
    surface_id: UUID,
    agl_id: UUID,
    schema: LHABulkGenerateRequest,
) -> list[LHA]:
    """linearly interpolate LHAs between two points spaced by spacing_m meters."""
    from app.utils.geo import distance_between

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

    airport = db.query(Airport).filter(Airport.id == airport_id).first()
    if not airport:
        raise NotFoundError("airport not found")

    first = schema.first_position.coordinates
    last = schema.last_position.coordinates
    if len(first) < 3 or len(last) < 3:
        raise DomainError("positions must include lon, lat, and altitude", status_code=422)

    total_distance = distance_between(first[0], first[1], last[0], last[1])
    if total_distance <= 0:
        raise DomainError("first and last positions must differ", status_code=422)

    # lock parent AGL row so a concurrent create_lha cannot pick the same
    # next sequence_number while we're computing it from the sibling set
    db.query(AGL).filter(AGL.id == agl_id).with_for_update().first()

    # assign designators
    existing = db.query(LHA).filter(LHA.agl_id == agl_id).all()
    existing_count = len(existing)
    is_papi = agl.agl_type == "PAPI"

    if is_papi:
        used_designators = {lha.unit_designator for lha in existing}
        all_designators = ["A", "B", "C", "D"]
        available_designators = [d for d in all_designators if d not in used_designators]
        if not available_designators:
            raise DomainError(
                "all 4 designator slots (A-D) are occupied for this agl",
                status_code=422,
            )
    else:
        nums = [int(d) for lha in existing if (d := lha.unit_designator).isdigit()]
        next_num = max(nums, default=0) + 1
        available_designators = [str(i) for i in range(next_num, next_num + MAX_EDGE_LIGHT_UNITS)]

    # number of LHAs, bounded to avoid runaway generation, enforcing cumulative cap
    count = max(2, int(round(total_distance / schema.spacing_m)) + 1)
    remaining_slots = max(0, MAX_EDGE_LIGHT_UNITS - existing_count)
    if remaining_slots < 2:
        raise DomainError(
            f"agl already has {MAX_EDGE_LIGHT_UNITS} lha units - "
            "delete some before generating more",
            status_code=422,
        )
    if len(available_designators) < 2:
        raise DomainError(
            "fewer than 2 designator slots available - cannot bulk-generate",
            status_code=422,
        )
    count = min(count, remaining_slots, len(available_designators))

    # default angle: RUNWAY_EDGE_LIGHTS uses 0, PAPI stays null for coordinator fill-in
    is_edge_lights = agl.agl_type == "RUNWAY_EDGE_LIGHTS"
    if schema.setting_angle is not None:
        setting_angle = schema.setting_angle
    elif is_edge_lights:
        setting_angle = 0.0
    else:
        setting_angle = None

    # reuse one provider across the loop - DEM-backed providers open a
    # rasterio handle per instance, so creating one per iteration would
    # re-open the file up to 200 times in a single request. LHA bulk-generate
    # is the LHA-placement call site so it opts into allow_api=True - the
    # configured remote provider runs per generated unit when terrain is FLAT.
    provider = create_elevation_provider(airport, allow_api=True, db=db)
    try:
        created: list[LHA] = []
        next_seq = max((lha.sequence_number for lha in existing), default=0) + 1
        for i in range(count):
            # count is bounded to >= 2 above, so (count - 1) is always positive
            t = i / (count - 1)
            lon = first[0] + (last[0] - first[0]) * t
            lat = first[1] + (last[1] - first[1]) * t
            ground = provider.get_elevation(lat, lon)

            wkt = f"POINT Z ({lon} {lat} {ground})"
            designator = available_designators[i]
            lha = LHA(
                agl_id=agl_id,
                unit_designator=designator,
                setting_angle=setting_angle,
                lamp_type=schema.lamp_type,
                position=wkt,
                tolerance=(
                    schema.tolerance if schema.tolerance is not None else DEFAULT_LHA_TOLERANCE_DEG
                ),
                sequence_number=next_seq + i,
            )
            db.add(lha)
            created.append(lha)

        db.flush()
        _apply_papi_invariant(db, agl_id)

        # services flush, routes commit - the route attaches the audit row and commits
        db.flush()
        for lha in created:
            db.refresh(lha)

        return created
    finally:
        if hasattr(provider, "close"):
            provider.close()
