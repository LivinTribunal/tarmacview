"""airport summary/detail, default-drone, bulk-drone change, openaip lookup, per-point elevation."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.api.dependencies import (
    CoordinatorUser,
    OperatorUser,
    check_airport_access,
    get_user_airport_ids,
)
from app.core.database import get_db
from app.core.enums import AuditAction
from app.core.exceptions import DomainError, NotFoundError
from app.schemas.airport import (
    AirportDetailResponse,
    AirportResponse,
    AirportSummaryListResponse,
    AirportUpdate,
    BulkChangeDroneRequest,
    BulkChangeDroneResponse,
    ElevationAtPointResponse,
    SetDefaultDroneRequest,
)
from app.schemas.common import DeleteResponse, ListMeta
from app.schemas.openaip import AirportLookupResponse
from app.services import airport_service, openaip_service
from app.utils.audit import log_audit

router = APIRouter()


# airports
@router.get("/summary", response_model=AirportSummaryListResponse)
def list_airports_summary(
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """list all airports with infrastructure and mission counts."""
    summaries = airport_service.list_airports_with_counts(
        db, airport_ids=get_user_airport_ids(current_user)
    )
    return AirportSummaryListResponse(data=summaries, meta=ListMeta(total=len(summaries)))


@router.get("/{airport_id}", response_model=AirportDetailResponse)
def get_airport(
    airport_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """get airport by id."""
    check_airport_access(current_user, airport_id)
    return airport_service.get_airport(db, airport_id)


@router.put("/{airport_id}", response_model=AirportResponse)
def update_airport(
    airport_id: UUID,
    body: AirportUpdate,
    request: Request,
    current_user: CoordinatorUser,
    rewrite_existing: bool = Query(default=True),
    db: Session = Depends(get_db),
):
    """update airport."""
    # rewrite_existing true (default) + an elevation field changed -> the service rewrites
    # every persisted obstacle / AGL / LHA / mission takeoff-landing altitude to the new
    # terrain provider; rewrite_existing=false leaves persisted altitudes intact
    check_airport_access(current_user, airport_id)
    elevation_changed = airport_service.elevation_fields_changed(body)
    airport = airport_service.update_airport(db, airport_id, body, renormalize=rewrite_existing)
    log_audit(
        db,
        current_user,
        AuditAction.UPDATE,
        entity_type="Airport",
        entity_id=airport_id,
        entity_name=airport.name,
        details=({"rewrite_existing": rewrite_existing} if elevation_changed else None),
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()
    return airport


@router.delete("/{airport_id}", response_model=DeleteResponse)
def delete_airport(
    airport_id: UUID,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """delete airport."""
    check_airport_access(current_user, airport_id)
    airport = airport_service.get_airport(db, airport_id)
    log_audit(
        db,
        current_user,
        AuditAction.DELETE,
        entity_type="Airport",
        entity_id=airport_id,
        entity_name=airport.name,
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    airport_service.delete_airport(db, airport_id)
    db.commit()

    return DeleteResponse(deleted=True)


@router.put("/{airport_id}/default-drone", response_model=AirportResponse)
def set_default_drone(
    airport_id: UUID,
    body: SetDefaultDroneRequest,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """set or clear the default drone profile for an airport."""
    check_airport_access(current_user, airport_id)
    airport = airport_service.set_default_drone(db, airport_id, body.drone_profile_id)
    log_audit(
        db,
        current_user,
        AuditAction.UPDATE,
        entity_type="Airport",
        entity_id=airport_id,
        entity_name=airport.name,
        details={
            "default_drone_profile_id": (
                str(body.drone_profile_id) if body.drone_profile_id else None
            ),
        },
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()
    return airport


@router.post("/{airport_id}/bulk-change-drone", response_model=BulkChangeDroneResponse)
def bulk_change_drone(
    airport_id: UUID,
    body: BulkChangeDroneRequest,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """change drone profile on missions at an airport."""
    check_airport_access(current_user, airport_id)
    airport = airport_service.get_airport(db, airport_id)
    count, regressed, ids = airport_service.bulk_change_drone(
        db,
        airport_id,
        body.drone_profile_id,
        from_drone_id=body.from_drone_id,
        scope=body.scope,
        mission_ids=body.mission_ids,
    )
    log_audit(
        db,
        current_user,
        AuditAction.UPDATE,
        entity_type="Airport",
        entity_id=airport_id,
        entity_name=airport.name,
        details={
            "drone_id": str(body.drone_profile_id),
            "mission_count": count,
            "mission_ids": [str(i) for i in ids],
        },
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()

    return BulkChangeDroneResponse(updated_count=count, regressed_count=regressed, mission_ids=ids)


# openaip lookup
@router.get("/lookup/{icao_code}", response_model=AirportLookupResponse)
def lookup_airport(
    icao_code: str,
    current_user: OperatorUser,
    radius_km: float = Query(default=3.0, gt=0, le=50),
):
    """fetch airport data + nearby airspaces / obstacles from openaip."""
    try:
        return openaip_service.lookup_airport_by_icao(icao_code, radius_km=radius_km)
    except NotFoundError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except DomainError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))


@router.get("/{airport_id}/elevation", response_model=ElevationAtPointResponse)
def get_elevation_at_point(
    airport_id: UUID,
    current_user: OperatorUser,
    lat: float = Query(..., ge=-90.0, le=90.0),
    lon: float = Query(..., ge=-180.0, le=180.0),
    allow_api: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    """sample ground elevation at (lat, lon)."""
    # DEM when uploaded, else flat; allow_api=true opts into the configured remote
    # provider (LHA-placement tier), default stays DEM-or-flat to avoid per-call http fanout
    check_airport_access(current_user, airport_id)
    try:
        elevation, source = airport_service.get_elevation_at_point(
            db, airport_id, lat, lon, allow_api=allow_api
        )
    except NotFoundError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except DomainError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    return ElevationAtPointResponse(elevation=elevation, source=source)
