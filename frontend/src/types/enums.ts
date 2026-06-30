export type MissionStatus =
  | "DRAFT"
  | "PLANNED"
  | "VALIDATED"
  | "EXPORTED"
  | "MEASURED"
  | "COMPLETED"
  | "CANCELLED";

export type WaypointType =
  | "TAKEOFF"
  | "TRANSIT"
  | "MEASUREMENT"
  | "HOVER"
  | "LANDING";

export type CameraAction =
  | "NONE"
  | "PHOTO_CAPTURE"
  | "RECORDING_START"
  | "RECORDING"
  | "RECORDING_STOP";

export type CaptureMode = "VIDEO_CAPTURE" | "PHOTO_CAPTURE";

export type InspectionMethod =
  | "VERTICAL_PROFILE"
  | "HORIZONTAL_RANGE"
  | "APPROACH_DESCENT"
  | "FLY_OVER"
  | "PARALLEL_SIDE_SWEEP"
  | "HOVER_POINT_LOCK"
  | "MEHT_CHECK"
  | "SURFACE_SCAN";

export type ScanLengthMode = "FULL" | "MAX_LENGTH" | "INTERVAL";

export type ScanLengthAnchor = "THRESHOLD" | "ENDPOINT";

export type ScanWidthSide = "LEFT" | "RIGHT";

export type ScanRunOrientation = "LENGTH_WISE" | "WIDTH_WISE";

export type SafetyZoneType =
  | "CTR"
  | "RESTRICTED"
  | "PROHIBITED"
  | "TEMPORARY_NO_FLY"
  | "AIRPORT_BOUNDARY";

export type ObstacleType =
  | "BUILDING"
  | "TOWER"
  | "ANTENNA"
  | "VEGETATION"
  | "OTHER";

export type LampType = "HALOGEN" | "LED";

export type PAPISide = "LEFT" | "RIGHT";

export type SurfaceType = "RUNWAY" | "TAXIWAY";

export type FlightPlanScope = "FULL" | "MEASUREMENTS_ONLY";

export type ComputationStatus = "IDLE" | "COMPUTING" | "COMPLETED" | "FAILED";

export type UserRole = "OPERATOR" | "COORDINATOR" | "SUPER_ADMIN";

export type TerrainSource = "FLAT" | "DEM_UPLOAD" | "DEM_API";
