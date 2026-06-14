"""drone media - mission matching, grouped listing, manual assignment, ingest hand-off."""

import logging
import math
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.constants import MEDIA_MATCH_AREA_BUFFER_M
from app.core.enums import MediaFileStatus
from app.core.exceptions import NotFoundError
from app.core.geometry import point_lonlatalt
from app.models.drone_media_file import DroneMediaFile
from app.models.flight_plan import FlightPlan
from app.models.mission import Mission
from app.models.wayline_dispatch import WaylineDispatch
from app.schemas.drone_media import DroneMediaListResponse, MissionMediaGroup
from app.schemas.field_link import DroneMediaFileResponse
from app.utils.geo import distance_between

logger = logging.getLogger(__name__)

# equirectangular meters-per-degree at the equator, for bbox buffer padding
_METERS_PER_DEG_LAT = 111_320.0


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
