"""drone-media endpoints - listing, per-inspection upload, reorder, move, ingest confirm."""

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.dependencies import OperatorUser
from app.core.database import get_db
from app.core.enums import AuditAction
from app.schemas.drone_media import (
    CompleteUploadRequest,
    ConfirmIngestRequest,
    ConfirmIngestResponse,
    DroneMediaListResponse,
    InspectionMediaGroup,
    MediaAssignRequest,
    MediaMoveRequest,
    MediaReorderRequest,
    MediaViewUrlResponse,
    UploadUrlRequest,
    UploadUrlResponse,
)
from app.schemas.field_link import DroneMediaFileResponse
from app.services import drone_media_service, object_storage
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


@router.get("/{media_id}/view-url", response_model=MediaViewUrlResponse)
def get_media_view_url(
    media_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """presigned GET url so the browser can stream or download one media file."""
    return MediaViewUrlResponse(url=drone_media_service.get_view_url(db, media_id))


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


@router.post("/upload-url", response_model=UploadUrlResponse)
def create_upload_url(
    body: UploadUrlRequest,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """issue a presigned PUT target for a direct browser upload - no row created yet."""
    object_key, upload_url = drone_media_service.create_upload_url(body.filename, body.content_type)
    return UploadUrlResponse(object_key=object_key, upload_url=upload_url)


@router.post("/complete-upload", response_model=DroneMediaFileResponse)
def complete_upload(
    body: CompleteUploadRequest,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """record a finished manual upload against a mission and optional inspection."""
    row = drone_media_service.complete_upload(
        db,
        body.mission_id,
        body.inspection_id,
        body.object_key,
        body.filename,
        body.size_bytes,
    )
    log_audit(
        db,
        current_user,
        AuditAction.CREATE,
        entity_type="DroneMediaFile",
        entity_id=row.id,
        entity_name=row.filename or row.object_key,
        details={
            "mission_id": str(body.mission_id),
            "inspection_id": str(body.inspection_id) if body.inspection_id else None,
        },
        ip_address=request.client.host if request.client else None,
    )
    db.commit()
    return row


@router.put("/inspections/{inspection_id}/reorder", response_model=InspectionMediaGroup)
def reorder_inspection_media(
    inspection_id: UUID,
    body: MediaReorderRequest,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """reorder one inspection's media to match the supplied id order."""
    mission, group = drone_media_service.reorder_inspection_media(
        db, inspection_id, body.ordered_ids
    )
    log_audit(
        db,
        current_user,
        AuditAction.UPDATE,
        entity_type="DroneMediaFile",
        entity_id=inspection_id,
        entity_name=mission.name,
        details={
            "inspection_id": str(inspection_id),
            "ordered_ids": [str(i) for i in body.ordered_ids],
        },
        ip_address=request.client.host if request.client else None,
        airport_id=mission.airport_id,
    )
    db.commit()
    return group


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


@router.put("/{media_id}/move", response_model=DroneMediaFileResponse)
def move_media(
    media_id: UUID,
    body: MediaMoveRequest,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """move one media file to another inspection / position, or detach it (null)."""
    row, mission = drone_media_service.move_media(
        db, media_id, body.inspection_id, body.order_index
    )
    log_audit(
        db,
        current_user,
        AuditAction.UPDATE,
        entity_type="DroneMediaFile",
        entity_id=row.id,
        entity_name=row.filename or row.object_key,
        details={
            "inspection_id": str(body.inspection_id) if body.inspection_id else None,
            "order_index": row.order_index,
        },
        ip_address=request.client.host if request.client else None,
        airport_id=mission.airport_id,
    )
    db.commit()
    return row


@router.delete("/{media_id}", status_code=204)
def delete_media(
    media_id: UUID,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """delete one manual upload and drop its stored object."""
    mission, object_key, entity_name = drone_media_service.delete_media(db, media_id)
    log_audit(
        db,
        current_user,
        AuditAction.DELETE,
        entity_type="DroneMediaFile",
        entity_id=media_id,
        entity_name=entity_name,
        details={"object_key": object_key},
        ip_address=request.client.host if request.client else None,
        airport_id=mission.airport_id if mission else None,
    )
    db.commit()

    # the row is gone for good - drop the object after the commit so a failed
    # commit can't orphan a deleted-row reference
    object_storage.delete_object(object_key)
