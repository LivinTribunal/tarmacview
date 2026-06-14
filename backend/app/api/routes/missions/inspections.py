"""inspection child resources: add, reorder, update, delete."""

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.dependencies import (
    OperatorUser,
    check_mission_access,
)
from app.core.dependencies import get_db
from app.core.enums import AuditAction
from app.schemas.common import DeleteResponse
from app.schemas.mission import (
    InspectionCreate,
    InspectionResponse,
    InspectionUpdate,
    ReorderRequest,
    ReorderResponse,
)
from app.services import (
    inspection_service,
)
from app.utils.audit import log_audit

router = APIRouter()


@router.post("/{mission_id}/inspections", status_code=201, response_model=InspectionResponse)
def add_inspection(
    mission_id: UUID,
    body: InspectionCreate,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """add inspection to mission."""
    mission = check_mission_access(db, current_user, mission_id)
    inspection = inspection_service.add_inspection(db, mission_id, body)
    log_audit(
        db,
        current_user,
        AuditAction.CREATE,
        entity_type="Inspection",
        entity_id=inspection.id,
        details={"mission_id": str(mission_id), "method": inspection.method},
        ip_address=request.client.host if request.client else None,
        airport_id=mission.airport_id,
    )
    db.commit()
    return inspection


# reorder declared before /{inspection_id} so "reorder" is not parsed as a UUID
@router.put("/{mission_id}/inspections/reorder", response_model=ReorderResponse)
def reorder_inspections(
    mission_id: UUID,
    body: ReorderRequest,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """reorder inspections by sequence."""
    mission = check_mission_access(db, current_user, mission_id)
    inspection_service.reorder_inspections(db, mission_id, body.inspection_ids)
    log_audit(
        db,
        current_user,
        AuditAction.UPDATE,
        entity_type="Mission",
        entity_id=mission_id,
        entity_name=mission.name,
        details={"reordered": [str(i) for i in body.inspection_ids]},
        ip_address=request.client.host if request.client else None,
        airport_id=mission.airport_id,
    )
    db.commit()

    return ReorderResponse(reordered=True)


@router.put("/{mission_id}/inspections/{inspection_id}", response_model=InspectionResponse)
def update_inspection(
    mission_id: UUID,
    inspection_id: UUID,
    body: InspectionUpdate,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """update inspection."""
    mission = check_mission_access(db, current_user, mission_id)
    inspection = inspection_service.update_inspection(db, mission_id, inspection_id, body)
    log_audit(
        db,
        current_user,
        AuditAction.UPDATE,
        entity_type="Inspection",
        entity_id=inspection_id,
        details={"mission_id": str(mission_id)},
        ip_address=request.client.host if request.client else None,
        airport_id=mission.airport_id,
    )
    db.commit()
    return inspection


@router.delete("/{mission_id}/inspections/{inspection_id}", response_model=DeleteResponse)
def delete_inspection(
    mission_id: UUID,
    inspection_id: UUID,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """delete inspection."""
    mission = check_mission_access(db, current_user, mission_id)
    inspection_service.delete_inspection(db, mission_id, inspection_id)
    log_audit(
        db,
        current_user,
        AuditAction.DELETE,
        entity_type="Inspection",
        entity_id=inspection_id,
        details={"mission_id": str(mission_id)},
        ip_address=request.client.host if request.client else None,
        airport_id=mission.airport_id,
    )
    db.commit()

    return DeleteResponse(deleted=True)
