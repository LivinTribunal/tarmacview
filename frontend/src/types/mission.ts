import type { PointZ } from "./common";
import type {
  CaptureMode,
  ComputationStatus,
  FlightPlanScope,
  InspectionMethod,
  MissionStatus,
  ScanLengthMode,
  ScanRunOrientation,
  ScanWidthSide,
} from "./enums";

export type CameraMode = "AUTO" | "MANUAL";

export type InspectionDirection = "NATURAL" | "REVERSED";

export type MissionDirection = "AUTO" | "NATURAL" | "REVERSED";

export type DjiHeadingMode = "smoothTransition" | "towardPOI" | "followWayline";

export type LhaSelectionMode = "ALL" | "RANGE" | "FROM_THRESHOLD" | "CUSTOM";

export type AngleSource = "PAPI" | "CUSTOM";

export type ThresholdAnchor = "START" | "END";

export interface LhaSelectionRangeParams {
  from: number | null;
  to: number | null;
}

export interface LhaSelectionFromThresholdParams {
  threshold: ThresholdAnchor;
  distance_m: number;
}

export type LhaSelectionRule =
  | { mode: "ALL" }
  | { mode: "RANGE"; params: LhaSelectionRangeParams }
  | { mode: "FROM_THRESHOLD"; params: LhaSelectionFromThresholdParams }
  | { mode: "CUSTOM" };

export type LhaSelectionRules = Record<string, LhaSelectionRule>;

export interface MissionResponse {
  id: string;
  name: string;
  status: MissionStatus;
  airport_id: string;
  created_at: string;
  updated_at: string;
  operator_notes: string | null;
  drone_profile_id: string | null;
  date_time: string | null;
  default_speed: number | null;
  measurement_speed_override: number | null;
  default_altitude_offset: number | null;
  takeoff_coordinate: PointZ | null;
  landing_coordinate: PointZ | null;
  default_capture_mode: CaptureMode | null;
  default_buffer_distance: number | null;
  camera_mode: CameraMode;
  default_white_balance: string | null;
  default_iso: number | null;
  default_shutter_speed: string | null;
  default_focus_mode: "AUTO" | "INFINITY" | null;
  transit_agl: number | null;
  require_perpendicular_runway_crossing: boolean;
  keep_inside_airport_boundary: boolean;
  flight_plan_scope: FlightPlanScope;
  direction: MissionDirection;
  has_unsaved_map_changes: boolean;
  computation_status: ComputationStatus;
  computation_error: string | null;
  computation_started_at: string | null;
  inspection_count: number;
  estimated_duration: number | null;
  supports_geozone_upload?: boolean | null;
  dji_heading_mode?: DjiHeadingMode | null;
}

export interface MissionDetailResponse extends MissionResponse {
  inspections: InspectionResponse[];
}

// surface-scan fields, mirrored once by the ScanConfigFields backend mixin
export interface ScanConfigFields {
  scan_surface_id: string | null;
  scan_length_mode: ScanLengthMode | null;
  scan_length_from: number | null;
  scan_length_to: number | null;
  scan_width: number | null;
  scan_width_side: ScanWidthSide | null;
  scan_height: number | null;
  scan_run_count: number | null;
  scan_run_orientation: ScanRunOrientation | null;
  scan_sidelap_percent: number | null;
}

// runtime key list driving the autosave echo/reset hydration
export const SCAN_FIELDS = [
  "scan_surface_id",
  "scan_length_mode",
  "scan_length_from",
  "scan_length_to",
  "scan_width",
  "scan_width_side",
  "scan_height",
  "scan_run_count",
  "scan_run_orientation",
  "scan_sidelap_percent",
] as const satisfies readonly (keyof ScanConfigFields)[];

export type ScanField = (typeof SCAN_FIELDS)[number];

// shared core mirrored by the template-side InspectionConfigResponse in inspectionTemplate.ts
export interface BaseInspectionConfigFields extends ScanConfigFields {
  altitude_offset: number | null;
  angle_offset_above: number | null;
  angle_offset_below: number | null;
  measurement_speed_override: number | null;
  measurement_density: number | null;
  custom_tolerances: Record<string, number> | null;
  hover_duration: number | null;
  horizontal_distance: number | null;
  sweep_angle: number | null;
  angle_source: AngleSource | null;
  angle_start: number | null;
  angle_end: number | null;
  lha_ids: string[] | null;
  lha_selection_rules: LhaSelectionRules | null;
  capture_mode: CaptureMode | null;
  recording_setup_duration: number | null;
  buffer_distance: number | null;
  height_above_lights: number | null;
  lateral_offset: number | null;
  distance_from_lha: number | null;
  height_above_lha: number | null;
  camera_gimbal_angle: number | null;
  selected_lha_id: string | null;
  lha_setting_angle_override_id: string | null;
  hover_bearing: number | null;
  hover_bearing_reference: "RUNWAY" | "COMPASS" | null;
  descent_start_distance: number | null;
  descent_glide_slope_override: number | null;
  direction: InspectionDirection | null;
  resolved_direction: InspectionDirection | null;
  white_balance: string | null;
  iso: number | null;
  shutter_speed: string | null;
  focus_mode: "AUTO" | "INFINITY" | null;
  optical_zoom: number | null;
}

export interface InspectionConfigResponse extends BaseInspectionConfigFields {
  camera_mode: CameraMode | null;
  camera_preset_id: string | null;
}

export interface InspectionResponse {
  id: string;
  mission_id: string;
  template_id: string;
  config_id: string | null;
  method: InspectionMethod;
  sequence_order: number;
  lha_ids: string[] | null;
  config: InspectionConfigResponse | null;
}

export interface InspectionConfigOverride extends Partial<ScanConfigFields> {
  altitude_offset?: number | null;
  angle_offset_above?: number | null;
  angle_offset_below?: number | null;
  measurement_speed_override?: number | null;
  measurement_density?: number | null;
  custom_tolerances?: Record<string, number> | null;
  hover_duration?: number | null;
  horizontal_distance?: number | null;
  sweep_angle?: number | null;
  angle_source?: AngleSource | null;
  angle_start?: number | null;
  angle_end?: number | null;
  lha_ids?: string[] | null;
  lha_selection_rules?: LhaSelectionRules | null;
  capture_mode?: CaptureMode | null;
  recording_setup_duration?: number | null;
  buffer_distance?: number | null;
  height_above_lights?: number | null;
  lateral_offset?: number | null;
  distance_from_lha?: number | null;
  height_above_lha?: number | null;
  camera_gimbal_angle?: number | null;
  selected_lha_id?: string | null;
  lha_setting_angle_override_id?: string | null;
  hover_bearing?: number | null;
  hover_bearing_reference?: "RUNWAY" | "COMPASS" | null;
  descent_start_distance?: number | null;
  descent_glide_slope_override?: number | null;
  camera_mode?: CameraMode | null;
  direction?: InspectionDirection | null;
  white_balance?: string | null;
  iso?: number | null;
  shutter_speed?: string | null;
  focus_mode?: "AUTO" | "INFINITY" | null;
  optical_zoom?: number | null;
  camera_preset_id?: string | null;
}

export interface MissionCreate {
  name: string;
  airport_id: string;
  operator_notes?: string | null;
  drone_profile_id?: string | null;
  date_time?: string | null;
  default_speed?: number | null;
  measurement_speed_override?: number | null;
  default_altitude_offset?: number | null;
  takeoff_coordinate?: PointZ | null;
  landing_coordinate?: PointZ | null;
  default_capture_mode?: CaptureMode | null;
  default_buffer_distance?: number | null;
  camera_mode?: CameraMode;
  default_white_balance?: string | null;
  default_iso?: number | null;
  default_shutter_speed?: string | null;
  default_focus_mode?: "AUTO" | "INFINITY" | null;
  transit_agl?: number | null;
  require_perpendicular_runway_crossing?: boolean;
  keep_inside_airport_boundary?: boolean;
  flight_plan_scope?: FlightPlanScope;
  direction?: MissionDirection;
  dji_heading_mode?: DjiHeadingMode | null;
}

export interface MissionUpdate {
  name?: string;
  operator_notes?: string | null;
  drone_profile_id?: string | null;
  date_time?: string | null;
  default_speed?: number | null;
  measurement_speed_override?: number | null;
  default_altitude_offset?: number | null;
  takeoff_coordinate?: PointZ | null;
  landing_coordinate?: PointZ | null;
  default_capture_mode?: CaptureMode | null;
  default_buffer_distance?: number | null;
  camera_mode?: CameraMode;
  default_white_balance?: string | null;
  default_iso?: number | null;
  default_shutter_speed?: string | null;
  default_focus_mode?: "AUTO" | "INFINITY" | null;
  transit_agl?: number | null;
  require_perpendicular_runway_crossing?: boolean;
  keep_inside_airport_boundary?: boolean;
  flight_plan_scope?: FlightPlanScope;
  direction?: MissionDirection;
  dji_heading_mode?: DjiHeadingMode | null;
}

export interface InspectionCreate {
  template_id: string;
  method: InspectionMethod;
  config?: InspectionConfigOverride | null;
}

export interface InspectionUpdate {
  method?: InspectionMethod;
  sequence_order?: number;
  config?: InspectionConfigOverride | null;
}

export interface ReorderRequest {
  inspection_ids: string[];
}

export interface ComputationStatusResponse {
  computation_status: ComputationStatus;
  computation_error: string | null;
  computation_started_at: string | null;
}
