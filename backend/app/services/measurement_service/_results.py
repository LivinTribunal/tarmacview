"""measurement results assembly - read-only pivot of the gzipped per-frame blob."""

import gzip
import json
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.enums import MeasurementStatus
from app.models.inspection import Inspection
from app.models.measurement import PAPI_LIGHT_NAMES
from app.schemas.measurement import (
    DronePathPoint,
    LightSeries,
    LightSeriesPoint,
    MeasurementResultsResponse,
)
from app.services import object_storage
from app.services.measurement_service._crud import get_measurement
from app.services.measurement_service._mapping import (
    _reference_point_responses,
    _summary_responses,
)


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
