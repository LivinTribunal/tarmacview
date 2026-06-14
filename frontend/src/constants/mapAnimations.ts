// MapLibre easeTo / flyTo animation defaults. centralised so airport
// transitions, zoom-to-feature, and the cesium 3D fly-along all share
// the same cadence without scattering 1500ms / 12 / 45 magic numbers
// across the map components.

export const MAP_QUICK_DURATION_MS = 800;
export const MAP_ZOOM_FOCUS = 17;
export const MAP_PITCH_2D = 0;

// pitch / bearing toggles
export const MAP_PITCH_3D = 60;
export const MAP_PITCH_TOGGLE_DURATION_MS = 400;
export const MAP_BEARING_RESET_DURATION_MS = 400;

// keyboard / button-driven zoom and pan
export const MAP_ZOOM_TICK_DURATION_MS = 300;
export const MAP_PAN_DURATION_MS = 200;

// initial viewport + click-to-focus zoom level
export const MAP_ZOOM_INITIAL_DEFAULT = 14.5;
