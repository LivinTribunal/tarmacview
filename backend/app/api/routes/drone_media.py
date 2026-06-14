"""drone-media endpoints - mission-grouped listing, manual reassignment, ingest confirm."""

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.dependencies import OperatorUser
from app.core.dependencies import get_db
from app.core.enums import AuditAction
from app.schemas.drone_media import (
    ConfirmIngestRequest,
    ConfirmIngestResponse,
    DroneMediaListResponse,
    MediaAssignRequest,
)
from app.schemas.field_link import DroneMediaFileResponse
from app.services import drone_media_service
from app.utils.audit import log_audit

router = APIRouter(prefix="/api/v1/drone-media", tags=["drone-media"])


@router.get("", response_model=DroneMediaListResponse)
def list_drone_media(current_user: OperatorUser, db: Session = Depends(get_db)):
    """drone media grouped by mission plus the unassigned bucket.

    the commit persists the lingering-RECEIVED matching sweep that runs inside
    the listing - a system retry, so no audit row attaches.
    """
    result = drone_media_service.list_drone_media(db)
    db.commit()
    return result


@router.post("/confirm-ingest", response_model=ConfirmIngestResponse)
def confirm_ingest(
    body: ConfirmIngestRequest,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """confirm a mission's media into the processing pipeline - idempotent."""
    mission, ingested = drone_media_service.confirm_ingest(db, body.mission_id)
    log_audit(
        db,
        current_user,
        AuditAction.STATUS_CHANGE,
        entity_type="DroneMediaFile",
        entity_id=mission.id,
        entity_name=mission.name,
        details={"mission_id": str(mission.id), "ingested_count": ingested},
        ip_address=request.client.host if request.client else None,
        airport_id=mission.airport_id,
    )
    db.commit()
    return ConfirmIngestResponse(mission_id=mission.id, ingested_count=ingested)


@router.post("/{media_id}/assign", response_model=DroneMediaFileResponse)
def assign_media(
    media_id: UUID,
    body: MediaAssignRequest,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """manually move one media file to a mission or the unassigned bucket."""
    row, mission = drone_media_service.assign_media(db, media_id, body.mission_id)
    log_audit(
        db,
        current_user,
        AuditAction.UPDATE,
        entity_type="DroneMediaFile",
        entity_id=row.id,
        entity_name=row.object_key,
        details={"mission_id": str(mission.id) if mission else None},
        ip_address=request.client.host if request.client else None,
        airport_id=mission.airport_id if mission else None,
    )
    db.commit()
    return row
