"""wayline dispatch request/response schemas."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.schemas.mission import DjiHeadingModeStr


class DispatchRequest(BaseModel):
    """request body for the mission dispatch endpoint.

    mirrors the export endpoint's options - dispatch builds the same KMZ
    through export_mission, so the geozone bundle, dji heading mode, and the
    altitude-clamp opt-in flow through identically. the file is computed the
    same way as a download; only delivery differs (hub register vs browser).
    """

    include_geozones: bool = False
    include_runway_buffers: bool = False
    dji_heading_mode_override: DjiHeadingModeStr | None = None
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
