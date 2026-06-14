"""string enums shared across models, schemas, and services."""

import enum


def enum_check_values(e: type[enum.Enum]) -> str:
    """render an enum's values as a quoted, comma-joined sql check list."""
    return ", ".join(f"'{m.value}'" for m in e)


class UserRole(str, enum.Enum):
    """user access level."""

    OPERATOR = "OPERATOR"
    COORDINATOR = "COORDINATOR"
    SUPER_ADMIN = "SUPER_ADMIN"


class MissionStatus(str, enum.Enum):
    """mission lifecycle state."""

    DRAFT = "DRAFT"
    PLANNED = "PLANNED"
    VALIDATED = "VALIDATED"
    EXPORTED = "EXPORTED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class WaypointType(str, enum.Enum):
    """role of a waypoint within a flight plan."""

    TAKEOFF = "TAKEOFF"
    TRANSIT = "TRANSIT"
    MEASUREMENT = "MEASUREMENT"
    HOVER = "HOVER"
    LANDING = "LANDING"


class CameraAction(str, enum.Enum):
    """camera trigger associated with a waypoint."""

    NONE = "NONE"
    PHOTO_CAPTURE = "PHOTO_CAPTURE"
    RECORDING_START = "RECORDING_START"
    RECORDING = "RECORDING"
    RECORDING_STOP = "RECORDING_STOP"


class ExportFormat(str, enum.Enum):
    """flight-plan export file format."""

    MAVLINK = "MAVLINK"
    KML = "KML"
    KMZ = "KMZ"
    JSON = "JSON"
    UGCS = "UGCS"
    WPML = "WPML"
    CSV = "CSV"
    GPX = "GPX"
    LITCHI = "LITCHI"
    DRONEDEPLOY = "DRONEDEPLOY"


class InspectionMethod(str, enum.Enum):
    """trajectory-generation strategy for an inspection."""

    VERTICAL_PROFILE = "VERTICAL_PROFILE"
    HORIZONTAL_RANGE = "HORIZONTAL_RANGE"
    APPROACH_DESCENT = "APPROACH_DESCENT"
    FLY_OVER = "FLY_OVER"
    PARALLEL_SIDE_SWEEP = "PARALLEL_SIDE_SWEEP"
    HOVER_POINT_LOCK = "HOVER_POINT_LOCK"
    MEHT_CHECK = "MEHT_CHECK"
    SURFACE_SCAN = "SURFACE_SCAN"


class ScanLengthMode(str, enum.Enum):
    """along-track extent of a surface scan."""

    FULL = "FULL"
    MAX_LENGTH = "MAX_LENGTH"
    INTERVAL = "INTERVAL"


class ScanWidthSide(str, enum.Enum):
    """which side of the surface bearing a narrowed scan band sits on."""

    LEFT = "LEFT"
    RIGHT = "RIGHT"


class ScanRunOrientation(str, enum.Enum):
    """orientation of a surface scan's parallel runs."""

    LENGTH_WISE = "LENGTH_WISE"
    WIDTH_WISE = "WIDTH_WISE"


# method <-> AGL type compatibility per ZEPHYR spec.
# HOVER_POINT_LOCK and SURFACE_SCAN are deliberately omitted: they are
# AGL-agnostic (HPL targets an LHA, SURFACE_SCAN targets an AirfieldSurface),
# so they carry no AGL targets and the empty .get() fallback treats them as
# compatible with none.
METHOD_AGL_COMPAT: dict[InspectionMethod, set[str]] = {
    InspectionMethod.VERTICAL_PROFILE: {"PAPI"},
    InspectionMethod.HORIZONTAL_RANGE: {"PAPI"},
    InspectionMethod.APPROACH_DESCENT: {"PAPI"},
    InspectionMethod.FLY_OVER: {"RUNWAY_EDGE_LIGHTS"},
    InspectionMethod.PARALLEL_SIDE_SWEEP: {"RUNWAY_EDGE_LIGHTS"},
    InspectionMethod.MEHT_CHECK: {"PAPI"},
}


def is_method_compatible_with_agl(method: str, agl_type: str) -> bool:
    """check whether an inspection method is compatible with an AGL type."""
    try:
        m = InspectionMethod(method)
    except ValueError:
        return False
    return agl_type in METHOD_AGL_COMPAT.get(m, set())


class SafetyZoneType(str, enum.Enum):
    """category of an airspace or boundary restriction zone."""

    CTR = "CTR"
    RESTRICTED = "RESTRICTED"
    PROHIBITED = "PROHIBITED"
    TEMPORARY_NO_FLY = "TEMPORARY_NO_FLY"
    AIRPORT_BOUNDARY = "AIRPORT_BOUNDARY"


class ObstacleType(str, enum.Enum):
    """physical obstacle classification."""

    BUILDING = "BUILDING"
    TOWER = "TOWER"
    ANTENNA = "ANTENNA"
    VEGETATION = "VEGETATION"
    OTHER = "OTHER"


class LampType(str, enum.Enum):
    """PAPI lamp technology."""

    HALOGEN = "HALOGEN"
    LED = "LED"


class PAPISide(str, enum.Enum):
    """which side of the runway the PAPI array sits on."""

    LEFT = "LEFT"
    RIGHT = "RIGHT"


class ConstraintType(str, enum.Enum):
    """flight-plan constraint category."""

    ALTITUDE = "ALTITUDE"
    SPEED = "SPEED"
    GEOFENCE = "GEOFENCE"
    RUNWAY_BUFFER = "RUNWAY_BUFFER"
    BATTERY = "BATTERY"


class SurfaceType(str, enum.Enum):
    """airfield surface category."""

    RUNWAY = "RUNWAY"
    TAXIWAY = "TAXIWAY"


class TerrainSource(str, enum.Enum):
    """source of terrain elevation data for an airport."""

    FLAT = "FLAT"
    DEM_UPLOAD = "DEM_UPLOAD"
    DEM_API = "DEM_API"
    # offline-staged Copernicus GLO-30 tiles, served from a local geotiff
    DEM_SRTM = "DEM_SRTM"


class FlightPlanScope(str, enum.Enum):
    """controls which waypoint types are included in the generated flight plan."""

    FULL = "FULL"
    MEASUREMENTS_ONLY = "MEASUREMENTS_ONLY"


class MediaFileStatus(str, enum.Enum):
    """drone media file ingest lifecycle."""

    RECEIVED = "RECEIVED"
    MATCHED = "MATCHED"
    UNASSIGNED = "UNASSIGNED"
    INGESTED = "INGESTED"


class AuditAction(str, enum.Enum):
    """action types for audit log entries."""

    LOGIN = "LOGIN"
    LOGOUT = "LOGOUT"
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    DELETE = "DELETE"
    STATUS_CHANGE = "STATUS_CHANGE"
    EXPORT = "EXPORT"
    DISPATCH = "DISPATCH"
    VALIDATE = "VALIDATE"
    GENERATE_TRAJECTORY = "GENERATE_TRAJECTORY"
    INVITE_USER = "INVITE_USER"
    DEACTIVATE_USER = "DEACTIVATE_USER"
    ASSIGN_AIRPORT = "ASSIGN_AIRPORT"
    SYSTEM_SETTING_CHANGE = "SYSTEM_SETTING_CHANGE"


class ComputationStatus(str, enum.Enum):
    """trajectory computation lifecycle status."""

    IDLE = "IDLE"
    COMPUTING = "COMPUTING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
