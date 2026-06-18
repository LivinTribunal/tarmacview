"""internal status dtos for the backend's field-link proxy."""

from pydantic import BaseModel


class InternalDeviceStatus(BaseModel):
    """device snapshot entry."""

    sn: str
    domain: int | None = None
    model_key: str | None = None
    model_name: str | None = None
    nickname: str | None = None
    gateway_sn: str | None = None
    online: bool = False
    bound: bool = False
    bound_at: str | None = None


class InternalStatusResponse(BaseModel):
    """hub-side state for the backend proxy."""

    broker_connected: bool
    # pilot's authenticated http session is alive (the 'RC connected' signal,
    # distinct from a drone being online over mqtt)
    rc_connected: bool = False
    devices: list[InternalDeviceStatus]
    # device-facing connect address pilot 2 points at - null when unprovisioned
    connect_url: str | None = None
    public_host: str | None = None
