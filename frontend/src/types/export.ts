/** mirror of backend `app.schemas.export.AltitudeClamp`. */
export interface AltitudeClamp {
  waypoint_index: number;
  intended_alt: number;
  clamped_alt: number;
  reason: "below_takeoff";
}

/** mirror of backend `app.schemas.export.ExportResponse`. */
export interface ExportResponse {
  altitude_clamps: AltitudeClamp[];
}

/** surfaced to `ExportPanel` when the backend refused the file pending ack. */
export interface ExportClampWarning {
  kind: "clamp_warning";
  clamps: AltitudeClamp[];
}
