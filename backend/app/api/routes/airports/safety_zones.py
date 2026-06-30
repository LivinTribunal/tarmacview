"""safety zone CRUD for an airport."""

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.dependencies import CoordinatorUser, OperatorUser, check_airport_access
from app.core.database import get_db
from app.core.enums import AuditAction
from app.schemas.common import DeleteResponse, ListMeta
from app.schemas.infrastructure import (
    SafetyZoneCreate,
    SafetyZoneListResponse,
    SafetyZoneResponse,
    SafetyZoneUpdate,
)
from app.services import airport_service
from app.utils.audit import log_audit

router = APIRouter()


# safety zones
@router.get("/{airport_id}/safety-zones", response_model=SafetyZoneListResponse)
def list_safety_zones(
    airport_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """list all safety zones for airport."""
    check_airport_access(current_user, airport_id)
    zones = airport_service.list_safety_zones(db, airport_id)

    return SafetyZoneListResponse(data=zones, meta=ListMeta(total=len(zones)))


@router.post("/{airport_id}/safety-zones", status_code=201, response_model=SafetyZoneResponse)
def create_safety_zone(
    airport_id: UUID,
    body: SafetyZoneCreate,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """create safety zone for airport."""
    check_airport_access(current_user, airport_id)
    zone = airport_service.create_safety_zone(db, airport_id, body)
    log_audit(
        db,
        current_user,
        AuditAction.CREATE,
        entity_type="SafetyZone",
        entity_id=zone.id,
        entity_name=zone.name,
        details={"airport_id": str(airport_id)},
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()
    return zone


@router.put("/{airport_id}/safety-zones/{zone_id}", response_model=SafetyZoneResponse)
def update_safety_zone(
    airport_id: UUID,
    zone_id: UUID,
    body: SafetyZoneUpdate,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """update safety zone."""
    check_airport_access(current_user, airport_id)
    zone = airport_service.update_safety_zone(db, airport_id, zone_id, body)
    log_audit(
        db,
        current_user,
        AuditAction.UPDATE,
        entity_type="SafetyZone",
        entity_id=zone_id,
        entity_name=zone.name,
        details={"airport_id": str(airport_id)},
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()
    return zone


@router.delete("/{airport_id}/safety-zones/{zone_id}", response_model=DeleteResponse)
def delete_safety_zone(
    airport_id: UUID,
    zone_id: UUID,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """delete safety zone."""
    check_airport_access(current_user, airport_id)
    airport_service.delete_safety_zone(db, airport_id, zone_id)
    log_audit(
        db,
        current_user,
        AuditAction.DELETE,
        entity_type="SafetyZone",
        entity_id=zone_id,
        details={"airport_id": str(airport_id)},
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()

    return DeleteResponse(deleted=True)
