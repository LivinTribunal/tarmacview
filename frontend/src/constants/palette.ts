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
