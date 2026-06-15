"""mission measurements list - read-only results entry point for the operator.

one row per measurement across the mission's inspections, each carrying the inspection
context + PASS/FAIL rollup the list page routes on. read-only: no audit. orchestration
lives in ``measurement_service``; persistence behind the ``MeasurementRepository`` port.
"""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies import OperatorUser, check_mission_access
from app.core.dependencies import get_db
from app.schemas.measurement import MeasurementListItemResponse
from app.services import measurement_service

router = APIRouter()


@router.get("/{mission_id}/measurements", response_model=list[MeasurementListItemResponse])
def list_mission_measurements(
    mission_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """every measurement across the mission's inspections, newest first."""
    check_mission_access(db, current_user, mission_id)
    return measurement_service.list_mission_measurements(db, mission_id)
