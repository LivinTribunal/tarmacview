// canonical hex palette for map and 3D rendering.
//
// these literals exist here (rather than only in `index.css`) because the
// MapLibre style spec and Cesium's `Color.fromCssColorString` need raw hex
// strings at render time, before the browser has resolved CSS variables.
// keep these in sync with the matching `--tv-zone-*` and obstacle CSS
// variables in `src/index.css`.

export const ZONE_COLORS: Record<string, string> = {
  CTR: "#4595e5",
  RESTRICTED: "#e5a545",
  PROHIBITED: "#e54545",
  TEMPORARY_NO_FLY: "#e5e545",
};

export const ZONE_FALLBACK_COLOR = "#6b6b6b";

export const OBSTACLE_COLORS: Record<string, { fill: string; outline: string }> = {
  BUILDING: { fill: "#e54545", outline: "#e54545" },
  TOWER: { fill: "#9b59b6", outline: "#9b59b6" },
  ANTENNA: { fill: "#e5a545", outline: "#e5a545" },
  VEGETATION: { fill: "#3bbb3b", outline: "#3bbb3b" },
  OTHER: { fill: "#6b6b6b", outline: "#6b6b6b" },
};

export const SURFACE_COLORS = {
  RUNWAY_FILL: "#4a4a4a",
  RUNWAY_OUTLINE: "#6a6a6a",
  TAXIWAY_FILL: "#c8a83c",
  TAXIWAY_OUTLINE: "#c8a83c",
  RUNWAY_CENTERLINE: "#ffffff",
  TAXIWAY_CENTERLINE: "#1a1a1a",
};

export const TRAJECTORY_COLORS = {
  PATH: "#3bbb3b",
  ACCENT_MAGENTA: "#e91e90",
};

// agl system colors. mirrors --tv-accent-magenta / --tv-agl-runway-edge in
// index.css; duplicated here because maplibre paint resolves before css does.
export const AGL_COLORS = {
  PAPI: TRAJECTORY_COLORS.ACCENT_MAGENTA,
  RUNWAY_EDGE_LIGHTS: "#f7b32b",
  DEFAULT: TRAJECTORY_COLORS.ACCENT_MAGENTA,
};

// matches --tv-waypoint-highlight / --tv-waypoint-highlight-halo in index.css.
// duplicated here because maplibre paint values must resolve before css does.
export const WAYPOINT_HIGHLIGHT_COLORS = {
  HIGHLIGHT: "#ff6b00",
  HALO: "#ffffff",
};

export const INSPECTION_HIGHLIGHT_COLOR = "#3b82f6";

// per-light line colors for the recharts results charts. mirror the
// --tv-inspection-1..4 tokens in index.css; recharts applies stroke/fill as
// svg presentation attributes which do not resolve css var(), so the raw hex
// must live here alongside the maplibre palette.
export const INSPECTION_LIGHT_COLORS: Record<string, string> = {
  PAPI_A: "#4595e5",
  PAPI_B: "#3bbb3b",
  PAPI_C: "#e5a545",
  PAPI_D: "#9b59b6",
};

export const INSPECTION_LIGHT_FALLBACK_COLOR = "#6b6b6b";

// one distinct line color per iteration on the convergence overlay charts; indexed
// by iteration order and wrapping past the end. raw hex for the same recharts reason.
export const ITERATION_SERIES_COLORS = [
  "#4595e5",
  "#e5a545",
  "#3bbb3b",
  "#9b59b6",
  "#e54545",
  "#1ab5b5",
];

// results chart chrome (axis, grid) - mirrors --tv-text-muted / --tv-border
export const CHART_COLORS = {
  AXIS: "#757575",
  GRID: "#e9e9e9",
};

// PAPI transition-zone shading on the per-light angle chart: below the transition
// middle the light reads red, above it reads white. low-opacity fills so the bands
// of all four lights can overlap without muddying the lines.
export const CHART_ZONE_COLORS = {
  RED: "#e54545",
  WHITE: "#9aa7bd",
};

// qr modules must stay true black regardless of theme so scanners read them
// reliably, so this is a fixed hex rather than a --tv-* variable.
export const QR_DARK = "#000000";

export const SAFETY_BUFFER_COLORS: Record<string, string> = {
  RUNWAY: "#3b82f6",
  TAXIWAY: "#8b5cf6",
};

// map tool chrome - kept separate from zone/obstacle palette so tool
// overlays (heading line, transit-insert hover ring) never read as airspace.
export const HEADING_TOOL_COLOR = "#4595e5";
export const TRANSIT_HOVER_RING_COLOR = "#e54545";

export const NEUTRAL = {
  WHITE: "#ffffff",
  BLACK: "#000000",
  MUTED: "#6b6b6b",
  BORDER: "#888888",
};
