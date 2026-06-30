"""field hub link - status proxy and hub-reported media event persistence."""

import logging

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import MediaFileStatus
from app.core.exceptions import DomainError
from app.models.drone_media_file import DroneMediaFile
from app.schemas.field_link import (
    FieldLinkDevice,
    FieldLinkStatusResponse,
    FieldLinkWayline,
    FieldLinkWaylineListResponse,
    MediaEventCreate,
)
from app.services.geometry_converter import geojson_to_wkt

logger = logging.getLogger(__name__)

STATUS_PATH = "/internal/api/v1/status"
WAYLINES_PATH = "/internal/api/v1/waylines"


def _hub_client(transport: httpx.BaseTransport | None = None) -> httpx.Client:
    """configured httpx client for the field hub (base url, timeout, TLS verify)."""
    verify = settings.fieldhub_ca if settings.fieldhub_ca else True
    return httpx.Client(
        base_url=settings.fieldhub_url,
        timeout=settings.fieldhub_timeout,
        verify=verify,
        transport=transport,
    )


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

    try:
        with _hub_client(transport) as client:
            response = client.get(
                STATUS_PATH, headers={"X-Hub-Secret": settings.fieldhub_shared_secret}
            )
            response.raise_for_status()
            body = response.json()
        return FieldLinkStatusResponse(
            hub_online=True,
            rc_connected=bool(body.get("rc_connected", False)),
            broker_connected=bool(body.get("broker_connected", False)),
            devices=[FieldLinkDevice(**device) for device in body.get("devices", [])],
            connect_url=body.get("connect_url"),
            public_host=body.get("public_host"),
        )
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        logger.warning("field hub status fetch failed", exc_info=True)
        return _no_hub()


def list_field_link_waylines(
    transport: httpx.BaseTransport | None = None,
) -> FieldLinkWaylineListResponse:
    """the hub's wayline library, degrading to empty when the hub can't answer.

    mirrors get_field_link_status: an unset fieldhub_url or any transport/parse
    failure logs a warning and returns an empty list rather than raising, so the
    read-only listing never surfaces hub state as an error.
    """
    if not settings.fieldhub_url:
        return FieldLinkWaylineListResponse(waylines=[])

    try:
        with _hub_client(transport) as client:
            response = client.get(
                WAYLINES_PATH, headers={"X-Hub-Secret": settings.fieldhub_shared_secret}
            )
            response.raise_for_status()
            body = response.json()
        return FieldLinkWaylineListResponse(
            waylines=[_map_wayline(item) for item in body.get("waylines", [])]
        )
    except (httpx.HTTPError, ValueError, TypeError, AttributeError, KeyError):
        logger.warning("field hub wayline list fetch failed", exc_info=True)
        return FieldLinkWaylineListResponse(waylines=[])


def delete_field_link_wayline(
    wayline_id: str,
    transport: httpx.BaseTransport | None = None,
) -> bool:
    """delete one wayline from the hub library, returning the hub's deleted flag.

    raises DomainError(502) when the hub is unconfigured or unreachable so the
    route can distinguish "hub down" from a wayline that simply wasn't there.
    """
    if not settings.fieldhub_url:
        raise DomainError("field hub is not configured", status_code=502)

    try:
        with _hub_client(transport) as client:
            response = client.delete(
                f"{WAYLINES_PATH}/{wayline_id}",
                headers={"X-Hub-Secret": settings.fieldhub_shared_secret},
            )
            response.raise_for_status()
            body = response.json()
        return bool(body.get("deleted", False))
    except httpx.HTTPError as e:
        logger.warning("field hub wayline delete failed", exc_info=True)
        raise DomainError("field hub unreachable - wayline not deleted", status_code=502) from e


def _map_wayline(item: dict) -> FieldLinkWayline:
    """map one hub wayline item to the public shape, dropping object_key."""
    return FieldLinkWayline(
        id=item["id"],
        mission_id=item["mission_id"],
        name=item["name"],
        drone_model_key=item.get("drone_model_key"),
        payload_model_keys=item.get("payload_model_keys", []),
        favorited=bool(item.get("favorited", False)),
        username=item.get("username"),
        create_time=item["create_time"],
        update_time=item["update_time"],
    )


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
