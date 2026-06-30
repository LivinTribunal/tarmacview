"""obstacle CRUD plus dimension recalculation."""

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.dependencies import CoordinatorUser, OperatorUser, check_airport_access
from app.core.database import get_db
from app.core.enums import AuditAction
from app.schemas.common import DeleteResponse, ListMeta
from app.schemas.infrastructure import (
    ObstacleCreate,
    ObstacleListResponse,
    ObstacleRecalculateResponse,
    ObstacleResponse,
    ObstacleUpdate,
)
from app.services import airport_service
from app.utils.audit import log_audit

router = APIRouter()


# obstacles
@router.get("/{airport_id}/obstacles", response_model=ObstacleListResponse)
def list_obstacles(
    airport_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """list all obstacles for airport."""
    check_airport_access(current_user, airport_id)
    obstacles = airport_service.list_obstacles(db, airport_id)

    return ObstacleListResponse(data=obstacles, meta=ListMeta(total=len(obstacles)))


@router.post("/{airport_id}/obstacles", status_code=201, response_model=ObstacleResponse)
def create_obstacle(
    airport_id: UUID,
    body: ObstacleCreate,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """create obstacle for airport."""
    check_airport_access(current_user, airport_id)
    obstacle = airport_service.create_obstacle(db, airport_id, body)
    log_audit(
        db,
        current_user,
        AuditAction.CREATE,
        entity_type="Obstacle",
        entity_id=obstacle.id,
        entity_name=obstacle.name,
        details={"airport_id": str(airport_id)},
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()
    return obstacle


@router.put("/{airport_id}/obstacles/{obstacle_id}", response_model=ObstacleResponse)
def update_obstacle(
    airport_id: UUID,
    obstacle_id: UUID,
    body: ObstacleUpdate,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """update obstacle."""
    check_airport_access(current_user, airport_id)
    obstacle = airport_service.update_obstacle(db, airport_id, obstacle_id, body)
    log_audit(
        db,
        current_user,
        AuditAction.UPDATE,
        entity_type="Obstacle",
        entity_id=obstacle_id,
        entity_name=obstacle.name,
        details={"airport_id": str(airport_id)},
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()
    return obstacle


@router.delete("/{airport_id}/obstacles/{obstacle_id}", response_model=DeleteResponse)
def delete_obstacle(
    airport_id: UUID,
    obstacle_id: UUID,
    request: Request,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """delete obstacle."""
    check_airport_access(current_user, airport_id)
    airport_service.delete_obstacle(db, airport_id, obstacle_id)
    log_audit(
        db,
        current_user,
        AuditAction.DELETE,
        entity_type="Obstacle",
        entity_id=obstacle_id,
        details={"airport_id": str(airport_id)},
        ip_address=request.client.host if request.client else None,
        airport_id=airport_id,
    )
    db.commit()

    return DeleteResponse(deleted=True)


@router.post(
    "/{airport_id}/obstacles/{obstacle_id}/recalculate",
    response_model=ObstacleRecalculateResponse,
)
def recalculate_obstacle(
    airport_id: UUID,
    obstacle_id: UUID,
    current_user: CoordinatorUser,
    db: Session = Depends(get_db),
):
    """recompute obstacle dimensions from boundary geometry without persisting."""
    check_airport_access(current_user, airport_id)
    return airport_service.recalculate_obstacle_dimensions(db, airport_id, obstacle_id)
