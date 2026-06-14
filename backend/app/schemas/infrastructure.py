"""compat shim - infrastructure schemas split into surface/obstacle/safety_zone/agl modules."""

from app.schemas.agl import (  # noqa: F401
    AGLCreate,
    AGLListResponse,
    AGLResponse,
    AglTypeStr,
    AGLUpdate,
    LampTypeStr,
    LHABulkGenerateRequest,
    LHABulkGenerateResponse,
    LHACreate,
    LHAListResponse,
    LHAResponse,
    LHAUpdate,
    PAPISideStr,
)
from app.schemas.obstacle import (  # noqa: F401
    ObstacleCreate,
    ObstacleDimensions,
    ObstacleListResponse,
    ObstacleRecalculateResponse,
    ObstacleResponse,
    ObstacleTypeStr,
    ObstacleUpdate,
)
from app.schemas.safety_zone import (  # noqa: F401
    SafetyZoneCreate,
    SafetyZoneListResponse,
    SafetyZoneResponse,
    SafetyZoneTypeStr,
    SafetyZoneUpdate,
)
from app.schemas.surface import (  # noqa: F401
    SurfaceCoupleRequest,
    SurfaceCreate,
    SurfaceCreateReverseRequest,
    SurfaceDimensions,
    SurfaceListResponse,
    SurfaceRecalculateResponse,
    SurfaceResponse,
    SurfaceTypeStr,
    SurfaceUpdate,
)
