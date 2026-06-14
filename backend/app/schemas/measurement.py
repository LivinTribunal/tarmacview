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


class ConfirmLightsRequest(BaseModel):
    """operator-confirmed/adjusted first-frame light boxes that start full processing."""

    boxes: list[LightBox]


class MeasurementPreviewResponse(BaseModel):
    """first-frame image (presigned GET) plus the detected/pre-placed boxes."""

    id: UUID
    status: MeasurementStatusStr
    first_frame_url: str | None = None
    boxes: list[LightBox] = []
