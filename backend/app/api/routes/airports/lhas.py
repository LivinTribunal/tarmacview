"""LHA CRUD plus bulk-generate, nested under an AGL."""

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.dependencies import CoordinatorUser, OperatorUser, check_airport_access
from app.core.dependencies import get_db
from app.core.enums import AuditAction
from app.schemas.common import DeleteResponse, ListMeta
from app.schemas.infrastructure import (
    LHABulkGenerateRequest,
    LHABulkGenerateResponse,
    LHACreate,
    LHAListResponse,
    LHAResponse,
    LHAUpdate,
)
from app.services import airport_service
from app.utils.audit import log_audit

router = APIRouter()


def _lha_context(airport_id: UUID, surface_id: UUID, agl_id: UUID) -> dict:
    """the airport/surface/agl id triple shared by every LHA audit detail."""
    return {
        "airport_id": str(airport_id),
        "surface_id": str(surface_id),
        "agl_id": str(agl_id),
    }


# LHAs
@router.get(
    "/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas", response_model=LHAListResponse
)
def list_lhas(
    airport_id: UUID,
    surface_id: UUID,
    agl_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """list all LHAs for AGL."""
    check_airport_access(current_user, airport_id)
    lhas = airport_service.list_lhas(db, airport_id, surface_id, agl_id)

    return LHAListResponse(data=lhas, meta=ListMeta(total=len(lhas)))


@router.post(
    "/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas",
    status_code=201,
    response_model=LHAResponse,
)
def create_lha(
    airport_id: UUID,
    surface_id: UUID,
    agl_id: UUID,
    body: LHACreate,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """create LHA for AGL."""
    check_airport_access(current_user, airport_id)
    lha = airport_service.create_lha(db, airport_id, surface_id, agl_id, body)
    log_audit(
        db,
        current_user,
        AuditAction.CREATE,
        entity_type="LHA",
        entity_id=lha.id,
        entity_name=lha.unit_designator,
        details=_lha_context(airport_id, surface_id, agl_id),
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()
    return lha


@router.put(
    "/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas/{lha_id}",
    response_model=LHAResponse,
)
def update_lha(
    airport_id: UUID,
    surface_id: UUID,
    agl_id: UUID,
    lha_id: UUID,
    body: LHAUpdate,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """update LHA."""
    check_airport_access(current_user, airport_id)
    lha = airport_service.update_lha(db, airport_id, surface_id, agl_id, lha_id, body)
    log_audit(
        db,
        current_user,
        AuditAction.UPDATE,
        entity_type="LHA",
        entity_id=lha_id,
        entity_name=lha.unit_designator,
        details=_lha_context(airport_id, surface_id, agl_id),
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()
    return lha


@router.post(
    "/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas/bulk",
    status_code=201,
    response_model=LHABulkGenerateResponse,
)
def bulk_generate_lhas(
    airport_id: UUID,
    surface_id: UUID,
    agl_id: UUID,
    body: LHABulkGenerateRequest,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """generate evenly-spaced LHAs between two points via linear interpolation."""
    check_airport_access(current_user, airport_id)
    created = airport_service.bulk_generate_lhas(db, airport_id, surface_id, agl_id, body)
    log_audit(
        db,
        current_user,
        AuditAction.CREATE,
        entity_type="LHA",
        entity_id=agl_id,
        details={
            **_lha_context(airport_id, surface_id, agl_id),
            "count": len(created),
            "lha_ids": [str(lha.id) for lha in created],
        },
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()

    return LHABulkGenerateResponse(generated=created)


@router.post(
    "/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas/reverse",
    response_model=LHAListResponse,
)
def reverse_lhas(
    airport_id: UUID,
    surface_id: UUID,
    agl_id: UUID,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """flip a PAPI AGL's LHA numbering A,B,C,D -> D,C,B,A in one step."""
    check_airport_access(current_user, airport_id)
    lhas = airport_service.reverse_lha_sequence(db, airport_id, surface_id, agl_id)
    log_audit(
        db,
        current_user,
        AuditAction.UPDATE,
        entity_type="LHA",
        entity_id=agl_id,
        details={
            **_lha_context(airport_id, surface_id, agl_id),
            "count": len(lhas),
            "lha_ids": [str(lha.id) for lha in lhas],
        },
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()

    return LHAListResponse(data=lhas, meta=ListMeta(total=len(lhas)))


@router.delete(
    "/{airport_id}/surfaces/{surface_id}/agls/{agl_id}/lhas/{lha_id}",
    response_model=DeleteResponse,
)
def delete_lha(
    airport_id: UUID,
    surface_id: UUID,
    agl_id: UUID,
    lha_id: UUID,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """delete LHA."""
    check_airport_access(current_user, airport_id)
    lha = airport_service.delete_lha(db, airport_id, surface_id, agl_id, lha_id)
    log_audit(
        db,
        current_user,
        AuditAction.DELETE,
        entity_type="LHA",
        entity_id=lha_id,
        entity_name=lha.unit_designator,
        details=_lha_context(airport_id, surface_id, agl_id),
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()

    return DeleteResponse(deleted=True)
