"""ground surface CRUD plus runway pair-link (create-reverse / couple / decouple / recalculate)."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.dependencies import CoordinatorUser, OperatorUser, check_airport_access
from app.core.database import get_db
from app.core.enums import AuditAction
from app.core.exceptions import DomainError
from app.schemas.common import DeleteResponse, ListMeta
from app.schemas.infrastructure import (
    SurfaceCoupleRequest,
    SurfaceCreate,
    SurfaceCreateReverseRequest,
    SurfaceListResponse,
    SurfaceRecalculateResponse,
    SurfaceResponse,
    SurfaceUpdate,
)
from app.services import airport_service
from app.utils.audit import log_audit

router = APIRouter()


# ground surfaces
@router.get("/{airport_id}/surfaces", response_model=SurfaceListResponse)
def list_surfaces(
    airport_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """list all surfaces for airport."""
    check_airport_access(current_user, airport_id)
    surfaces = airport_service.list_surfaces(db, airport_id)

    return SurfaceListResponse(data=surfaces, meta=ListMeta(total=len(surfaces)))


@router.post("/{airport_id}/surfaces", status_code=201, response_model=SurfaceResponse)
def create_surface(
    airport_id: UUID,
    body: SurfaceCreate,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """create surface for airport."""
    check_airport_access(current_user, airport_id)
    surface = airport_service.create_surface(db, airport_id, body)
    log_audit(
        db,
        current_user,
        AuditAction.CREATE,
        entity_type="Surface",
        entity_id=surface.id,
        entity_name=surface.identifier,
        details={"airport_id": str(airport_id)},
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()
    return surface


@router.put("/{airport_id}/surfaces/{surface_id}", response_model=SurfaceResponse)
def update_surface(
    airport_id: UUID,
    surface_id: UUID,
    body: SurfaceUpdate,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """update surface for airport."""
    check_airport_access(current_user, airport_id)
    try:
        surface = airport_service.update_surface(db, airport_id, surface_id, body)
    except DomainError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    details: dict = {"airport_id": str(airport_id)}
    if surface.paired_surface_id is not None:
        details["paired_surface_id"] = str(surface.paired_surface_id)
    log_audit(
        db,
        current_user,
        AuditAction.UPDATE,
        entity_type="Surface",
        entity_id=surface_id,
        entity_name=surface.identifier,
        details=details,
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()
    return surface


@router.delete("/{airport_id}/surfaces/{surface_id}", response_model=DeleteResponse)
def delete_surface(
    airport_id: UUID,
    surface_id: UUID,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """delete surface for airport; cascades to the paired surface when coupled."""
    check_airport_access(current_user, airport_id)
    deleted, paired_deleted = airport_service.delete_surface(db, airport_id, surface_id)
    details: dict = {"airport_id": str(airport_id)}
    if paired_deleted is not None:
        details["paired_surface_id"] = str(paired_deleted.id)
    log_audit(
        db,
        current_user,
        AuditAction.DELETE,
        entity_type="Surface",
        entity_id=surface_id,
        entity_name=deleted.identifier if deleted else None,
        details=details,
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    if paired_deleted is not None:
        log_audit(
            db,
            current_user,
            AuditAction.DELETE,
            entity_type="Surface",
            entity_id=paired_deleted.id,
            entity_name=paired_deleted.identifier,
            details={"airport_id": str(airport_id), "paired_surface_id": str(surface_id)},
            ip_address=request.client.host if request.client else None,
            airport_id=airport_id,
        )
    db.commit()

    return DeleteResponse(deleted=True)


@router.post(
    "/{airport_id}/surfaces/{surface_id}/create-reverse",
    status_code=201,
    response_model=SurfaceResponse,
)
def create_reverse_surface(
    airport_id: UUID,
    surface_id: UUID,
    body: SurfaceCreateReverseRequest,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """create the reverse direction of a runway and auto-couple it."""
    check_airport_access(current_user, airport_id)
    try:
        base, reverse = airport_service.create_reverse_surface(db, airport_id, surface_id, body)
    except DomainError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    log_audit(
        db,
        current_user,
        AuditAction.CREATE,
        entity_type="Surface",
        entity_id=reverse.id,
        entity_name=reverse.identifier,
        details={
            "airport_id": str(airport_id),
            "paired_surface_id": str(base.id),
            "reverse_of": str(base.id),
        },
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()
    return reverse


@router.post(
    "/{airport_id}/surfaces/{surface_id}/couple",
    response_model=SurfaceResponse,
)
def couple_surface(
    airport_id: UUID,
    surface_id: UUID,
    body: SurfaceCoupleRequest,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """couple two RUNWAY surfaces; primary side overwrites the secondary's geometry."""
    check_airport_access(current_user, airport_id)
    try:
        primary, target = airport_service.couple_surfaces(db, airport_id, surface_id, body)
    except DomainError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    log_audit(
        db,
        current_user,
        AuditAction.UPDATE,
        entity_type="Surface",
        entity_id=primary.id,
        entity_name=primary.identifier,
        details={
            "airport_id": str(airport_id),
            "paired_surface_id": str(target.id),
            "primary": body.primary,
            "operation": "couple",
        },
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()
    return primary


@router.post(
    "/{airport_id}/surfaces/{surface_id}/decouple",
    response_model=SurfaceResponse,
)
def decouple_surface(
    airport_id: UUID,
    surface_id: UUID,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """clear the pair link on both sides; geometry stays as-is."""
    check_airport_access(current_user, airport_id)
    try:
        surface, pair = airport_service.decouple_surfaces(db, airport_id, surface_id)
    except DomainError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    log_audit(
        db,
        current_user,
        AuditAction.UPDATE,
        entity_type="Surface",
        entity_id=surface.id,
        entity_name=surface.identifier,
        details={
            "airport_id": str(airport_id),
            "paired_surface_id": str(pair.id),
            "operation": "decouple",
        },
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()
    return surface


@router.post(
    "/{airport_id}/surfaces/{surface_id}/recalculate",
    response_model=SurfaceRecalculateResponse,
)
def recalculate_surface(
    airport_id: UUID,
    surface_id: UUID,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """recompute surface length/width/heading from geometry without persisting."""
    check_airport_access(current_user, airport_id)
    return airport_service.recalculate_surface_dimensions(db, airport_id, surface_id)
