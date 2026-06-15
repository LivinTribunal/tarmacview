"""airport measurements list - read-only airport-scoped results entry point.

one row per measurement across every mission/inspection of the airport, each carrying
mission + inspection context + the PASS/FAIL rollup the list page routes on. read-only:
no audit. orchestration lives in ``measurement_service``; persistence behind the
``MeasurementRepository`` port.
"""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies import OperatorUser, check_airport_access
from app.core.dependencies import get_db
from app.schemas.measurement import MeasurementListItemResponse
from app.services import measurement_service

router = APIRouter()


@router.get("/{airport_id}/measurements", response_model=list[MeasurementListItemResponse])
def list_airport_measurements(
    airport_id: UUID,
    current_user: OperatorUser,
    db: Session = Depends(get_db),
):
    """every measurement across the airport's missions, grouped by mission, newest first."""
    check_airport_access(current_user, airport_id)
    return measurement_service.list_airport_measurements(db, airport_id)
