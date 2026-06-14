// per-light line colors for the recharts results charts.
//
// these hex literals mirror the --tv-inspection-* tokens in index.css. recharts
// applies stroke/fill as SVG presentation attributes, which do not resolve CSS
// var() references, so the raw hex has to live here - same compromise as
// `src/constants/palette.ts` for the maplibre paint layer. keep in sync with
// --tv-inspection-1..4 / --tv-text-muted / --tv-border.

export const LIGHT_COLORS: Record<string, string> = {
  PAPI_A: "#4595e5",
  PAPI_B: "#3bbb3b",
  PAPI_C: "#e5a545",
  PAPI_D: "#9b59b6",
};

export const FALLBACK_LIGHT_COLOR = "#6b6b6b";

// chart chrome (axis, grid) - mirrors --tv-text-muted / --tv-border
export const CHART_AXIS_COLOR = "#757575";
export const CHART_GRID_COLOR = "#e9e9e9";

export function lightColor(name: string): string {
  return LIGHT_COLORS[name] ?? FALLBACK_LIGHT_COLOR;
}
