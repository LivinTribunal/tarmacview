// measurement results types - mirror app/schemas/measurement.py results DTOs

import type { InspectionMethod } from "./enums";

export type MeasurementStatus =
  | "QUEUED"
  | "FIRST_FRAME"
  | "AWAITING_CONFIRM"
  | "PROCESSING"
  | "DONE"
  | "ERROR";

// one row of the airport measurements list - status + mission/inspection context + rollup
export interface MeasurementListItem {
  id: string;
  inspection_id: string;
  mission_id: string;
  mission_name: string;
  inspection_method: InspectionMethod;
  inspection_sequence_order: number;
  status: MeasurementStatus;
  // operator-supplied run name; blank falls back to the inspection label
  label: string | null;
  created_at: string | null;
  has_results: boolean;
  pass_count: number;
  fail_count: number;
  error_message: string | null;
}

export interface ReferencePoint {
  light_name: string;
  latitude: number;
  longitude: number;
  elevation: number;
  lha_id: string | null;
  unit_designator: string | null;
  setting_angle: number | null;
  tolerance: number | null;
}

// one PAPI light's box on the first frame, in percentage coordinates (center + size)
export interface LightBox {
  light_name: string;
  x: number;
  y: number;
  size: number;
}

// lightweight progress poll - status doubles as the phase
export interface MeasurementStatusResponse {
  id: string;
  status: MeasurementStatus;
  error_message: string | null;
}

// first-frame image (presigned GET) + the detected/pre-placed boxes to confirm
export interface MeasurementPreview {
  id: string;
  status: MeasurementStatus;
  first_frame_url: string | null;
  boxes: LightBox[];
}

// the fields the start/confirm flow reads off the full aggregate response
export interface Measurement {
  id: string;
  inspection_id: string;
  status: MeasurementStatus;
  label: string | null;
  error_message: string | null;
}

export interface LightSummary {
  light_name: string;
  setting_angle: number | null;
  tolerance: number | null;
  measured_transition_angle: number | null;
  passed: boolean | null;
}

export interface LightSeriesPoint {
  frame_number: number;
  timestamp: number;
  status: string | null;
  angle: number | null;
  horizontal_angle: number | null;
  intensity: number | null;
  area_pixels: number | null;
  // chromaticity derived from the per-frame rgb triple (normalized r/g)
  chromaticity_x: number | null;
  chromaticity_y: number | null;
  // raw per-frame rgb (0-255) the chromaticity is derived from
  red: number | null;
  green: number | null;
  blue: number | null;
  // ground distance from the drone to the light, meters
  distance_ground: number | null;
}

export interface LightSeries {
  light_name: string;
  setting_angle: number | null;
  tolerance: number | null;
  transition_angle_min: number | null;
  transition_angle_middle: number | null;
  transition_angle_max: number | null;
  passed: boolean | null;
  points: LightSeriesPoint[];
}

export interface DronePathPoint {
  frame_number: number;
  timestamp: number;
  latitude: number;
  longitude: number;
  elevation: number | null;
}

export interface MeasurementResults {
  id: string;
  inspection_id: string;
  status: MeasurementStatus;
  has_results: boolean;
  // run name + inspection context for the results-header blank-label fallback
  label: string | null;
  inspection_method: InspectionMethod | null;
  inspection_sequence_order: number | null;
  runway_heading: number | null;
  // measured glidepath (mid of PAPI_B max / PAPI_C min) vs the snapshotted
  // configured glide slope ± tolerance, plus the within-tolerance verdict
  measured_glide_slope_angle: number | null;
  configured_glide_slope_angle: number | null;
  glide_slope_angle_tolerance: number | null;
  glide_slope_within_tolerance: boolean | null;
  reference_points: ReferencePoint[];
  summaries: LightSummary[];
  lights: LightSeries[];
  drone_path: DronePathPoint[];
  video_urls: Record<string, string>;
}
