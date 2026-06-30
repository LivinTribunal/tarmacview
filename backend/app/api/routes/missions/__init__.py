"""mission routes package: assembles /api/v1/missions from core + inspections sub-routers.

list / create live on the package router because the prefix-less sub-routers
cannot carry an empty path through `include_router` (matches the airports/ pkg).

`mission_service`, `inspection_service`, `export_service`, `mission_report_service`
are re-exported at the package namespace so legacy `mock.patch("app.api.routes
.missions.mission_service.get_mission")` targets resolve unchanged.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.dependencies import (
    OperatorUser,
    check_airport_access,
    get_user_airport_ids,
)
from app.core.database import get_db
from app.core.enums import AuditAction
from app.schemas.common import ListMeta
from app.schemas.mission import (
    MissionCreate,
    MissionListResponse,
    MissionResponse,
)
from app.services import (
    export as export_service,
)
from app.services import (
    inspection_service,
    mission_service,
)
from app.services import (
    mission_report as mission_report_service,
)
from app.utils.audit import log_audit

from . import core, inspections

router = APIRouter(prefix="/api/v1/missions", tags=["missions"])


# the missions root collection lives on the prefixed package router - an empty
# path can't be carried by a prefix-less sub-router through include_router
@router.get("", response_model=MissionListResponse)
def list_missions(
    current_user: OperatorUser,
    airport_id: UUID | None = Query(None),
    status: str | None = Query(None),
    drone_profile_id: UUID | None = Query(None),
    limit: int = Query(20, le=200),
    offset: int = Query(0),
    db: Session = Depends(get_db),
):
    """list missions with filters and pagination."""
    missions, total = mission_service.list_missions(
        db,
        airport_id=airport_id,
        status=status,
        drone_profile_id=drone_profile_id,
        limit=limit,
        offset=offset,
        airport_ids=get_user_airport_ids(current_user),
    )

    data = []
    for m in missions:
        resp = MissionResponse.model_validate(m)
        resp.inspection_count = len(m.inspections) if m.inspections else 0
        resp.estimated_duration = m.flight_plan.estimated_duration if m.flight_plan else None
        data.append(resp)

    return MissionListResponse(data=data, meta=ListMeta(total=total, limit=limit, offset=offset))


@router.post("", status_code=201, response_model=MissionResponse)
def create_mission(
    body: MissionCreate,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """create mission in DRAFT status."""
    check_airport_access(current_user, body.airport_id)
    mission = mission_service.create_mission(db, body)
    log_audit(
        db,
        current_user,
        AuditAction.CREATE,
        entity_type="Mission",
        entity_id=mission.id,
        entity_name=mission.name,
        ip_address=request.client.host if request.client else None,
        airport_id=mission.airport_id,
    )
    db.commit()
    return mission


# sub-routers included in source-block order so FastAPI's in-order path matching
# stays byte-identical to the pre-split single-file router. inspections.py keeps
# the reorder route declared before /{inspection_id} internally.
router.include_router(core.router)
router.include_router(inspections.router)

__all__ = [
    "router",
    "mission_service",
    "inspection_service",
    "export_service",
    "mission_report_service",
]
