"""measurement worker runners + engine/enqueue seams (own their commits, off-request).

the engine seams (``extract_first_frame_and_detect`` / ``extract_gps_data`` /
``run_two_pass_processing``) are monkeypatched in tests on the *package* namespace, so
the runners resolve them through the package object ``_ms.<seam>`` - a bare-name call
would not see a patch applied to the package ``__init__``. same ``_orch.X`` pattern the
trajectory orchestrator uses for its test seams.
"""

import gzip
import json
import logging
import os
import tempfile
from uuid import UUID

from sqlalchemy.orm import Session

import app.services.measurement_service as _ms
from app.core.enums import MeasurementStatus
from app.core.exceptions import DomainError, NotFoundError
from app.models.measurement import PAPI_LIGHT_NAMES, Measurement
from app.services import object_storage

logger = logging.getLogger(__name__)

# object-storage key prefix for measurement artifacts
_MEASUREMENT_PREFIX = "measurements"


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
            _metadata, detected, confident = _ms.extract_first_frame_and_detect(
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


def _measured_transition_angles_touchpoint(
    measurements_data: list[dict],
) -> dict[str, float | None]:
    """last non-null per-light touchpoint-referenced transition middle angle from pass-1 data."""
    measured: dict[str, float | None] = {}
    for name in PAPI_LIGHT_NAMES:
        key = f"{name.lower()}_transition_angle_middle_touchpoint"
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
        touchpoint = measurement.touchpoint_payload()
        if touchpoint is not None:
            ref_payload["TOUCH_POINT"] = touchpoint

        with tempfile.TemporaryDirectory() as workdir:
            video_path = os.path.join(workdir, "input_0.mp4")
            object_storage.download_file(measurement.media_object_keys[0], video_path)

            gps_data = _ms.extract_gps_data(video_path)
            if not gps_data:
                raise DomainError(
                    "no GPS telemetry found in the video - per-frame drone position is "
                    "required to measure PAPI transition angles. DJI footage must carry "
                    "its .SRT sidecar or an embedded telemetry subtitle track.",
                    status_code=422,
                )
            measurements_data, papi_paths, enhanced_path, combined_path = (
                _ms.run_two_pass_processing(
                    output_dir=workdir,
                    video_path=video_path,
                    session_id=str(measurement.id),
                    light_positions=light_positions,
                    gps_data=gps_data,
                    reference_points=ref_payload,
                    runway_heading=measurement.runway_heading or 0.0,
                )
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
        measurement.with_summaries_from(
            _measured_transition_angles(measurements_data),
            _measured_transition_angles_touchpoint(measurements_data),
        )
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
