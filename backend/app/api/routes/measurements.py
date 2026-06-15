"""measurement endpoints - create/start, status poll, first-frame preview, confirm.

the create + confirm-lights routes hand work to the celery worker; status/preview are
read-only polls. routes stay HTTP-only: orchestration + the engine seams live in
``measurement_service``, persistence behind the ``MeasurementRepository`` port.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.dependencies import OperatorUser
from app.core.dependencies import get_db
from app.core.enums import AuditAction
from app.schemas.measurement import (
    ConfirmLightsRequest,
    MeasurementPreviewResponse,
    MeasurementResponse,
    MeasurementStatusResponse,
)
from app.services import measurement_service
from app.utils.audit import log_audit

router = APIRouter(prefix="/api/v1", tags=["measurements"])


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
    return measurement_service.to_response(measurement)


@router.get("/measurements/{measurement_id}", response_model=MeasurementResponse)
def get_measurement(
    measurement_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """full measurement aggregate (results + summaries once processing is done)."""
    return measurement_service.to_response(measurement_service.get_measurement(db, measurement_id))


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
        boxes=measurement_service.light_boxes_to_schema(m.light_boxes),
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
    measurement = measurement_service.confirm_lights(db, measurement_id, body.boxes)
    airport_id = measurement_service.airport_id_for_inspection(db, measurement.inspection_id)
    log_audit(
        db,
        current_user,
        AuditAction.MEASURE,
        entity_type="Measurement",
        entity_id=measurement.id,
        details={"status": measurement.status.value, "light_count": len(body.boxes)},
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()
    measurement_service.enqueue_processing(measurement.id)
    return measurement_service.to_response(measurement)
