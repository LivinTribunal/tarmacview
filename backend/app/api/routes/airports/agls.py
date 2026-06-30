"""AGL CRUD nested under a surface."""

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.dependencies import CoordinatorUser, OperatorUser, check_airport_access
from app.core.dependencies import get_db
from app.core.enums import AuditAction
from app.schemas.common import DeleteResponse, ListMeta
from app.schemas.infrastructure import (
    AGLCreate,
    AGLListResponse,
    AGLResponse,
    AGLUpdate,
)
from app.services import airport_service
from app.utils.audit import log_audit

router = APIRouter()


# AGLs
@router.get("/{airport_id}/surfaces/{surface_id}/agls", response_model=AGLListResponse)
def list_agls(
    airport_id: UUID,
    surface_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """list all AGLs for surface."""
    check_airport_access(current_user, airport_id)
    agls = airport_service.list_agls(db, airport_id, surface_id)

    return AGLListResponse(data=agls, meta=ListMeta(total=len(agls)))


@router.post(
    "/{airport_id}/surfaces/{surface_id}/agls", status_code=201, response_model=AGLResponse
)
def create_agl(
    airport_id: UUID,
    surface_id: UUID,
    body: AGLCreate,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """create AGL for surface."""
    check_airport_access(current_user, airport_id)
    agl = airport_service.create_agl(db, airport_id, surface_id, body)
    log_audit(
        db,
        current_user,
        AuditAction.CREATE,
        entity_type="AGL",
        entity_id=agl.id,
        entity_name=agl.name,
        details={"airport_id": str(airport_id), "surface_id": str(surface_id)},
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()
    return agl


@router.put("/{airport_id}/surfaces/{surface_id}/agls/{agl_id}", response_model=AGLResponse)
def update_agl(
    airport_id: UUID,
    surface_id: UUID,
    agl_id: UUID,
    body: AGLUpdate,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """update AGL."""
    check_airport_access(current_user, airport_id)
    agl = airport_service.update_agl(db, airport_id, surface_id, agl_id, body)
    log_audit(
        db,
        current_user,
        AuditAction.UPDATE,
        entity_type="AGL",
        entity_id=agl_id,
        entity_name=agl.name,
        details={"airport_id": str(airport_id), "surface_id": str(surface_id)},
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()
    return agl


@router.delete("/{airport_id}/surfaces/{surface_id}/agls/{agl_id}", response_model=DeleteResponse)
def delete_agl(
    airport_id: UUID,
    surface_id: UUID,
    agl_id: UUID,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """delete AGL."""
    check_airport_access(current_user, airport_id)
    agl = airport_service.delete_agl(db, airport_id, surface_id, agl_id)
    log_audit(
        db,
        current_user,
        AuditAction.DELETE,
        entity_type="AGL",
        entity_id=agl_id,
        entity_name=agl.name,
        details={"airport_id": str(airport_id), "surface_id": str(surface_id)},
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()

    return DeleteResponse(deleted=True)
