"""drone media - mission matching, per-inspection upload, grouped listing, ingest hand-off."""

import logging
import math
import os
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.core.constants import MEDIA_MATCH_AREA_BUFFER_M
from app.core.enums import MediaFileStatus, MediaOrigin
from app.core.exceptions import DomainError, NotFoundError
from app.core.geometry import point_lonlatalt
from app.models.drone_media_file import DroneMediaFile
from app.models.flight_plan import FlightPlan
from app.models.inspection import Inspection
from app.models.mission import Mission
from app.models.wayline_dispatch import WaylineDispatch
from app.schemas.drone_media import (
    DroneMediaListResponse,
    InspectionMediaGroup,
    MissionInspectionMediaResponse,
    MissionMediaGroup,
)
from app.schemas.field_link import DroneMediaFileResponse
from app.services import object_storage
from app.utils.geo import distance_between

logger = logging.getLogger(__name__)

# equirectangular meters-per-degree at the equator, for bbox buffer padding
_METERS_PER_DEG_LAT = 111_320.0

# object-key prefix for browser-uploaded manual media
_MANUAL_MEDIA_PREFIX = "drone-media/manual"


def _mission_area_contains(db: Session, mission_id: UUID, lon: float, lat: float) -> bool:
    """true when (lon, lat) falls inside the mission's flight-plan bbox + buffer.

    the bbox spans every persisted waypoint position; the buffer absorbs gps
    error and small pilot deviations. a mission without a plan never contains.
    """
    fp = db.query(FlightPlan).filter(FlightPlan.mission_id == mission_id).first()
    if fp is None:
        return False

    lons, lats = [], []
    for wp in fp.waypoints:
        try:
            wp_lon, wp_lat, _ = point_lonlatalt(wp.position)
        except ValueError:
            continue
        lons.append(wp_lon)
        lats.append(wp_lat)
    if not lons:
        return False

    lat_pad = MEDIA_MATCH_AREA_BUFFER_M / _METERS_PER_DEG_LAT
    mid_lat = (min(lats) + max(lats)) / 2
    # clamp cos away from zero so polar-degenerate input cannot divide by ~0
    cos_lat = max(math.cos(math.radians(mid_lat)), 0.01)
    lon_pad = MEDIA_MATCH_AREA_BUFFER_M / (_METERS_PER_DEG_LAT * cos_lat)

    return (min(lons) - lon_pad <= lon <= max(lons) + lon_pad) and (
        min(lats) - lat_pad <= lat <= max(lats) + lat_pad
    )


def _nearest_inspection_distance_m(db: Session, mission_id: UUID, lon: float, lat: float) -> float:
    """distance (m) from the capture to the mission's nearest inspection target.

    targets are the LHA centroids of each inspection's template AGLs; missions
    with no resolvable target rank last (inf).
    """
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if mission is None:
        return math.inf

    best = math.inf
    for inspection in mission.inspections:
        targets = inspection.template.targets if inspection.template else []
        for agl in targets:
            try:
                center_lon, center_lat, _ = agl.calculate_lha_center_point()
            except ValueError:
                continue
            best = min(best, distance_between(lon, lat, center_lon, center_lat))
    return best


def _resolve_mission(db: Session, media: DroneMediaFile) -> UUID | None:
    """pick the mission a capture belongs to - None lands in the unassigned bucket.

    candidates are missions dispatched before the device-reported capture time
    (no flight-progress events are persisted yet, so the window has no close),
    with device_sn equality enforced when both sides carry one, narrowed by
    gps containment in the mission's flight-plan area. multiple hits break the
    tie on nearest inspection target.
    """
    if media.captured_at is None or not media.capture_position:
        return None
    lon, lat, _ = point_lonlatalt(media.capture_position)

    dispatches = (
        db.query(WaylineDispatch).filter(WaylineDispatch.dispatched_at <= media.captured_at).all()
    )

    candidates = []
    for dispatch in dispatches:
        if dispatch.device_sn and media.device_sn and dispatch.device_sn != media.device_sn:
            continue
        if _mission_area_contains(db, dispatch.mission_id, lon, lat):
            candidates.append(dispatch.mission_id)

    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    return min(candidates, key=lambda mid: _nearest_inspection_distance_m(db, mid, lon, lat))


def match_media_file(db: Session, media: DroneMediaFile) -> DroneMediaFile:
    """match one RECEIVED file to a dispatched mission - MATCHED or UNASSIGNED.

    failure-safe: any matching error leaves the row RECEIVED so the next
    sweep retries; rows already past RECEIVED are returned untouched.
    """
    if media.status != MediaFileStatus.RECEIVED.value:
        return media

    try:
        mission_id = _resolve_mission(db, media)
    except Exception:
        logger.warning("media matching failed for %s - row stays RECEIVED", media.id, exc_info=True)
        return media

    if mission_id is None:
        media.mark_unassigned()
    else:
        media.assign_to_mission(mission_id)
    return media


def match_pending(db: Session) -> int:
    """sweep lingering RECEIVED rows through matching - returns rows that moved."""
    rows = (
        db.query(DroneMediaFile)
        .filter(DroneMediaFile.status == MediaFileStatus.RECEIVED.value)
        .all()
    )
    moved = 0
    for row in rows:
        match_media_file(db, row)
        if row.status != MediaFileStatus.RECEIVED.value:
            moved += 1
    if moved:
        db.flush()
    return moved


def list_drone_media(db: Session) -> DroneMediaListResponse:
    """mission-grouped media plus the unassigned bucket, INGESTED excluded.

    runs the pending sweep first so rows whose event-time matching failed get
    retried whenever the operator opens the dialog. files with no mission are
    bucketed as unassigned regardless of status (covers mission-delete SET NULL).
    """
    match_pending(db)

    rows = (
        db.query(DroneMediaFile)
        .filter(DroneMediaFile.status != MediaFileStatus.INGESTED.value)
        .order_by(DroneMediaFile.received_at, DroneMediaFile.id)
        .all()
    )

    by_mission: dict[UUID, list[DroneMediaFile]] = {}
    unassigned: list[DroneMediaFile] = []
    for row in rows:
        if row.mission_id is None:
            unassigned.append(row)
        else:
            by_mission.setdefault(row.mission_id, []).append(row)

    names = {}
    if by_mission:
        missions = db.query(Mission).filter(Mission.id.in_(by_mission.keys())).all()
        names = {m.id: m.name for m in missions}

    groups = [
        MissionMediaGroup(
            mission_id=mission_id,
            mission_name=names.get(mission_id, ""),
            files=[DroneMediaFileResponse.model_validate(f) for f in files],
        )
        for mission_id, files in by_mission.items()
    ]
    groups.sort(key=lambda g: g.mission_name)

    return DroneMediaListResponse(
        missions=groups,
        unassigned=[DroneMediaFileResponse.model_validate(f) for f in unassigned],
    )


def assign_media(
    db: Session, media_id: UUID, mission_id: UUID | None
) -> tuple[DroneMediaFile, Mission | None]:
    """manually move one file to a mission (MATCHED) or the unassigned bucket.

    returns (row, mission) so the route can scope the audit row; reassignment
    after ingest is blocked by the model (409). flushes; the route commits.
    """
    row = db.query(DroneMediaFile).filter(DroneMediaFile.id == media_id).first()
    if row is None:
        raise NotFoundError("drone media file not found")

    mission = None
    if mission_id is not None:
        mission = db.query(Mission).filter(Mission.id == mission_id).first()
        if mission is None:
            raise NotFoundError("mission not found")
        row.assign_to_mission(mission.id)
    else:
        row.mark_unassigned()

    db.flush()
    db.refresh(row)
    return row, mission


def confirm_ingest(db: Session, mission_id: UUID) -> tuple[Mission, int]:
    """mark a mission's media INGESTED - stub hand-off to the processing pipeline.

    idempotent: already-INGESTED rows no-op, so a repeat confirm returns 0.
    the actual pipeline integration replaces this stub later; flushes, the
    route commits.
    """
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if mission is None:
        raise NotFoundError("mission not found")

    rows = db.query(DroneMediaFile).filter(DroneMediaFile.mission_id == mission_id).all()
    ingested = sum(1 for row in rows if row.mark_ingested())
    db.flush()
    return mission, ingested


# per-inspection manual upload


def _safe_filename(name: str) -> str:
    """basename of an upload, stripped of path separators for a safe object key."""
    base = os.path.basename(name.replace("\\", "/")).strip()
    return base or "upload"


def _lock_mission(db: Session, mission_id: UUID) -> Mission:
    """load + row-lock a mission so its media ordering ops serialise (404 if missing)."""
    mission = db.query(Mission).filter(Mission.id == mission_id).with_for_update().first()
    if mission is None:
        raise NotFoundError("mission not found")
    return mission


def _require_inspection_in_mission(
    db: Session, inspection_id: UUID, mission_id: UUID
) -> Inspection:
    """load an inspection and assert it belongs to the mission (404 / 422)."""
    inspection = db.query(Inspection).filter(Inspection.id == inspection_id).first()
    if inspection is None:
        raise NotFoundError("inspection not found")
    if inspection.mission_id != mission_id:
        raise DomainError("inspection does not belong to the mission", status_code=422)
    return inspection


def _inspection_media(db: Session, inspection_id: UUID) -> list[DroneMediaFile]:
    """one inspection's media ordered by order_index."""
    return (
        db.query(DroneMediaFile)
        .filter(DroneMediaFile.inspection_id == inspection_id)
        .order_by(DroneMediaFile.order_index, DroneMediaFile.received_at, DroneMediaFile.id)
        .all()
    )


def _renumber_inspection(
    db: Session, inspection_id: UUID, ordered_rows: list[DroneMediaFile]
) -> None:
    """write dense 1..N order_index over ordered_rows, all parented to inspection_id.

    mirrors the LHA sequence protocol: a sentinel pass parks every row strictly
    above N before the final 1..N write, so the non-deferrable
    (inspection_id, order_index) unique constraint can't fire mid-renumber
    regardless of flush order. inspection_id is written alongside order_index so
    a row moving in never sits in the (inspection set, order null) state the
    paired-null check forbids. callers hold the mission row lock.
    """
    n = len(ordered_rows)
    if n == 0:
        return

    # base strictly above both the current max and N, so neither pass can ever
    # target a value another row still holds
    current_max = max((row.order_index or 0) for row in ordered_rows)
    base = max(current_max, n) + 1
    for offset, row in enumerate(ordered_rows):
        row.inspection_id = inspection_id
        row.order_index = base + offset
    db.flush()

    for position, row in enumerate(ordered_rows, start=1):
        row.order_index = position
    db.flush()


def create_upload_url(filename: str, content_type: str | None = None) -> tuple[str, str]:
    """presigned PUT target + object key for a browser upload - no row created yet.

    complete_upload records the row once the browser finishes the direct PUT.
    """
    object_key = f"{_MANUAL_MEDIA_PREFIX}/{uuid4()}/{_safe_filename(filename)}"
    upload_url = object_storage.presigned_put(object_key, content_type=content_type)
    return object_key, upload_url


def complete_upload(
    db: Session,
    mission_id: UUID,
    inspection_id: UUID | None,
    object_key: str,
    filename: str,
    size_bytes: int,
) -> DroneMediaFile:
    """record a finished manual upload, appended at the inspection's next order slot.

    inspection_id None leaves the row in the mission-level unassigned bucket.
    flushes; the route commits.
    """
    _lock_mission(db, mission_id)

    order_index = None
    if inspection_id is not None:
        _require_inspection_in_mission(db, inspection_id, mission_id)
        existing = _inspection_media(db, inspection_id)
        order_index = max((row.order_index or 0) for row in existing) + 1 if existing else 1

    row = DroneMediaFile(
        object_key=object_key,
        filename=filename,
        size_bytes=size_bytes,
        origin=MediaOrigin.MANUAL.value,
        mission_id=mission_id,
        inspection_id=inspection_id,
        order_index=order_index,
        status=MediaFileStatus.MATCHED.value,
    )
    db.add(row)
    db.flush()
    db.refresh(row)
    return row


def list_mission_media_by_inspection(
    db: Session, mission_id: UUID
) -> MissionInspectionMediaResponse:
    """mission media grouped by inspection (ordered) plus the unassigned bucket.

    INGESTED rows are excluded; a null inspection_id buckets as unassigned
    (covers inspection-delete SET NULL and not-yet-attached manual rows).
    """
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    if mission is None:
        raise NotFoundError("mission not found")

    rows = (
        db.query(DroneMediaFile)
        .filter(
            DroneMediaFile.mission_id == mission_id,
            DroneMediaFile.status != MediaFileStatus.INGESTED.value,
        )
        .all()
    )

    by_inspection: dict[UUID, list[DroneMediaFile]] = {}
    unassigned: list[DroneMediaFile] = []
    for row in rows:
        if row.inspection_id is None:
            unassigned.append(row)
        else:
            by_inspection.setdefault(row.inspection_id, []).append(row)

    groups = []
    for inspection in sorted(mission.inspections, key=lambda i: i.sequence_order):
        files = sorted(by_inspection.get(inspection.id, []), key=lambda r: r.order_index or 0)
        groups.append(
            InspectionMediaGroup(
                inspection_id=inspection.id,
                method=inspection.method,
                sequence_order=inspection.sequence_order,
                files=[DroneMediaFileResponse.model_validate(f) for f in files],
            )
        )

    unassigned.sort(key=lambda r: (r.received_at, str(r.id)))
    return MissionInspectionMediaResponse(
        mission_id=mission.id,
        mission_name=mission.name,
        inspections=groups,
        unassigned=[DroneMediaFileResponse.model_validate(f) for f in unassigned],
    )


def move_media(
    db: Session, media_id: UUID, inspection_id: UUID | None, order_index: int | None = None
) -> tuple[DroneMediaFile, Mission]:
    """move one media file to another inspection / position, re-densifying both sides.

    inspection_id None detaches the file to the mission-level unassigned bucket.
    validates the target inspection belongs to the file's mission (422) and is
    blocked once the file is INGESTED (409). returns (row, mission) for the
    audit row; flushes, the route commits.
    """
    row = db.query(DroneMediaFile).filter(DroneMediaFile.id == media_id).first()
    if row is None:
        raise NotFoundError("drone media file not found")
    row._block_after_ingest()
    if row.mission_id is None:
        raise DomainError("media file is not assigned to a mission", status_code=422)

    mission = _lock_mission(db, row.mission_id)
    if inspection_id is not None:
        _require_inspection_in_mission(db, inspection_id, row.mission_id)

    source_id = row.inspection_id

    # detach so the source/dest renumbers can't collide with the moving row
    row.inspection_id = None
    row.order_index = None
    db.flush()

    if source_id is not None and source_id != inspection_id:
        _renumber_inspection(db, source_id, _inspection_media(db, source_id))

    if inspection_id is not None:
        dest = _inspection_media(db, inspection_id)
        n = len(dest) + 1
        position = n if order_index is None else order_index
        DroneMediaFile.validate_order_target(position, n)
        dest.insert(position - 1, row)
        _renumber_inspection(db, inspection_id, dest)

    db.flush()
    db.refresh(row)
    return row, mission


def delete_media(db: Session, media_id: UUID) -> tuple[Mission | None, str, str | None]:
    """delete one manual upload, re-densifying its inspection.

    only MANUAL-origin rows are deletable (422 otherwise) and a row is blocked
    once INGESTED (409). the source inspection's order is renumbered 1..N after
    the row is removed. returns (mission, object_key, entity_name) for the audit
    row + post-commit object cleanup; flushes, the route commits.
    """
    row = db.query(DroneMediaFile).filter(DroneMediaFile.id == media_id).first()
    if row is None:
        raise NotFoundError("drone media file not found")
    if row.origin != MediaOrigin.MANUAL.value:
        raise DomainError("only manual uploads can be deleted", status_code=422)
    row._block_after_ingest()

    mission = _lock_mission(db, row.mission_id) if row.mission_id is not None else None
    source_id = row.inspection_id
    object_key = row.object_key
    entity_name = row.filename or row.object_key

    db.delete(row)
    db.flush()

    if source_id is not None:
        _renumber_inspection(db, source_id, _inspection_media(db, source_id))
        db.flush()

    return mission, object_key, entity_name


def reorder_inspection_media(
    db: Session, inspection_id: UUID, ordered_ids: list[UUID]
) -> tuple[Mission, InspectionMediaGroup]:
    """renumber an inspection's media 1..N to match ordered_ids.

    ordered_ids must be a permutation of the inspection's current media (422
    otherwise). returns (mission, group) for the audit row + response; flushes,
    the route commits.
    """
    inspection = db.query(Inspection).filter(Inspection.id == inspection_id).first()
    if inspection is None:
        raise NotFoundError("inspection not found")

    mission = _lock_mission(db, inspection.mission_id)

    rows = _inspection_media(db, inspection_id)
    by_id = {row.id: row for row in rows}
    if len(ordered_ids) != len(rows) or set(ordered_ids) != set(by_id):
        raise DomainError(
            "ordered_ids must be a permutation of the inspection's media",
            status_code=422,
        )

    ordered = [by_id[media_id] for media_id in ordered_ids]
    _renumber_inspection(db, inspection_id, ordered)
    db.flush()

    group = InspectionMediaGroup(
        inspection_id=inspection.id,
        method=inspection.method,
        sequence_order=inspection.sequence_order,
        files=[DroneMediaFileResponse.model_validate(row) for row in ordered],
    )
    return mission, group
