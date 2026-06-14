"""field-link endpoints - hub status proxy and hub-reported media events."""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.dependencies import OperatorUser, require_hub_secret
from app.core.dependencies import get_db
from app.core.enums import AuditAction
from app.schemas.field_link import (
    DroneMediaFileResponse,
    FieldLinkStatusResponse,
    MediaEventCreate,
)
from app.services import drone_media_service, field_link_service
from app.utils.audit import log_audit

router = APIRouter(prefix="/api/v1/field-link", tags=["field-link"])


@router.get("/status", response_model=FieldLinkStatusResponse)
def get_status(current_user: OperatorUser):
    """hub reachability and bound-device online state."""
    return field_link_service.get_field_link_status()


@router.post("/media-events", status_code=201, response_model=DroneMediaFileResponse)
def create_media_event(
    body: MediaEventCreate,
    request: Request,
    _: None = Depends(require_hub_secret),
    db: Session = Depends(get_db),
):
    """hub-reported media arrival - persists a drone media file row as RECEIVED.

    idempotent on fingerprint: a repost returns the existing row and emits
    no second audit entry. internal hub-to-backend endpoint, not user-facing.
    new rows go straight through mission matching - failure-safe, a matching
    error leaves the row RECEIVED for the listing sweep to retry.
    """
    row, created = field_link_service.record_media_event(db, body)
    if created:
        drone_media_service.match_media_file(db, row)
        log_audit(
            db,
            None,
            AuditAction.CREATE,
            entity_type="DroneMediaFile",
            entity_id=row.id,
            entity_name=row.object_key,
            details={"fingerprint": row.fingerprint, "device_sn": row.device_sn},
            ip_address=request.client.host if request.client else None,
        )
    db.commit()
    return row
