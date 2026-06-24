"""field-link DTOs - hub status proxy and hub-reported media events."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, field_validator

from app.schemas.geometry import PointZ

MediaFileStatusStr = Literal["RECEIVED", "MATCHED", "UNASSIGNED", "INGESTED"]
MediaOriginStr = Literal["HUB", "MANUAL"]


def _scrub_nul(value):
    """recursively strip nul bytes - postgres jsonb cannot store \\u0000."""
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, dict):
        return {_scrub_nul(k): _scrub_nul(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_scrub_nul(item) for item in value]
    return value


class FieldLinkDevice(BaseModel):
    """one device known to the field hub."""

    sn: str
    model_name: str | None = None
    model_key: str | None = None
    domain: int | None = None
    online: bool = False
    bound: bool = False
    gateway_sn: str | None = None


class FieldLinkStatusResponse(BaseModel):
    """hub reachability plus the device snapshot."""

    hub_online: bool
    # pilot's http session is live (RC connected); distinct from broker_connected
    # (hub<->broker link) and from a drone being online over mqtt
    rc_connected: bool = False
    broker_connected: bool = False
    devices: list[FieldLinkDevice] = []
    # device-facing connect address proxied from the hub - null when no host set
    connect_url: str | None = None
    public_host: str | None = None


class FieldLinkWayline(BaseModel):
    """one wayline registered in the field hub's library."""

    id: str
    mission_id: str
    name: str
    drone_model_key: str | None = None
    payload_model_keys: list[str] = []
    favorited: bool = False
    username: str | None = None
    # hub-reported epoch milliseconds
    create_time: int
    update_time: int


class FieldLinkWaylineListResponse(BaseModel):
    """the hub's wayline library, degrading to empty when the hub can't answer."""

    waylines: list[FieldLinkWayline] = []


class MediaEventCreate(BaseModel):
    """hub-reported arrival of one uploaded original."""

    object_key: str
    fingerprint: str
    # device-reported capture time - never server receive time
    captured_at: datetime | None = None
    position: PointZ | None = None
    device_sn: str | None = None
    # hub callback payload, persisted verbatim for the matching slice
    raw_callback: dict | None = None

    @field_validator("captured_at", mode="before")
    @classmethod
    def _tolerate_dirty_timestamp(cls, value):
        """strip nul/control bytes a device may append so a junk time degrades, not 422s."""
        if not isinstance(value, str):
            return value
        cleaned = "".join(ch for ch in value if ord(ch) >= 0x20 and ord(ch) != 0x7F).strip()
        return cleaned or None

    @field_validator("raw_callback", mode="before")
    @classmethod
    def _scrub_raw_callback(cls, value):
        """device embeds nul bytes the jsonb column rejects - strip them, keep the rest."""
        return _scrub_nul(value) if isinstance(value, dict) else value


class DroneMediaFileResponse(BaseModel):
    """drone media file row."""

    id: UUID
    object_key: str
    fingerprint: str | None = None
    captured_at: datetime | None = None
    capture_position: PointZ | None = None
    device_sn: str | None = None
    mission_id: UUID | None = None
    inspection_id: UUID | None = None
    order_index: int | None = None
    origin: MediaOriginStr
    filename: str | None = None
    size_bytes: int | None = None
    status: MediaFileStatusStr
    received_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
