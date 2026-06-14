"""measurement endpoints - create/start, status poll, first-frame preview, confirm.

the create + confirm-lights routes hand work to the celery worker; status/preview are
read-only polls. routes stay HTTP-only: orchestration + the engine seams live in
``measurement_service``, persistence behind the ``MeasurementRepository`` port.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.dependencies import OperatorUser
from app.core.dependencies import get_db
from app.core.enums import AuditAction
from app.domain.measurement.entities import LightBox as LightBoxDomain
from app.domain.measurement.entities import Measurement
from app.schemas.measurement import (
    ConfirmLightsRequest,
    LightBox,
    LightSummaryResponse,
    MeasurementPreviewResponse,
    MeasurementResponse,
    MeasurementResultsResponse,
    MeasurementStatusResponse,
    ReferencePointResponse,
)
from app.services import measurement_report_service, measurement_service
from app.utils.audit import log_audit

router = APIRouter(prefix="/api/v1", tags=["measurements"])


def _to_response(m: Measurement) -> MeasurementResponse:
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
        light_boxes=[
            LightBox(light_name=b.light_name, x=b.x, y=b.y, size=b.size) for b in m.light_boxes
        ],
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


@router.post("/inspections/{inspection_id}/measurement", response_model=MeasurementResponse)
def create_measurement(
    inspection_id: UUID,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """start a measurement run for an inspection - extracts the first frame async."""
    measurement = measurement_service.create_measurement(db, inspection_id)
    airport_id = measurement_service.airport_id_for_inspection(db, inspection_id)
    log_audit(
        db,
        current_user,
        AuditAction.MEASURE,
        entity_type="Measurement",
        entity_id=measurement.id,
        details={"inspection_id": str(inspection_id), "status": measurement.status.value},
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()
    measurement_service.enqueue_first_frame(measurement.id)
    return _to_response(measurement)


@router.get("/measurements/{measurement_id}", response_model=MeasurementResponse)
def get_measurement(
    measurement_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """full measurement aggregate (results + summaries once processing is done)."""
    return _to_response(measurement_service.get_measurement(db, measurement_id))


@router.get("/measurements/{measurement_id}/status", response_model=MeasurementStatusResponse)
def get_status(
    measurement_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """progress poll - status is the phase, error_message set only on ERROR."""
    m = measurement_service.get_measurement(db, measurement_id)
    return MeasurementStatusResponse(id=m.id, status=m.status.value, error_message=m.error_message)


@router.get("/measurements/{measurement_id}/preview", response_model=MeasurementPreviewResponse)
def get_preview(
    measurement_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """first-frame image (presigned GET) plus detected/pre-placed light boxes."""
    m, url = measurement_service.get_preview(db, measurement_id)
    return MeasurementPreviewResponse(
        id=m.id,
        status=m.status.value,
        first_frame_url=url,
        boxes=[LightBox(light_name=b.light_name, x=b.x, y=b.y, size=b.size) for b in m.light_boxes],
    )


@router.get("/measurements/{measurement_id}/data", response_model=MeasurementResultsResponse)
def get_results_data(
    measurement_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """full results payload - per-light series, drone path, summaries, video urls."""
    return measurement_service.build_results_data(db, measurement_id)


@router.get("/measurements/{measurement_id}/pdf-report", response_class=Response)
def get_pdf_report(
    measurement_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """server-rendered measurement results pdf (summary table + per-light charts)."""
    operator_label = current_user.name or current_user.email or "N/A"
    pdf_bytes, filename = measurement_report_service.generate_measurement_report(
        db, measurement_id, operator_label=operator_label
    )
    sanitized = filename.replace('"', "").replace("\r", "").replace("\n", "")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{sanitized}"'},
    )


@router.post("/measurements/{measurement_id}/confirm-lights", response_model=MeasurementResponse)
def confirm_lights(
    measurement_id: UUID,
    body: ConfirmLightsRequest,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """confirm/adjust the detected boxes and kick off full processing."""
    boxes = [LightBoxDomain(light_name=b.light_name, x=b.x, y=b.y, size=b.size) for b in body.boxes]
    measurement = measurement_service.confirm_lights(db, measurement_id, boxes)
    airport_id = measurement_service.airport_id_for_inspection(db, measurement.inspection_id)
    log_audit(
        db,
        current_user,
        AuditAction.MEASURE,
        entity_type="Measurement",
        entity_id=measurement.id,
        details={"status": measurement.status.value, "light_count": len(boxes)},
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()
    measurement_service.enqueue_processing(measurement.id)
    return _to_response(measurement)
