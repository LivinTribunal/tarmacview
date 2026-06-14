// measurement results types - mirror app/schemas/measurement.py results DTOs

export type MeasurementStatus =
  | "QUEUED"
  | "FIRST_FRAME"
  | "AWAITING_CONFIRM"
  | "PROCESSING"
  | "DONE"
  | "ERROR";

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
  runway_heading: number | null;
  reference_points: ReferencePoint[];
  summaries: LightSummary[];
  lights: LightSeries[];
  drone_path: DronePathPoint[];
  video_urls: Record<string, string>;
}
