"""measurement orchestration - create, first-frame detect, confirm, full processing.

ports-and-adapters: this service depends on the ``MeasurementRepository`` port, not
the orm. it stays import-safe on a backend pinned to requirements.txt only - the
opencv engine and celery are imported lazily inside the engine/enqueue seams so
``app.main`` boots without the worker deps. reference points are snapshotted from the
inspection's target LHAs at create time (an audit record, not a live join).
"""

import gzip
import json
import logging
import os
import tempfile
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.enums import MeasurementStatus
from app.core.exceptions import DomainError, NotFoundError
from app.core.geometry import point_lonlatalt
from app.domain.measurement.entities import (
    PAPI_LIGHT_NAMES,
    LightBox,
    Measurement,
    ReferencePoint,
)
from app.domain.measurement.repository import MeasurementRepository
from app.infra.measurement.sqlalchemy_repository import SqlAlchemyMeasurementRepository
from app.models.agl import LHA
from app.models.drone_media_file import DroneMediaFile
from app.models.inspection import Inspection
from app.schemas.measurement import (
    DronePathPoint,
    LightSeries,
    LightSeriesPoint,
    LightSummaryResponse,
    MeasurementListItemResponse,
    MeasurementResponse,
    MeasurementResultsResponse,
    ReferencePointResponse,
)
from app.schemas.measurement import (
    LightBox as LightBoxSchema,
)
from app.services import object_storage

logger = logging.getLogger(__name__)

# object-storage key prefix for measurement artifacts
_MEASUREMENT_PREFIX = "measurements"


def _repo(db: Session) -> MeasurementRepository:
    """build the default sqlalchemy adapter for the port."""
    return SqlAlchemyMeasurementRepository(db)


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
) -> tuple[list[ReferencePoint], float | None]:
    """snapshot the inspection's target LHAs into reference points + runway heading.

    the snapshot is the engine's free reference set - lha position, setting angle and
    tolerance captured at run time, plus the parent runway heading for the horizontal
    angle calc. an inspection with no resolvable LHAs yields an empty set.
    """
    lha_ids = inspection.lha_ids or []
    if not lha_ids:
        return [], None

    lhas = db.query(LHA).filter(LHA.id.in_(lha_ids)).all()
    lhas.sort(key=lambda lha: lha.sequence_number)

    runway_heading: float | None = None
    points: list[ReferencePoint] = []
    for index, lha in enumerate(lhas):
        try:
            lon, lat, alt = point_lonlatalt(lha.position)
        except ValueError:
            logger.warning("lha %s has no usable position - skipped in snapshot", lha.id)
            continue
        if runway_heading is None and lha.agl and lha.agl.surface:
            runway_heading = lha.agl.surface.heading
        points.append(
            ReferencePoint(
                light_name=_light_name_for(lha.unit_designator, index),
                latitude=lat,
                longitude=lon,
                elevation=alt,
                lha_id=lha.id,
                unit_designator=lha.unit_designator,
                setting_angle=lha.setting_angle,
                tolerance=lha.tolerance,
            )
        )
    return points, runway_heading


def _inspection_media_keys(db: Session, inspection_id: UUID) -> list[str]:
    """ordered input video object keys for one inspection (1..N by order_index)."""
    rows = (
        db.query(DroneMediaFile)
        .filter(DroneMediaFile.inspection_id == inspection_id)
        .order_by(DroneMediaFile.order_index, DroneMediaFile.received_at, DroneMediaFile.id)
        .all()
    )
    return [row.object_key for row in rows]


# domain <-> wire mapping (keeps the route purely HTTP - no app.domain import)


def light_boxes_to_schema(boxes: list[LightBox]) -> list[LightBoxSchema]:
    """map domain light boxes to their wire form (response + preview share this)."""
    return [LightBoxSchema(light_name=b.light_name, x=b.x, y=b.y, size=b.size) for b in boxes]


def to_response(m: Measurement) -> MeasurementResponse:
    """map the domain aggregate to the wire response."""
    return MeasurementResponse(
        id=m.id,
        inspection_id=m.inspection_id,
        status=m.status.value,
        runway_heading=m.runway_heading,
        reference_points=[
            ReferencePointResponse(
                light_name=rp.light_name,
                latitude=rp.latitude,
                longitude=rp.longitude,
                elevation=rp.elevation,
                lha_id=rp.lha_id,
                unit_designator=rp.unit_designator,
                setting_angle=rp.setting_angle,
                tolerance=rp.tolerance,
            )
            for rp in m.reference_points
        ],
        light_boxes=light_boxes_to_schema(m.light_boxes),
        summaries=[
            LightSummaryResponse(
                light_name=s.light_name,
                setting_angle=s.setting_angle,
                tolerance=s.tolerance,
                measured_transition_angle=s.measured_transition_angle,
                passed=s.passed,
            )
            for s in m.summaries
        ],
        object_key=m.object_key,
        first_frame_object_key=m.first_frame_object_key,
        error_message=m.error_message,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


def _boxes_from_request(boxes: list[LightBoxSchema]) -> list[LightBox]:
    """build domain light boxes from the operator's confirm-lights request."""
    return [LightBox(light_name=b.light_name, x=b.x, y=b.y, size=b.size) for b in boxes]


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

    reference_points, runway_heading = _snapshot_reference_points(db, inspection)

    measurement = Measurement(
        inspection_id=inspection_id,
        status=MeasurementStatus.QUEUED,
        runway_heading=runway_heading,
        reference_points=reference_points,
        media_object_keys=media_keys,
    )
    return _repo(db).save(measurement)


def get_measurement(db: Session, measurement_id: UUID) -> Measurement:
    """load one measurement aggregate (404 when missing)."""
    measurement = _repo(db).get_by_id(measurement_id)
    if measurement is None:
        raise NotFoundError("measurement not found")
    return measurement


def _list_item(measurement: Measurement, inspection: Inspection) -> MeasurementListItemResponse:
    """map an aggregate + its inspection context to one list row.

    PASS/FAIL counts and has_results derive from the aggregate's summaries +
    object_key so the row carries everything the list page routes on.
    """
    pass_count = sum(1 for s in measurement.summaries if s.passed is True)
    fail_count = sum(1 for s in measurement.summaries if s.passed is False)
    has_results = (
        measurement.status == MeasurementStatus.DONE and measurement.object_key is not None
    )
    return MeasurementListItemResponse(
        id=measurement.id,
        inspection_id=measurement.inspection_id,
        inspection_method=inspection.method,
        inspection_sequence_order=inspection.sequence_order,
        status=measurement.status.value,
        created_at=measurement.created_at,
        has_results=has_results,
        pass_count=pass_count,
        fail_count=fail_count,
        error_message=measurement.error_message,
    )


def list_mission_measurements(db: Session, mission_id: UUID) -> list[MeasurementListItemResponse]:
    """every measurement across a mission's inspections, newest first.

    the inspection set is fetched once and the measurements in one batched read off
    those ids - no per-row inspection lookup. the caller (route) has already verified
    the mission exists and the user may access it.
    """
    inspections = db.query(Inspection).filter(Inspection.mission_id == mission_id).all()
    by_id = {insp.id: insp for insp in inspections}
    measurements = _repo(db).list_by_inspections(list(by_id.keys()))
    return [_list_item(m, by_id[m.inspection_id]) for m in measurements]


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


def confirm_lights(db: Session, measurement_id: UUID, boxes: list[LightBoxSchema]) -> Measurement:
    """persist confirmed boxes and move to PROCESSING ahead of the full engine run.

    takes the wire boxes off the request and builds the domain boxes here so the route
    never touches app.domain. 409 unless the run is AWAITING_CONFIRM. the route enqueues
    the processing task and commits.
    """
    measurement = get_measurement(db, measurement_id)
    if measurement.status != MeasurementStatus.AWAITING_CONFIRM:
        raise DomainError(
            f"measurement is not awaiting confirmation (status {measurement.status.value})",
            status_code=409,
        )
    measurement.confirm_boxes(_boxes_from_request(boxes))
    measurement.transition_to(MeasurementStatus.PROCESSING)
    return _repo(db).save(measurement)


# results assembly (read-only pivot of the gzipped per-frame blob)


def _reference_point_responses(measurement: Measurement) -> list[ReferencePointResponse]:
    """map the aggregate's snapshotted reference points onto the wire shape."""
    return [
        ReferencePointResponse(
            light_name=rp.light_name,
            latitude=rp.latitude,
            longitude=rp.longitude,
            elevation=rp.elevation,
            lha_id=rp.lha_id,
            unit_designator=rp.unit_designator,
            setting_angle=rp.setting_angle,
            tolerance=rp.tolerance,
        )
        for rp in measurement.reference_points
    ]


def _summary_responses(measurement: Measurement) -> list[LightSummaryResponse]:
    """map the aggregate's per-light PASS/FAIL rollups onto the wire shape."""
    return [
        LightSummaryResponse(
            light_name=s.light_name,
            setting_angle=s.setting_angle,
            tolerance=s.tolerance,
            measured_transition_angle=s.measured_transition_angle,
            passed=s.passed,
        )
        for s in measurement.summaries
    ]


def _chromaticity_from_rgb(rgb) -> tuple[float | None, float | None]:
    """normalized (r, g) chromaticity from an [r, g, b] triple - (None, None) if unusable."""
    if not rgb or len(rgb) < 3:
        return None, None
    try:
        r, g, b = float(rgb[0]), float(rgb[1]), float(rgb[2])
    except (TypeError, ValueError):
        return None, None
    total = r + g + b
    if total <= 0:
        return None, None
    return r / total, g / total


def _light_series(name: str, frames: list[dict], summary) -> LightSeries:
    """roll one light's per-frame readings out of the blob into an ordered series."""
    key = name.lower()
    points: list[LightSeriesPoint] = []
    for frame in frames:
        if f"{key}_angle" not in frame and f"{key}_status" not in frame:
            continue
        cx, cy = _chromaticity_from_rgb(frame.get(f"{key}_rgb"))
        points.append(
            LightSeriesPoint(
                frame_number=int(frame.get("frame_number", 0)),
                timestamp=float(frame.get("timestamp", 0.0)),
                status=frame.get(f"{key}_status"),
                angle=frame.get(f"{key}_angle"),
                horizontal_angle=frame.get(f"{key}_horizontal_angle"),
                intensity=frame.get(f"{key}_intensity"),
                area_pixels=frame.get(f"{key}_area_pixels"),
                chromaticity_x=cx,
                chromaticity_y=cy,
            )
        )
    # transition angles are injected identically onto every frame - read the first
    sample = next((f for f in frames if f.get(f"{key}_transition_angle_middle") is not None), None)
    return LightSeries(
        light_name=name,
        setting_angle=summary.setting_angle if summary else None,
        tolerance=summary.tolerance if summary else None,
        transition_angle_min=sample.get(f"{key}_transition_angle_min") if sample else None,
        transition_angle_middle=sample.get(f"{key}_transition_angle_middle") if sample else None,
        transition_angle_max=sample.get(f"{key}_transition_angle_max") if sample else None,
        passed=summary.passed if summary else None,
        points=points,
    )


def _drone_path(frames: list[dict]) -> list[DronePathPoint]:
    """ordered drone positions pulled from each frame's gps telemetry."""
    path: list[DronePathPoint] = []
    for frame in frames:
        lat = frame.get("drone_latitude")
        lon = frame.get("drone_longitude")
        if lat is None or lon is None:
            continue
        path.append(
            DronePathPoint(
                frame_number=int(frame.get("frame_number", 0)),
                timestamp=float(frame.get("timestamp", 0.0)),
                latitude=float(lat),
                longitude=float(lon),
                elevation=frame.get("drone_elevation_wgs84"),
            )
        )
    return path


def build_results_data(db: Session, measurement_id: UUID) -> MeasurementResultsResponse:
    """assemble the full results payload for the operator results page.

    reads the gzipped per-frame blob from object storage and pivots it into per-light
    timeseries + drone path, mints a presigned GET url per annotated video, and carries
    the snapshotted reference points + PASS/FAIL summaries. a run that is not DONE (no
    results blob yet) returns the metadata with ``has_results=False`` and empty series.
    """
    measurement = get_measurement(db, measurement_id)
    response = MeasurementResultsResponse(
        id=measurement.id,
        inspection_id=measurement.inspection_id,
        status=measurement.status.value,
        has_results=False,
        runway_heading=measurement.runway_heading,
        reference_points=_reference_point_responses(measurement),
        summaries=_summary_responses(measurement),
    )
    if measurement.status != MeasurementStatus.DONE or not measurement.object_key:
        return response

    raw = object_storage.get_object(measurement.object_key)
    frames = json.loads(gzip.decompress(raw).decode("utf-8"))
    summaries_by_name = {s.light_name: s for s in measurement.summaries}

    response.lights = [
        _light_series(name, frames, summaries_by_name.get(name)) for name in PAPI_LIGHT_NAMES
    ]
    response.drone_path = _drone_path(frames)
    response.video_urls = {
        name: object_storage.presigned_get(key)
        for name, key in (measurement.annotated_video_keys or {}).items()
    }
    response.has_results = True
    return response


# engine seams (lazy-import the opencv engine; monkeypatched in tests)


def extract_first_frame_and_detect(
    video_path: str, image_path: str, reference_points: list[dict]
) -> tuple[dict, dict]:
    """extract the first frame to image_path and detect PAPI candidates on it.

    returns (metadata, detected_positions). isolated so the heavy cv2 import only
    fires inside the worker and tests can stub it.
    """
    from app.services.video_processing.processor.detection import detect_lights
    from app.services.video_processing.processor.metadata import extract_first_frame

    metadata = extract_first_frame(video_path, image_path)
    detected = detect_lights(image_path, reference_points)
    return metadata, detected


def extract_gps_data(video_path: str) -> list:
    """extract per-frame GPS telemetry from a drone video (lazy engine import)."""
    from app.services.video_processing.gps import GPSExtractor

    return GPSExtractor().extract_gps_data(video_path)


def run_two_pass_processing(
    output_dir: str,
    video_path: str,
    session_id: str,
    light_positions: dict,
    gps_data: list,
    reference_points: dict,
    runway_heading: float,
) -> tuple[list, dict, str | None, str | None]:
    """run the two-pass engine - returns (measurements, papi_paths, enhanced, combined)."""
    from app.services.video_processing.generation.two_pass_processor import TwoPassProcessor

    processor = TwoPassProcessor(output_dir=output_dir)
    return processor.process_video_two_pass(
        video_path=video_path,
        session_id=session_id,
        light_positions=light_positions,
        real_gps_data=gps_data,
        reference_points=reference_points,
        runway_heading=runway_heading or 0.0,
    )


# enqueue seams (lazy-import the celery tasks; monkeypatched in tests)


def enqueue_first_frame(measurement_id: UUID) -> None:
    """hand a measurement to the worker for first-frame extraction + detection."""
    from app.workers.measurement_tasks import extract_first_frame_task

    extract_first_frame_task.delay(str(measurement_id))


def enqueue_processing(measurement_id: UUID) -> None:
    """hand a confirmed measurement to the worker for full processing."""
    from app.workers.measurement_tasks import process_measurement_task

    process_measurement_task.delay(str(measurement_id))


# worker runners (own their commits - these run off-request in the celery worker)


def _boxes_from_detection(detected: dict) -> list[LightBox]:
    """turn the engine's detected-positions dict into ordered domain light boxes."""
    boxes: list[LightBox] = []
    for name in PAPI_LIGHT_NAMES:
        pos = detected.get(name)
        if not pos:
            continue
        boxes.append(
            LightBox(
                light_name=name,
                x=float(pos.get("x", 50.0)),
                y=float(pos.get("y", 50.0)),
                size=float(pos.get("size", 8.0)),
            )
        )
    return boxes


def run_first_frame(db: Session, measurement_id: UUID) -> Measurement:
    """worker step: extract the first frame, detect lights, await operator confirm.

    drives QUEUED -> FIRST_FRAME -> AWAITING_CONFIRM, writing the first-frame image to
    object storage and pre-placing boxes from detection. any failure routes to ERROR.
    commits its own transitions so the polling endpoint sees progress.
    """
    repo = _repo(db)
    measurement = repo.get_by_id(measurement_id)
    if measurement is None:
        raise NotFoundError("measurement not found")

    measurement.transition_to(MeasurementStatus.FIRST_FRAME)
    repo.save(measurement)
    db.commit()

    try:
        if not measurement.media_object_keys:
            raise DomainError("measurement has no media to process", status_code=422)

        with tempfile.TemporaryDirectory() as workdir:
            video_path = os.path.join(workdir, "input_0.mp4")
            object_storage.download_file(measurement.media_object_keys[0], video_path)

            image_path = os.path.join(workdir, "first_frame.jpg")
            ref_payload = list(measurement.reference_point_payload().values())
            _metadata, detected = extract_first_frame_and_detect(
                video_path, image_path, ref_payload
            )

            frame_key = f"{_MEASUREMENT_PREFIX}/{measurement.id}/first_frame.jpg"
            object_storage.upload_file(frame_key, image_path, content_type="image/jpeg")

        measurement.first_frame_object_key = frame_key
        measurement.confirm_boxes(_boxes_from_detection(detected))
        measurement.transition_to(MeasurementStatus.AWAITING_CONFIRM)
        repo.save(measurement)
        db.commit()
        return measurement
    except Exception as exc:
        db.rollback()
        return _mark_failed(db, measurement_id, f"first-frame extraction failed: {exc}")


def _json_default(obj):
    """json encoder hook: coerce the engine's numpy scalars/arrays to native types.

    duck-typed on ``.tolist()`` so the service stays numpy-import-free; a numpy scalar
    in measurements_data would otherwise crash json.dumps and route the run to ERROR.
    anything without a numpy-style coercion re-raises so a real serialization bug surfaces.
    """
    to_list = getattr(obj, "tolist", None)
    if callable(to_list):
        return to_list()
    raise TypeError(f"object of type {type(obj).__name__} is not json serializable")


def _measured_transition_angles(measurements_data: list[dict]) -> dict[str, float | None]:
    """pull the last non-null per-light transition middle angle out of pass-1 data.

    coerces to plain float at this boundary: the engine may emit numpy scalars, which
    psycopg can't write to the summaries jsonb column.
    """
    measured: dict[str, float | None] = {}
    for name in PAPI_LIGHT_NAMES:
        key = f"{name.lower()}_transition_angle_middle"
        value: float | None = None
        for frame in measurements_data:
            if frame.get(key) is not None:
                value = float(frame[key])
        measured[name] = value
    return measured


def run_processing(db: Session, measurement_id: UUID) -> Measurement:
    """worker step: run the full engine and write results to object storage.

    drives PROCESSING -> DONE: downloads the input video, runs the two-pass engine off
    the confirmed boxes, uploads the gzipped per-frame results + annotated videos, and
    rolls up per-light PASS/FAIL. any failure routes to ERROR.
    """
    repo = _repo(db)
    measurement = repo.get_by_id(measurement_id)
    if measurement is None:
        raise NotFoundError("measurement not found")

    if measurement.status != MeasurementStatus.PROCESSING:
        # confirm_lights moves the aggregate to PROCESSING before enqueue; tolerate a
        # worker that picks the job up from AWAITING_CONFIRM (e.g. a manual re-run).
        if measurement.status == MeasurementStatus.AWAITING_CONFIRM:
            measurement.transition_to(MeasurementStatus.PROCESSING)
            repo.save(measurement)
            db.commit()
        else:
            raise DomainError(
                f"measurement is not ready for processing (status {measurement.status.value})",
                status_code=409,
            )

    try:
        if not measurement.media_object_keys:
            raise DomainError("measurement has no media to process", status_code=422)

        light_positions = {
            b.light_name: {"x": b.x, "y": b.y, "size": b.size} for b in measurement.light_boxes
        }
        ref_payload = measurement.reference_point_payload()

        with tempfile.TemporaryDirectory() as workdir:
            video_path = os.path.join(workdir, "input_0.mp4")
            object_storage.download_file(measurement.media_object_keys[0], video_path)

            gps_data = extract_gps_data(video_path)
            measurements_data, papi_paths, enhanced_path, combined_path = run_two_pass_processing(
                output_dir=workdir,
                video_path=video_path,
                session_id=str(measurement.id),
                light_positions=light_positions,
                gps_data=gps_data,
                reference_points=ref_payload,
                runway_heading=measurement.runway_heading or 0.0,
            )

            object_key = f"{_MEASUREMENT_PREFIX}/{measurement.id}/results.json.gz"
            object_storage.put_object(
                object_key,
                gzip.compress(json.dumps(measurements_data, default=_json_default).encode("utf-8")),
                content_type="application/gzip",
            )

            video_keys = _upload_annotated_videos(
                measurement.id, papi_paths or {}, enhanced_path, combined_path
            )

        measurement.object_key = object_key
        measurement.annotated_video_keys = video_keys
        measurement.with_summaries_from(_measured_transition_angles(measurements_data))
        measurement.transition_to(MeasurementStatus.DONE)
        repo.save(measurement)
        db.commit()
        return measurement
    except Exception as exc:
        db.rollback()
        return _mark_failed(db, measurement_id, f"processing failed: {exc}")


def _upload_annotated_videos(
    measurement_id: UUID,
    papi_paths: dict,
    enhanced_path: str | None,
    combined_path: str | None,
) -> dict[str, str]:
    """upload the engine's annotated videos and return name -> object_key."""
    keys: dict[str, str] = {}
    prefix = f"{_MEASUREMENT_PREFIX}/{measurement_id}"
    artifacts = dict(papi_paths)
    if enhanced_path:
        artifacts["enhanced"] = enhanced_path
    if combined_path:
        artifacts["all_papi_lights"] = combined_path
    for name, path in artifacts.items():
        if not path or not os.path.exists(path):
            continue
        key = f"{prefix}/{name}.mp4"
        object_storage.upload_file(key, path, content_type="video/mp4")
        keys[name] = key
    return keys


def _mark_failed(db: Session, measurement_id: UUID, message: str) -> Measurement:
    """transition a measurement to ERROR on a fresh session read and commit."""
    logger.warning("measurement %s failed: %s", measurement_id, message)
    repo = _repo(db)
    measurement = repo.get_by_id(measurement_id)
    if measurement is None:
        raise NotFoundError("measurement not found")
    if measurement.status != MeasurementStatus.ERROR:
        measurement.fail(message)
        repo.save(measurement)
        db.commit()
    return measurement
