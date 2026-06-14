"""wayline dispatch request/response schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class DispatchRequest(BaseModel):
    """request body for the mission dispatch endpoint.

    mirrors the export endpoint's altitude-clamp opt-in - dispatch builds the
    same KMZ, so a clamped file needs the same operator acknowledgment.
    """

    acknowledge_altitude_clamps: bool = False


class WaylineDispatchResponse(BaseModel):
    """mission to wayline mapping persisted after a successful dispatch."""

    model_config = {"from_attributes": True}

    id: UUID
    mission_id: UUID
    wayline_id: UUID
    device_sn: str | None = None
    status: str
    dispatched_at: datetime
