"""flight-plan trajectory generation, retrieval, revalidation, waypoint/transit editing. T3 path."""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.dependencies import OperatorUser, check_mission_access
from app.core.dependencies import get_db
from app.core.enums import AuditAction
from app.core.exceptions import DomainError, NotFoundError, TrajectoryGenerationError
from app.schemas.flight_plan import (
    FlightPlanResponse,
    GenerateTrajectoryResponse,
    TransitWaypointInsertRequest,
    WaypointBatchUpdateRequest,
)
from app.schemas.mission import ComputationStatusResponse
from app.services import flight_plan_service
from app.services.trajectory.orchestrator import generate_trajectory
from app.utils.audit import log_audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/missions", tags=["flight-plans"])


@router.post(
    "/{mission_id}/generate-trajectory",
    response_model=GenerateTrajectoryResponse,
)
def generate(
    mission_id: UUID,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """run 5-phase trajectory generation pipeline."""
    try:
        mission = check_mission_access(db, current_user, mission_id)
    except NotFoundError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

    mission.mark_computing()
    db.commit()

    try:
        flight_plan, _warnings = generate_trajectory(db, mission_id)
    except TrajectoryGenerationError as error:
        db.rollback()
        db.refresh(mission)
        mission.mark_computation_failed(error.message)
        db.commit()

        detail = (
            {"error": error.message, "violations": error.violations}
            if error.violations is not None
            else error.message
        )

        raise HTTPException(status_code=error.status_code, detail=detail)
    except DomainError as error:
        db.rollback()
        db.refresh(mission)
        mission.mark_computation_failed(error.message)
        db.commit()

        raise HTTPException(status_code=error.status_code, detail=error.message)
    except Exception as exc:
        logger.exception("unexpected error in generate", exc_info=exc)
        db.rollback()
        db.refresh(mission)
        mission.mark_computation_failed("unexpected error during trajectory computation")
        db.commit()
        raise HTTPException(
            status_code=500,
            detail="unexpected error during trajectory computation",
        )

    db.refresh(mission)
    mission.mark_computation_completed()
    log_audit(
        db,
        current_user,
        AuditAction.GENERATE_TRAJECTORY,
        entity_type="FlightPlan",
        entity_id=flight_plan.id,
        details={"mission_id": str(mission_id)},
        ip_address=request.client.host if request.client else None,
        airport_id=mission.airport_id,
    )
    db.commit()

    try:
        fp = flight_plan_service.get_flight_plan(db, flight_plan.mission_id)
    except DomainError as error:
        raise HTTPException(status_code=error.status_code, detail=error.message)

    db.refresh(mission)
    return GenerateTrajectoryResponse(flight_plan=fp, mission_status=mission.status)


@router.post("/{mission_id}/revalidate", response_model=FlightPlanResponse)
def revalidate(
    mission_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """re-run the safety pipeline without recomputing waypoints."""
    try:
        check_mission_access(db, current_user, mission_id)
        return flight_plan_service.revalidate_flight_plan(db, mission_id)
    except NotFoundError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except DomainError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.get(
    "/{mission_id}/computation-status",
    response_model=ComputationStatusResponse,
)
def get_computation_status(
    mission_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """lightweight polling endpoint for trajectory computation status."""
    try:
        mission = check_mission_access(db, current_user, mission_id)
    except NotFoundError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

    if mission.resolve_staleness():
        db.commit()

    return ComputationStatusResponse(
        computation_status=mission.computation_status,
        computation_error=mission.computation_error,
        computation_started_at=mission.computation_started_at,
    )


@router.get("/{mission_id}/flight-plan", response_model=FlightPlanResponse)
def get_plan(
    mission_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """get flight plan for mission."""
    check_mission_access(db, current_user, mission_id)
    try:
        return flight_plan_service.get_flight_plan(db, mission_id)
    except DomainError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)


@router.put("/{mission_id}/flight-plan/waypoints", response_model=FlightPlanResponse)
def batch_update_waypoints(
    mission_id: UUID,
    payload: WaypointBatchUpdateRequest,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """batch update waypoint positions and camera targets."""
    mission = check_mission_access(db, current_user, mission_id)
    try:
        result = flight_plan_service.batch_update_waypoints(db, mission_id, payload.updates)
    except NotFoundError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except DomainError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

    log_audit(
        db,
        current_user,
        AuditAction.UPDATE,
        entity_type="FlightPlan",
        entity_id=result.id,
        details={"mission_id": str(mission_id), "count": len(payload.updates)},
        ip_address=request.client.host if request.client else None,
        airport_id=mission.airport_id,
    )
    db.commit()
    return result


@router.post(
    "/{mission_id}/flight-plan/waypoints/transit",
    response_model=FlightPlanResponse,
)
def insert_transit_waypoint(
    mission_id: UUID,
    payload: TransitWaypointInsertRequest,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """insert a new transit waypoint at a position on the transit path."""
    mission = check_mission_access(db, current_user, mission_id)
    try:
        result = flight_plan_service.insert_transit_waypoint(db, mission_id, payload)
    except NotFoundError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except DomainError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

    new_wp = next(
        (wp for wp in result.waypoints if wp.sequence_order == payload.after_sequence + 1),
        None,
    )
    if new_wp is None:
        raise HTTPException(
            status_code=500,
            detail="inserted transit waypoint not found in flight plan",
        )

    log_audit(
        db,
        current_user,
        AuditAction.CREATE,
        entity_type="Waypoint",
        entity_id=new_wp.id,
        details={
            "mission_id": str(mission_id),
            "flight_plan_id": str(result.id),
            "after_sequence": payload.after_sequence,
        },
        ip_address=request.client.host if request.client else None,
        airport_id=mission.airport_id,
    )
    db.commit()
    return result


@router.delete(
    "/{mission_id}/flight-plan/waypoints/{waypoint_id}",
    response_model=FlightPlanResponse,
)
def delete_transit_waypoint(
    mission_id: UUID,
    waypoint_id: UUID,
    request: Request,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """delete a transit waypoint from the flight plan."""
    mission = check_mission_access(db, current_user, mission_id)
    try:
        result = flight_plan_service.delete_transit_waypoint(db, mission_id, waypoint_id)
    except NotFoundError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except DomainError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

    log_audit(
        db,
        current_user,
        AuditAction.DELETE,
        entity_type="Waypoint",
        entity_id=waypoint_id,
        details={"mission_id": str(mission_id), "flight_plan_id": str(result.id)},
        ip_address=request.client.host if request.client else None,
        airport_id=mission.airport_id,
    )
    db.commit()
    return result
