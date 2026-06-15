"""measurement DTOs - create/status/preview/confirm shapes for the video pipeline."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

MeasurementStatusStr = Literal[
    "QUEUED", "FIRST_FRAME", "AWAITING_CONFIRM", "PROCESSING", "DONE", "ERROR"
]


class ReferencePointResponse(BaseModel):
    """one PAPI light's snapshotted ground truth."""

    light_name: str
    latitude: float
    longitude: float
    elevation: float
    lha_id: UUID | None = None
    unit_designator: str | None = None
    setting_angle: float | None = None
    tolerance: float | None = None


class LightBox(BaseModel):
    """a PAPI light's box on the first frame, in percentage coordinates."""

    light_name: str
    x: float
    y: float
    size: float


class LightSummaryResponse(BaseModel):
    """per-light PASS/FAIL rollup vs the snapshotted setting angle +/- tolerance."""

    light_name: str
    setting_angle: float | None = None
    tolerance: float | None = None
    measured_transition_angle: float | None = None
    passed: bool | None = None


class MeasurementResponse(BaseModel):
    """full measurement aggregate as returned to the operator."""

    id: UUID
    inspection_id: UUID
    status: MeasurementStatusStr
    runway_heading: float | None = None
    reference_points: list[ReferencePointResponse] = []
    light_boxes: list[LightBox] = []
    summaries: list[LightSummaryResponse] = []
    object_key: str | None = None
    first_frame_object_key: str | None = None
    error_message: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class MeasurementStatusResponse(BaseModel):
    """lightweight progress poll - status doubles as the phase."""

    id: UUID
    status: MeasurementStatusStr
    error_message: str | None = None


class MeasurementListItemResponse(BaseModel):
    """one row of the airport measurements list - status + mission/inspection context + rollup.

    ``has_results`` and the PASS/FAIL counts derive from the aggregate's summaries +
    object_key, so the list page can route each row without a per-row results fetch.
    """

    id: UUID
    inspection_id: UUID
    mission_id: UUID
    mission_name: str
    inspection_method: str
    inspection_sequence_order: int
    status: MeasurementStatusStr
    created_at: datetime | None = None
    has_results: bool = False
    pass_count: int = 0
    fail_count: int = 0
    error_message: str | None = None


class ConfirmLightsRequest(BaseModel):
    """operator-confirmed/adjusted first-frame light boxes that start full processing."""

    boxes: list[LightBox]


class MeasurementPreviewResponse(BaseModel):
    """first-frame image (presigned GET) plus the detected/pre-placed boxes."""

    id: UUID
    status: MeasurementStatusStr
    first_frame_url: str | None = None
    boxes: list[LightBox] = []


# results shapes - the pivoted view of the gzipped per-frame blob in object storage


class LightSeriesPoint(BaseModel):
    """one frame's reading for a single light - the unit the timeseries plots.

    chromaticity is derived from the per-frame rgb triple (normalized r/g), there
    is no direct chromaticity key in the engine blob.
    """

    frame_number: int
    timestamp: float
    status: str | None = None
    angle: float | None = None
    horizontal_angle: float | None = None
    intensity: float | None = None
    area_pixels: int | None = None
    chromaticity_x: float | None = None
    chromaticity_y: float | None = None


class LightSeries(BaseModel):
    """one light's full timeseries plus its transition angles and PASS/FAIL rollup."""

    light_name: str
    setting_angle: float | None = None
    tolerance: float | None = None
    transition_angle_min: float | None = None
    transition_angle_middle: float | None = None
    transition_angle_max: float | None = None
    passed: bool | None = None
    points: list[LightSeriesPoint] = []


class DronePathPoint(BaseModel):
    """one frame's drone position, the ordered flown path on the map."""

    frame_number: int
    timestamp: float
    latitude: float
    longitude: float
    elevation: float | None = None


class MeasurementResultsResponse(BaseModel):
    """full results payload for the operator results page.

    ``has_results`` is false (and ``lights`` / ``drone_path`` / ``video_urls`` empty)
    until the run is DONE with a results blob in object storage.
    """

    id: UUID
    inspection_id: UUID
    status: MeasurementStatusStr
    has_results: bool = False
    runway_heading: float | None = None
    reference_points: list[ReferencePointResponse] = []
    summaries: list[LightSummaryResponse] = []
    lights: list[LightSeries] = []
    drone_path: list[DronePathPoint] = []
    video_urls: dict[str, str] = {}
