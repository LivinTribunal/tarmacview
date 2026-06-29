"""field-link endpoints - hub status proxy and hub-reported media events."""

import os

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.dependencies import OperatorUser, require_hub_secret
from app.core.config import settings
from app.core.dependencies import get_db
from app.core.enums import AuditAction
from app.core.exceptions import DomainError
from app.schemas.field_link import (
    DroneMediaFileResponse,
    FieldLinkStatusResponse,
    FieldLinkWaylineListResponse,
    MediaEventCreate,
)
from app.services import drone_media_service, field_link_service
from app.utils.audit import log_audit

router = APIRouter(prefix="/api/v1/field-link", tags=["field-link"])

CA_CERT_MEDIA_TYPE = "application/x-x509-ca-cert"


@router.get("/status", response_model=FieldLinkStatusResponse)
def get_status(current_user: OperatorUser):
    """hub reachability and bound-device online state."""
    return field_link_service.get_field_link_status()


@router.get("/ca-cert")
def get_ca_cert(current_user: OperatorUser) -> FileResponse:
    """download the local CA cert to install on each RC so pilot 2 trusts the hub."""
    ca_path = settings.fieldhub_ca
    if not ca_path or not os.path.isfile(ca_path):
        raise HTTPException(status_code=404, detail="field hub CA certificate not available")
    return FileResponse(ca_path, media_type=CA_CERT_MEDIA_TYPE, filename="fieldhub-ca.crt")


@router.get("/waylines", response_model=FieldLinkWaylineListResponse)
def list_waylines(current_user: OperatorUser):
    """the hub's wayline library - empty list when the hub is absent/unreachable."""
    return field_link_service.list_field_link_waylines()


@router.delete("/waylines/{wayline_id}", status_code=204)
def delete_wayline(wayline_id: str, current_user: OperatorUser):
    """delete one wayline from the hub library - 404 when absent, 502 when hub is down."""
    try:
        deleted = field_link_service.delete_field_link_wayline(wayline_id)
    except DomainError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    if not deleted:
        raise HTTPException(status_code=404, detail="wayline not found")


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
