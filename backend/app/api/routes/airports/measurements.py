"""airport measurements list - read-only results entry point for the operator.

one row per measurement across the airport's missions/inspections, each carrying the
mission + inspection context + PASS/FAIL rollup the list page routes on. read-only: no
audit. orchestration lives in ``measurement_service``; persistence behind the
``MeasurementRepository`` port.
"""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies import OperatorUser, check_airport_access
from app.core.database import get_db
from app.schemas.measurement import MeasurementListItemResponse
from app.services import measurement_service

router = APIRouter()


@router.get("/{airport_id}/measurements", response_model=list[MeasurementListItemResponse])
def list_airport_measurements(
    airport_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """every measurement across the airport's missions/inspections, newest first."""
    check_airport_access(current_user, airport_id)
    return measurement_service.list_airport_measurements(db, airport_id)
