"""measurement crud + reference snapshot - the route-facing entrypoints (flush only)."""

import logging
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.constants import DEFAULT_GLIDE_SLOPE_ANGLE_TOLERANCE_DEG
from app.core.enums import MeasurementStatus
from app.core.exceptions import DomainError, NotFoundError
from app.core.geometry import point_lonlatalt
from app.models.agl import LHA
from app.models.drone_media_file import DroneMediaFile
from app.models.inspection import Inspection
from app.models.measurement import PAPI_LIGHT_NAMES, Measurement
from app.models.mission import Mission
from app.schemas.measurement import (
    LightBox as LightBoxSchema,
)
from app.schemas.measurement import (
    MeasurementListItemResponse,
)
from app.services import object_storage

logger = logging.getLogger(__name__)


# reference-point snapshot


def _light_name_for(designator: str | None, index: int) -> str:
    """map an LHA designator (A-D) to a PAPI light name, else fall back to position."""
    if designator and designator.upper() in ("A", "B", "C", "D"):
        return f"PAPI_{designator.upper()}"
    if index < len(PAPI_LIGHT_NAMES):
        return PAPI_LIGHT_NAMES[index]
    return f"PAPI_{index + 1}"


def _snapshot_reference_points(
    db: Session, inspection: Inspection
) -> tuple[list[dict], float | None, float | None, float | None]:
    """snapshot the inspection's target LHAs into reference points + runway heading.

    the snapshot is the engine's free reference set - lha position, setting angle and
    tolerance captured at run time, plus the parent runway heading for the horizontal
    angle calc and the configured AGL glide slope + its tolerance for the glidepath
    verdict. an inspection with no resolvable LHAs yields an empty set.
    """
    lha_ids = inspection.lha_ids or []
    if not lha_ids:
        return [], None, None, None

    lhas = db.query(LHA).filter(LHA.id.in_(lha_ids)).all()
    lhas.sort(key=lambda lha: lha.sequence_number)

    runway_heading: float | None = None
    glide_slope_angle: float | None = None
    glide_slope_angle_tolerance: float | None = None
    points: list[dict] = []
    for index, lha in enumerate(lhas):
        try:
            lon, lat, alt = point_lonlatalt(lha.position)
        except ValueError:
            logger.warning("lha %s has no usable position - skipped in snapshot", lha.id)
            continue
        if runway_heading is None and lha.agl and lha.agl.surface:
            runway_heading = lha.agl.surface.heading
        if glide_slope_angle is None and lha.agl and lha.agl.glide_slope_angle is not None:
            glide_slope_angle = lha.agl.glide_slope_angle
        if (
            glide_slope_angle_tolerance is None
            and lha.agl
            and lha.agl.glide_slope_angle_tolerance is not None
        ):
            glide_slope_angle_tolerance = lha.agl.glide_slope_angle_tolerance
        points.append(
            {
                "light_name": _light_name_for(lha.unit_designator, index),
                "latitude": lat,
                "longitude": lon,
                "elevation": alt,
                "lha_id": str(lha.id),
                "unit_designator": lha.unit_designator,
                "setting_angle": lha.setting_angle,
                "tolerance": lha.tolerance,
            }
        )
    return points, runway_heading, glide_slope_angle, glide_slope_angle_tolerance


def _inspection_media_keys(db: Session, inspection_id: UUID) -> list[str]:
    """ordered input video object keys for one inspection (1..N by order_index)."""
    rows = (
        db.query(DroneMediaFile)
        .filter(DroneMediaFile.inspection_id == inspection_id)
        .order_by(DroneMediaFile.order_index, DroneMediaFile.received_at, DroneMediaFile.id)
        .all()
    )
    return [row.object_key for row in rows]


# route-facing entrypoints (flush only; the route commits)


def create_measurement(db: Session, inspection_id: UUID) -> Measurement:
    """start a measurement run for an inspection - snapshots refs, queues first frame.

    raises 404 when the inspection is missing and 422 when it has no uploaded media.
    the route enqueues the first-frame task and commits.
    """
    inspection = db.query(Inspection).filter(Inspection.id == inspection_id).first()
    if inspection is None:
        raise NotFoundError("inspection not found")

    media_keys = _inspection_media_keys(db, inspection_id)
    if not media_keys:
        raise DomainError("inspection has no uploaded media to measure", status_code=422)

    reference_points, runway_heading, glide_slope_angle, agl_tolerance = _snapshot_reference_points(
        db, inspection
    )

    # tolerance falls back to the default so an unset AGL still yields a verdict band,
    # but only when there is a configured glide slope to band around - no angle, no tolerance.
    if glide_slope_angle is None:
        glide_slope_angle_tolerance = None
    else:
        glide_slope_angle_tolerance = (
            agl_tolerance if agl_tolerance is not None else DEFAULT_GLIDE_SLOPE_ANGLE_TOLERANCE_DEG
        )

    # measurement kickoff flips the parent mission VALIDATED/EXPORTED -> MEASURED
    # (idempotent for a multi-inspection mission)
    if inspection.mission is not None:
        inspection.mission.mark_measured()

    measurement = Measurement(
        inspection_id=inspection_id,
        status=MeasurementStatus.QUEUED.value,
        runway_heading=runway_heading,
        glide_slope_angle=glide_slope_angle,
        glide_slope_angle_tolerance=glide_slope_angle_tolerance,
        reference_points=reference_points,
        media_object_keys=media_keys,
    )
    db.add(measurement)
    db.flush()
    db.refresh(measurement)
    return measurement


def get_measurement(db: Session, measurement_id: UUID) -> Measurement:
    """load one measurement row (404 when missing)."""
    measurement = db.query(Measurement).filter(Measurement.id == measurement_id).first()
    if measurement is None:
        raise NotFoundError("measurement not found")
    return measurement


def _list_item(
    measurement: Measurement, inspection: Inspection, mission: Mission
) -> MeasurementListItemResponse:
    """map a run + its mission/inspection context to one list row.

    PASS/FAIL counts and has_results derive from the run's summaries + object_key so
    the row carries everything the list page routes on.
    """
    summaries = measurement.summaries or []
    pass_count = sum(1 for s in summaries if s.get("passed") is True)
    fail_count = sum(1 for s in summaries if s.get("passed") is False)
    has_results = (
        measurement.status == MeasurementStatus.DONE and measurement.object_key is not None
    )
    return MeasurementListItemResponse(
        id=measurement.id,
        inspection_id=measurement.inspection_id,
        mission_id=mission.id,
        mission_name=mission.name,
        inspection_method=inspection.method,
        inspection_sequence_order=inspection.sequence_order,
        status=measurement.status,
        label=measurement.label,
        created_at=measurement.created_at,
        has_results=has_results,
        pass_count=pass_count,
        fail_count=fail_count,
        error_message=measurement.error_message,
    )


def list_airport_measurements(db: Session, airport_id: UUID) -> list[MeasurementListItemResponse]:
    """every measurement across an airport's missions/inspections, newest first.

    the inspection set (joined to its mission for name + scoping) is fetched once and
    the measurements in one batched read off those ids - no per-row lookup. the caller
    (route) has already verified the user may access the airport.
    """
    rows = (
        db.query(Inspection, Mission)
        .join(Mission, Inspection.mission_id == Mission.id)
        .filter(Mission.airport_id == airport_id)
        .all()
    )
    context = {insp.id: (insp, mission) for insp, mission in rows}
    ids = list(context.keys())
    if not ids:
        return []
    measurements = (
        db.query(Measurement)
        .filter(Measurement.inspection_id.in_(ids))
        .order_by(Measurement.created_at.desc(), Measurement.id)
        .all()
    )
    return [_list_item(m, *context[m.inspection_id]) for m in measurements]


def airport_id_for_inspection(db: Session, inspection_id: UUID):
    """resolve an inspection's airport for audit scoping (None when unresolvable)."""
    inspection = db.query(Inspection).filter(Inspection.id == inspection_id).first()
    if inspection is None or inspection.mission is None:
        return None
    return inspection.mission.airport_id


def get_preview(db: Session, measurement_id: UUID) -> tuple[Measurement, str | None]:
    """measurement plus a presigned GET url for its first-frame image (or None)."""
    measurement = get_measurement(db, measurement_id)
    url = None
    if measurement.first_frame_object_key:
        url = object_storage.presigned_get(measurement.first_frame_object_key)
    return measurement, url


def _boxes_from_request(boxes: list[LightBoxSchema]) -> list[dict]:
    """build stored light-box dicts from the operator's confirm-lights request."""
    return [{"light_name": b.light_name, "x": b.x, "y": b.y, "size": b.size} for b in boxes]


def confirm_lights(db: Session, measurement_id: UUID, boxes: list[LightBoxSchema]) -> Measurement:
    """persist confirmed boxes and move to PROCESSING ahead of the full engine run.

    takes the wire boxes off the request and stores them here so the route stays HTTP.
    409 unless the run is AWAITING_CONFIRM. the route enqueues the processing task and
    commits.
    """
    measurement = get_measurement(db, measurement_id)
    if measurement.status != MeasurementStatus.AWAITING_CONFIRM:
        raise DomainError(
            f"measurement is not awaiting confirmation (status {measurement.status})",
            status_code=409,
        )
    measurement.confirm_boxes(_boxes_from_request(boxes))
    measurement.transition_to(MeasurementStatus.PROCESSING)
    db.flush()
    db.refresh(measurement)
    return measurement


def update_measurement(db: Session, measurement_id: UUID, label: str | None) -> Measurement:
    """set or clear a measurement's free-text label (blank -> None). flush; route commits.

    404 when the measurement is missing. a blank/whitespace label clears it so the UI
    falls back to the inspection label.
    """
    measurement = get_measurement(db, measurement_id)
    measurement.label = (label or "").strip() or None
    db.flush()
    db.refresh(measurement)
    return measurement


def _measurement_object_keys(measurement: Measurement) -> list[str]:
    """every object-storage key one run owns - results blob, first frame, videos."""
    keys: list[str] = []
    if measurement.object_key:
        keys.append(measurement.object_key)
    if measurement.first_frame_object_key:
        keys.append(measurement.first_frame_object_key)
    keys.extend((measurement.annotated_video_keys or {}).values())
    return keys


def delete_measurement(db: Session, measurement_id: UUID) -> tuple[UUID, str | None, list[str]]:
    """delete one measurement row; return context for the audit + artifact cleanup.

    collects every object-storage key the run owns before dropping the row so the route
    can audit the delete, commit, then drop the artifacts post-commit (best-effort) -
    mirrors the drone-media delete pattern so a failed commit can't orphan a live
    reference. returns (inspection_id, label, object_keys); 404 when missing. flushes;
    the route commits.
    """
    measurement = get_measurement(db, measurement_id)
    object_keys = _measurement_object_keys(measurement)
    inspection_id = measurement.inspection_id
    label = measurement.label
    db.delete(measurement)
    db.flush()
    return inspection_id, label, object_keys
