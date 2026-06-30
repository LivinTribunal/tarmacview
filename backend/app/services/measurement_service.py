"""measurement orchestration - create, first-frame detect, confirm, full processing.

works the ``Measurement`` orm row directly. it stays import-safe on a backend pinned
to requirements.txt only - the opencv engine and celery are imported lazily inside the
engine/enqueue seams so ``app.main`` boots without the worker deps. reference points are
snapshotted from the inspection's target LHAs at create time (an audit record, not a
live join). the run's status machine and per-light scoring live on the orm model.
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
from app.models.agl import LHA
from app.models.drone_media_file import DroneMediaFile
from app.models.inspection import Inspection
from app.models.measurement import PAPI_LIGHT_NAMES, Measurement
from app.models.mission import Mission
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
) -> tuple[list[dict], float | None]:
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
    points: list[dict] = []
    for index, lha in enumerate(lhas):
        try:
            lon, lat, alt = point_lonlatalt(lha.position)
        except ValueError:
            logger.warning("lha %s has no usable position - skipped in snapshot", lha.id)
            continue
        if runway_heading is None and lha.agl and lha.agl.surface:
            runway_heading = lha.agl.surface.heading
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


# orm row <-> wire mapping (keeps the route purely HTTP)


def light_boxes_to_schema(boxes: list[dict]) -> list[LightBoxSchema]:
    """map stored light-box dicts to their wire form (response + preview share this)."""
    return [LightBoxSchema(**b) for b in (boxes or [])]


def _reference_point_responses(measurement: Measurement) -> list[ReferencePointResponse]:
    """map the run's snapshotted reference points onto the wire shape."""
    return [ReferencePointResponse(**d) for d in (measurement.reference_points or [])]


def _summary_responses(measurement: Measurement) -> list[LightSummaryResponse]:
    """map the run's per-light PASS/FAIL rollups onto the wire shape."""
    return [LightSummaryResponse(**s) for s in (measurement.summaries or [])]


def to_response(m: Measurement) -> MeasurementResponse:
    """map the orm row to the wire response."""
    return MeasurementResponse(
        id=m.id,
        inspection_id=m.inspection_id,
        status=m.status,
        label=m.label,
        runway_heading=m.runway_heading,
        reference_points=_reference_point_responses(m),
        light_boxes=light_boxes_to_schema(m.light_boxes),
        summaries=_summary_responses(m),
        object_key=m.object_key,
        first_frame_object_key=m.first_frame_object_key,
        error_message=m.error_message,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


def _boxes_from_request(boxes: list[LightBoxSchema]) -> list[dict]:
    """build stored light-box dicts from the operator's confirm-lights request."""
    return [{"light_name": b.light_name, "x": b.x, "y": b.y, "size": b.size} for b in boxes]


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

    # measurement kickoff flips the parent mission VALIDATED/EXPORTED -> MEASURED
    # (idempotent for a multi-inspection mission)
    if inspection.mission is not None:
        inspection.mission.mark_measured()

    measurement = Measurement(
        inspection_id=inspection_id,
        status=MeasurementStatus.QUEUED.value,
        runway_heading=runway_heading,
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


# results assembly (read-only pivot of the gzipped per-frame blob)


def _parse_rgb_floats(rgb) -> tuple[float, float, float] | None:
    """decode an engine rgb reading (dict or list) to (r, g, b) floats, or None.

    the engine emits each frame's rgb as a ``{"r", "g", "b"}`` dict; older blobs used an
    ``[r, g, b]`` list, so both shapes are accepted.
    """
    if not rgb:
        return None
    try:
        if isinstance(rgb, dict):
            return float(rgb["r"]), float(rgb["g"]), float(rgb["b"])
        return float(rgb[0]), float(rgb[1]), float(rgb[2])
    except (TypeError, ValueError, KeyError, IndexError):
        return None


def _chromaticity_from_rgb(rgb) -> tuple[float | None, float | None]:
    """normalized (r, g) chromaticity from an rgb reading - (None, None) if unusable."""
    parsed = _parse_rgb_floats(rgb)
    if parsed is None:
        return None, None
    r, g, b = parsed
    total = r + g + b
    if total <= 0:
        return None, None
    return r / total, g / total


def _rgb_channels(rgb) -> tuple[int | None, int | None, int | None]:
    """raw (r, g, b) ints 0-255 from an rgb reading - (None, None, None) if unusable.

    coerces to plain int so the numpy-free service never hands a numpy scalar to the schema.
    """
    parsed = _parse_rgb_floats(rgb)
    if parsed is None:
        return None, None, None
    return int(parsed[0]), int(parsed[1]), int(parsed[2])


def _light_series(name: str, frames: list[dict], summary) -> LightSeries:
    """roll one light's per-frame readings out of the blob into an ordered series."""
    key = name.lower()
    points: list[LightSeriesPoint] = []
    for frame in frames:
        if f"{key}_angle" not in frame and f"{key}_status" not in frame:
            continue
        rgb = frame.get(f"{key}_rgb")
        cx, cy = _chromaticity_from_rgb(rgb)
        red, green, blue = _rgb_channels(rgb)
        dist = frame.get(f"{key}_distance_ground")
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
                red=red,
                green=green,
                blue=blue,
                distance_ground=float(dist) if dist is not None else None,
            )
        )
    # transition angles are injected identically onto every frame - read the first
    sample = next((f for f in frames if f.get(f"{key}_transition_angle_middle") is not None), None)
    return LightSeries(
        light_name=name,
        setting_angle=summary.get("setting_angle") if summary else None,
        tolerance=summary.get("tolerance") if summary else None,
        transition_angle_min=sample.get(f"{key}_transition_angle_min") if sample else None,
        transition_angle_middle=sample.get(f"{key}_transition_angle_middle") if sample else None,
        transition_angle_max=sample.get(f"{key}_transition_angle_max") if sample else None,
        passed=summary.get("passed") if summary else None,
        points=points,
    )


def _drone_path(frames: list[dict]) -> list[DronePathPoint]:
    """ordered drone positions pulled from each frame's gps telemetry.

    keys are the canonical blob shape the engine writes per frame
    (``measurement_collector`` emits drone_latitude / drone_longitude /
    drone_elevation_wgs84) - don't rename them to the overlay gps_cache keys.
    """
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
    inspection = db.query(Inspection).filter(Inspection.id == measurement.inspection_id).first()
    response = MeasurementResultsResponse(
        id=measurement.id,
        inspection_id=measurement.inspection_id,
        status=measurement.status,
        has_results=False,
        label=measurement.label,
        inspection_method=inspection.method if inspection else None,
        inspection_sequence_order=inspection.sequence_order if inspection else None,
        runway_heading=measurement.runway_heading,
        reference_points=_reference_point_responses(measurement),
        summaries=_summary_responses(measurement),
    )
    if measurement.status != MeasurementStatus.DONE or not measurement.object_key:
        return response

    raw = object_storage.get_object(measurement.object_key)
    frames = json.loads(gzip.decompress(raw).decode("utf-8"))
    summaries_by_name = {s["light_name"]: s for s in (measurement.summaries or [])}

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
) -> tuple[dict, dict, bool]:
    """extract the first frame to image_path and detect PAPI candidates on it.

    returns (metadata, detected_positions, confident). confident is true only when the
    engine found a coherent line of all four PAPI lights - the auto-confirm signal.
    isolated so the heavy cv2 import only fires inside the worker and tests can stub it.
    """
    from app.services.video_processing.processor.detection import detect_lights_with_confidence
    from app.services.video_processing.processor.metadata import extract_first_frame

    metadata = extract_first_frame(video_path, image_path)
    detected, confident = detect_lights_with_confidence(image_path, reference_points)
    return metadata, detected, confident


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


def _boxes_from_detection(detected: dict) -> list[dict]:
    """turn the engine's detected-positions dict into ordered light-box dicts."""
    boxes: list[dict] = []
    for name in PAPI_LIGHT_NAMES:
        pos = detected.get(name)
        if not pos:
            continue
        boxes.append(
            {
                "light_name": name,
                "x": float(pos.get("x", 50.0)),
                "y": float(pos.get("y", 50.0)),
                "size": float(pos.get("size", 8.0)),
            }
        )
    return boxes


def run_first_frame(db: Session, measurement_id: UUID) -> Measurement:
    """worker step: extract the first frame, detect lights, confirm or await operator.

    drives QUEUED -> FIRST_FRAME, writing the first-frame image to object storage and
    pre-placing boxes from detection. a confident detection (coherent line of all four
    PAPI lights) auto-confirms straight to PROCESSING; an uncertain one parks at
    AWAITING_CONFIRM for manual review. any failure routes to ERROR. commits its own
    transitions so the polling endpoint sees progress.
    """
    measurement = db.query(Measurement).filter(Measurement.id == measurement_id).first()
    if measurement is None:
        raise NotFoundError("measurement not found")

    # idempotent: a redelivered/duplicate task on a run that already advanced (or
    # was reaped to ERROR) must not re-extract or trip an illegal FIRST_FRAME hop.
    if measurement.status != MeasurementStatus.QUEUED:
        return measurement

    measurement.transition_to(MeasurementStatus.FIRST_FRAME)
    db.commit()

    try:
        if not measurement.media_object_keys:
            raise DomainError("measurement has no media to process", status_code=422)

        with tempfile.TemporaryDirectory() as workdir:
            video_path = os.path.join(workdir, "input_0.mp4")
            object_storage.download_file(measurement.media_object_keys[0], video_path)

            image_path = os.path.join(workdir, "first_frame.jpg")
            ref_payload = list(measurement.reference_point_payload().values())
            _metadata, detected, confident = extract_first_frame_and_detect(
                video_path, image_path, ref_payload
            )

            frame_key = f"{_MEASUREMENT_PREFIX}/{measurement.id}/first_frame.jpg"
            object_storage.upload_file(frame_key, image_path, content_type="image/jpeg")

        measurement.first_frame_object_key = frame_key
        measurement.confirm_boxes(_boxes_from_detection(detected))
        next_status = (
            MeasurementStatus.PROCESSING if confident else MeasurementStatus.AWAITING_CONFIRM
        )
        measurement.transition_to(next_status)
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
    measurement = db.query(Measurement).filter(Measurement.id == measurement_id).first()
    if measurement is None:
        raise NotFoundError("measurement not found")

    # idempotent: a redelivered/duplicate task on a finished or reaped run no-ops
    # instead of reprocessing (the acks_late redelivery after a worker death).
    if measurement.status in (MeasurementStatus.DONE, MeasurementStatus.ERROR):
        return measurement

    if measurement.status != MeasurementStatus.PROCESSING:
        # confirm_lights moves the run to PROCESSING before enqueue; tolerate a
        # worker that picks the job up from AWAITING_CONFIRM (e.g. a manual re-run).
        if measurement.status == MeasurementStatus.AWAITING_CONFIRM:
            measurement.transition_to(MeasurementStatus.PROCESSING)
            db.commit()
        else:
            raise DomainError(
                f"measurement is not ready for processing (status {measurement.status})",
                status_code=409,
            )

    try:
        if not measurement.media_object_keys:
            raise DomainError("measurement has no media to process", status_code=422)

        light_positions = {
            b["light_name"]: {"x": b["x"], "y": b["y"], "size": b["size"]}
            for b in (measurement.light_boxes or [])
        }
        ref_payload = measurement.reference_point_payload()

        with tempfile.TemporaryDirectory() as workdir:
            video_path = os.path.join(workdir, "input_0.mp4")
            object_storage.download_file(measurement.media_object_keys[0], video_path)

            gps_data = extract_gps_data(video_path)
            if not gps_data:
                raise DomainError(
                    "no GPS telemetry found in the video - per-frame drone position is "
                    "required to measure PAPI transition angles. DJI footage must carry "
                    "its .SRT sidecar or an embedded telemetry subtitle track.",
                    status_code=422,
                )
            measurements_data, papi_paths, enhanced_path, combined_path = run_two_pass_processing(
                output_dir=workdir,
                video_path=video_path,
                session_id=str(measurement.id),
                light_positions=light_positions,
                gps_data=gps_data,
                reference_points=ref_payload,
                runway_heading=measurement.runway_heading or 0.0,
            )
            if not measurements_data:
                raise DomainError(
                    "processing produced no measurable frames - the video has no usable "
                    "per-frame GPS, so no transition angle could be measured.",
                    status_code=422,
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
    measurement = db.query(Measurement).filter(Measurement.id == measurement_id).first()
    if measurement is None:
        raise NotFoundError("measurement not found")
    if measurement.status != MeasurementStatus.ERROR:
        measurement.fail(message)
        db.commit()
    return measurement


# in-progress states a live worker owns; on worker startup nothing is running yet,
# so any run still in one of these is orphaned - its worker died mid-job.
_IN_PROGRESS_STATUSES = (MeasurementStatus.FIRST_FRAME, MeasurementStatus.PROCESSING)


def reap_stale_runs(db: Session) -> int:
    """fail measurement runs orphaned by a worker crash/restart; return the count.

    a run left in FIRST_FRAME/PROCESSING when its worker died would otherwise sit
    "processing" forever, and the redelivered acks_late task could re-run it. on
    worker startup nothing is in flight, so every such run is orphaned - fail it so
    the UI shows the error and the operator can re-run. assumes a single worker
    (the deployment shape); the per-task time limit is the complementary guard for
    a job that hangs without the worker dying.
    """
    values = [s.value for s in _IN_PROGRESS_STATUSES]
    stale = db.query(Measurement).filter(Measurement.status.in_(values)).all()
    for measurement in stale:
        measurement.fail("processing interrupted - the worker restarted; re-run the measurement")
    if stale:
        db.commit()
    return len(stale)
