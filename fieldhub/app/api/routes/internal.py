"""internal endpoints for the tarmacview backend - shared-secret gated."""

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from app.core import pilot_session
from app.core.config import settings
from app.core.db import get_db
from app.core.security import require_hub_secret
from app.models.wayline import Wayline
from app.schemas.internal import (
    InternalDeviceStatus,
    InternalStatusResponse,
    InternalWaylineDeleteResponse,
    InternalWaylineItem,
    InternalWaylineListResponse,
)
from app.schemas.wayline import WaylineRegisterData
from app.services import device_registry, mqtt_listener, object_store, wayline_library

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal/api/v1", tags=["internal"])

KMZ_CONTENT_TYPE = "application/vnd.google-earth.kmz"

# fetch the whole registry in one page - the backend reconciles the full list
LIST_PAGE_SIZE = 1000


def _millis(value: datetime) -> int:
    """epoch milliseconds - the wire format for create/update times.

    sqlite loses tzinfo on round-trip, so naive values are read back as utc.
    """
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return int(value.timestamp() * 1000)


def _wayline_item(wayline: Wayline) -> InternalWaylineItem:
    """internal wayline payload from an orm row."""
    return InternalWaylineItem(
        id=wayline.id,
        mission_id=wayline.mission_id,
        name=wayline.name,
        drone_model_key=wayline.drone_model_key,
        payload_model_keys=wayline.payload_model_keys or [],
        favorited=wayline.favorited,
        username=wayline.username,
        create_time=_millis(wayline.create_time),
        update_time=_millis(wayline.update_time),
        object_key=wayline.object_key,
    )


@router.get("/status", response_model=InternalStatusResponse)
def status(
    _: None = Depends(require_hub_secret),
    db: Session = Depends(get_db),
) -> InternalStatusResponse:
    """broker attachment plus the device registry with live online state."""
    return InternalStatusResponse(
        broker_connected=mqtt_listener.listener.connected,
        rc_connected=pilot_session.session.is_connected(),
        devices=[InternalDeviceStatus(**e) for e in device_registry.snapshot(db)],
        connect_url=settings.connect_url() or None,
        public_host=settings.public_host or None,
    )


@router.post("/waylines", response_model=WaylineRegisterData)
async def register_wayline(
    wayline_id: str = Form(...),
    mission_id: str = Form(...),
    name: str = Form(...),
    object_key: str = Form(...),
    drone_model_key: str | None = Form(default=None),
    payload_model_keys: str = Form(default=""),
    sign: str | None = Form(default=None),
    file: UploadFile = File(...),
    _: None = Depends(require_hub_secret),
    db: Session = Depends(get_db),
) -> WaylineRegisterData:
    """store a dispatched mission KMZ and upsert its wayline library entry.

    keyed on wayline_id so a re-dispatch overwrites the object and updates
    the row instead of duplicating. payload_model_keys is comma-separated.
    """
    data = await file.read()
    object_store.put_object(object_key, data, KMZ_CONTENT_TYPE)
    wayline = wayline_library.register_wayline(
        db,
        wayline_id=wayline_id,
        mission_id=mission_id,
        name=name,
        object_key=object_key,
        drone_model_key=drone_model_key,
        payload_model_keys=[k.strip() for k in payload_model_keys.split(",") if k.strip()],
        sign=sign,
        username="tarmacview",
    )
    db.commit()
    return WaylineRegisterData(
        wayline_id=wayline.id, mission_id=wayline.mission_id, object_key=wayline.object_key
    )


@router.get("/waylines", response_model=InternalWaylineListResponse)
def list_waylines(
    _: None = Depends(require_hub_secret),
    db: Session = Depends(get_db),
) -> InternalWaylineListResponse:
    """all dispatched waylines (newest first) for the backend to reconcile."""
    waylines, _total = wayline_library.list_waylines(db, page=1, page_size=LIST_PAGE_SIZE)
    return InternalWaylineListResponse(waylines=[_wayline_item(w) for w in waylines])


@router.delete("/waylines/{wayline_id}", response_model=InternalWaylineDeleteResponse)
def delete_wayline(
    wayline_id: str,
    _: None = Depends(require_hub_secret),
    db: Session = Depends(get_db),
) -> InternalWaylineDeleteResponse:
    """remove a wayline row and its stored kmz - idempotent on a missing id."""
    wayline = wayline_library.delete_wayline(db, wayline_id)
    if wayline is None:
        return InternalWaylineDeleteResponse(deleted=False)
    object_key = wayline.object_key
    db.commit()

    # best effort - a stranded object must not fail the library delete
    try:
        object_store.remove_object(object_key)
    except Exception:
        logger.warning("wayline object cleanup failed for %s", object_key, exc_info=True)
    return InternalWaylineDeleteResponse(deleted=True)
