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
  // iteration grouping - linked re-flies of the same inspection share a group
  iteration_group_id: string | null;
  iteration_index: number | null;
  created_at: string | null;
  has_results: boolean;
  pass_count: number;
  fail_count: number;
  error_message: string | null;
}

// partial update for a measurement - sets/clears its free-text label
export interface MeasurementUpdate {
  label: string | null;
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
  iteration_group_id: string | null;
  iteration_index: number | null;
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
  iteration_group_id: string | null;
  iteration_index: number | null;
  inspection_method: InspectionMethod | null;
  inspection_sequence_order: number | null;
  runway_heading: number | null;
  reference_points: ReferencePoint[];
  summaries: LightSummary[];
  lights: LightSeries[];
  drone_path: DronePathPoint[];
  video_urls: Record<string, string>;
}

// one run in an iteration group - the row the iteration switcher lists
export interface MeasurementIteration {
  id: string;
  iteration_index: number | null;
  label: string | null;
  status: MeasurementStatus;
  created_at: string | null;
  has_results: boolean;
  pass_count: number;
  fail_count: number;
}

// one iteration's identity - the column header of the convergence table
export interface IterationMeta {
  id: string;
  iteration_index: number | null;
  label: string | null;
  status: MeasurementStatus;
  created_at: string | null;
}

// one light's measured value for one iteration, plus its delta + verdict change
export interface IterationCompareCell {
  iteration_index: number | null;
  measured_transition_angle: number | null;
  passed: boolean | null;
  delta_from_setpoint: number | null;
  verdict_changed_to_pass: boolean;
}

// one iteration's per-frame timeseries for a single light, for the overlay charts
export interface IterationSeries {
  iteration_index: number | null;
  transition_angle_min: number | null;
  transition_angle_middle: number | null;
  transition_angle_max: number | null;
  points: LightSeriesPoint[];
}

// one PAPI light's convergence across the group - setpoint, cells, overlay series
export interface LightComparison {
  light_name: string;
  setting_angle: number | null;
  tolerance: number | null;
  cells: IterationCompareCell[];
  series: IterationSeries[];
}

// N-way convergence payload - per-light cells + overlay series across iterations
export interface IterationCompare {
  group_id: string;
  iterations: IterationMeta[];
  lights: LightComparison[];
}
