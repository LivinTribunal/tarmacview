"""measurement orm row <-> wire mapping (keeps the route purely HTTP)."""

from app.models.measurement import Measurement
from app.schemas.measurement import (
    LightBox as LightBoxSchema,
)
from app.schemas.measurement import (
    LightSummaryResponse,
    MeasurementResponse,
    ReferencePointResponse,
)


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
