"""airport + child entities (surface/obstacle/safety-zone/AGL/LHA), DEM, bulk-drone, elevation."""

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.dependencies import CoordinatorUser, OperatorUser, get_user_airport_ids
from app.api.routes.airports.agls import router as agls_router
from app.api.routes.airports.core import router as core_router
from app.api.routes.airports.lhas import router as lhas_router
from app.api.routes.airports.measurements import router as measurements_router
from app.api.routes.airports.obstacles import router as obstacles_router
from app.api.routes.airports.photo_metadata import router as photo_metadata_router
from app.api.routes.airports.safety_zones import router as safety_zones_router
from app.api.routes.airports.surfaces import router as surfaces_router
from app.api.routes.airports.terrain import router as terrain_router
from app.core.dependencies import get_db
from app.core.enums import AuditAction, UserRole
from app.schemas.airport import AirportCreate, AirportListResponse, AirportResponse
from app.schemas.common import ListMeta
from app.services import airport_service
from app.utils.audit import log_audit

router = APIRouter(prefix="/api/v1/airports", tags=["airports"])


# the airports root collection lives on the prefixed package router - an empty path
# can't be carried by a prefix-less sub-router through include_router
@router.get("", response_model=AirportListResponse)
def list_airports(
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """list all available airports for user."""
    airports = airport_service.list_airports(db, airport_ids=get_user_airport_ids(current_user))
    return AirportListResponse(data=airports, meta=ListMeta(total=len(airports)))


@router.post("", status_code=201, response_model=AirportResponse)
def create_airport(
    body: AirportCreate,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """create airport."""
    airport = airport_service.create_airport(db, body, creator=current_user)
    ip_address = request.client.host if request.client else None
    log_audit(
        db,
        current_user,
        AuditAction.CREATE,
        entity_type="Airport",
        entity_id=airport.id,
        entity_name=airport.name,
        ip_address=ip_address,
        airport_id=airport.id,
    )

    # coordinator creators are auto-assigned the airport (airport/core.py); record
    # that assignment so the audit log answers "how did this user get this airport"
    if current_user.role == UserRole.COORDINATOR.value:
        log_audit(
            db,
            current_user,
            AuditAction.ASSIGN_AIRPORT,
            entity_type="User",
            entity_id=current_user.id,
            entity_name=current_user.email,
            details={"airport_ids": [str(airport.id)]},
            ip_address=ip_address,
        )

    db.commit()
    return airport


# sub-routers included in source-block order so FastAPI's in-order path matching
# stays byte-identical to the pre-split single-file router
router.include_router(core_router)
router.include_router(terrain_router)
router.include_router(photo_metadata_router)
router.include_router(surfaces_router)
router.include_router(obstacles_router)
router.include_router(safety_zones_router)
router.include_router(agls_router)
router.include_router(lhas_router)
router.include_router(measurements_router)

__all__ = ["router"]
