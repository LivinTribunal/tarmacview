"""field hub link - status proxy and hub-reported media event persistence."""

import logging

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import MediaFileStatus
from app.models.drone_media_file import DroneMediaFile
from app.schemas.field_link import FieldLinkDevice, FieldLinkStatusResponse, MediaEventCreate
from app.services.geometry_converter import geojson_to_wkt

logger = logging.getLogger(__name__)

STATUS_PATH = "/internal/api/v1/status"


def _no_hub() -> FieldLinkStatusResponse:
    """degraded response - hub unconfigured or unreachable."""
    return FieldLinkStatusResponse(hub_online=False)


def get_field_link_status(
    transport: httpx.BaseTransport | None = None,
) -> FieldLinkStatusResponse:
    """hub + device state, degrading to offline when the hub can't answer.

    an unset fieldhub_url means no hub in this deployment - report offline
    without a network attempt so cloud deploys stay unaffected.
    """
    if not settings.fieldhub_url:
        return _no_hub()

    verify = settings.fieldhub_ca if settings.fieldhub_ca else True
    try:
        with httpx.Client(
            base_url=settings.fieldhub_url,
            timeout=settings.fieldhub_timeout,
            verify=verify,
            transport=transport,
        ) as client:
            response = client.get(
                STATUS_PATH, headers={"X-Hub-Secret": settings.fieldhub_shared_secret}
            )
            response.raise_for_status()
            body = response.json()
        return FieldLinkStatusResponse(
            hub_online=True,
            broker_connected=bool(body.get("broker_connected", False)),
            devices=[FieldLinkDevice(**device) for device in body.get("devices", [])],
        )
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        logger.warning("field hub status fetch failed", exc_info=True)
        return _no_hub()


def record_media_event(db: Session, data: MediaEventCreate) -> tuple[DroneMediaFile, bool]:
    """persist one hub-reported media arrival, idempotent on fingerprint.

    returns (row, created) - a repost of an already-recorded fingerprint
    returns the existing row untouched so the hub can retry safely. rows are
    created as RECEIVED; later statuses belong to the matching slice.
    """
    existing = (
        db.query(DroneMediaFile).filter(DroneMediaFile.fingerprint == data.fingerprint).first()
    )
    if existing is not None:
        return existing, False

    row = DroneMediaFile(
        object_key=data.object_key,
        fingerprint=data.fingerprint,
        captured_at=data.captured_at,
        capture_position=geojson_to_wkt(data.position.model_dump()) if data.position else None,
        device_sn=data.device_sn,
        status=MediaFileStatus.RECEIVED.value,
        raw_callback=data.raw_callback,
    )
    db.add(row)
    db.flush()
    db.refresh(row)
    return row, True
