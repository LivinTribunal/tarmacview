import { Color } from "cesium";
import type { ObstacleType, SurfaceType } from "@/types/enums";
import {
  OBSTACLE_COLORS,
  SAFETY_BUFFER_COLORS,
  SURFACE_COLORS,
  TRAJECTORY_COLORS,
  ZONE_COLORS,
} from "@/constants/palette";

// design system colors mapped to cesium color instances. canonical hex
// strings live in `src/constants/palette.ts` so the 2D MapLibre view and
// the 3D Cesium view never drift apart.

// surfaces
export const RUNWAY_FILL = Color.fromCssColorString(SURFACE_COLORS.RUNWAY_FILL).withAlpha(0.6);
export const RUNWAY_OUTLINE = Color.fromCssColorString(SURFACE_COLORS.RUNWAY_OUTLINE);
export const TAXIWAY_FILL = Color.fromCssColorString(SURFACE_COLORS.TAXIWAY_FILL).withAlpha(0.4);
export const TAXIWAY_OUTLINE = Color.fromCssColorString(SURFACE_COLORS.TAXIWAY_OUTLINE).withAlpha(
  0.6,
);

// centerlines
export const RUNWAY_CENTERLINE = Color.fromCssColorString(SURFACE_COLORS.RUNWAY_CENTERLINE).withAlpha(
  0.7,
);
export const TAXIWAY_CENTERLINE = Color.fromCssColorString(SURFACE_COLORS.TAXIWAY_CENTERLINE).withAlpha(
  0.6,
);

// safety zones by type
export const SAFETY_ZONE_COLORS: Record<string, { fill: Color; outline: Color }> = {
  CTR: {
    fill: Color.fromCssColorString(ZONE_COLORS.CTR).withAlpha(0.1),
    outline: Color.fromCssColorString(ZONE_COLORS.CTR).withAlpha(0.5),
  },
  RESTRICTED: {
    fill: Color.fromCssColorString(ZONE_COLORS.RESTRICTED).withAlpha(0.1),
    outline: Color.fromCssColorString(ZONE_COLORS.RESTRICTED).withAlpha(0.5),
  },
  PROHIBITED: {
    fill: Color.fromCssColorString(ZONE_COLORS.PROHIBITED).withAlpha(0.1),
    outline: Color.fromCssColorString(ZONE_COLORS.PROHIBITED).withAlpha(0.5),
  },
  TEMPORARY_NO_FLY: {
    fill: Color.fromCssColorString(ZONE_COLORS.TEMPORARY_NO_FLY).withAlpha(0.1),
    outline: Color.fromCssColorString(ZONE_COLORS.TEMPORARY_NO_FLY).withAlpha(0.5),
  },
};

// obstacles - single color (legacy)
export const OBSTACLE_BODY = Color.fromCssColorString(OBSTACLE_COLORS.BUILDING.fill).withAlpha(0.7);
export const OBSTACLE_BUFFER = Color.fromCssColorString(OBSTACLE_COLORS.BUILDING.fill).withAlpha(0.1);

// per-type obstacle colors matching 2d layer palette
export const OBSTACLE_TYPE_COLORS: Record<ObstacleType, { fill: Color; outline: Color }> = {
  BUILDING: {
    fill: Color.fromCssColorString(OBSTACLE_COLORS.BUILDING.fill).withAlpha(0.7),
    outline: Color.fromCssColorString(OBSTACLE_COLORS.BUILDING.outline),
  },
  TOWER: {
    fill: Color.fromCssColorString(OBSTACLE_COLORS.TOWER.fill).withAlpha(0.7),
    outline: Color.fromCssColorString(OBSTACLE_COLORS.TOWER.outline),
  },
  ANTENNA: {
    fill: Color.fromCssColorString(OBSTACLE_COLORS.ANTENNA.fill).withAlpha(0.7),
    outline: Color.fromCssColorString(OBSTACLE_COLORS.ANTENNA.outline),
  },
  VEGETATION: {
    fill: Color.fromCssColorString(OBSTACLE_COLORS.VEGETATION.fill).withAlpha(0.7),
    outline: Color.fromCssColorString(OBSTACLE_COLORS.VEGETATION.outline),
  },
  OTHER: {
    fill: Color.fromCssColorString(OBSTACLE_COLORS.OTHER.fill).withAlpha(0.7),
    outline: Color.fromCssColorString(OBSTACLE_COLORS.OTHER.outline),
  },
};

// surface buffer zone colors matching 2d layer palette
export const SURFACE_BUFFER_COLORS: Record<SurfaceType, { fill: Color; outline: Color }> = {
  RUNWAY: {
    fill: Color.fromCssColorString(SAFETY_BUFFER_COLORS.RUNWAY).withAlpha(0.1),
    outline: Color.fromCssColorString(SAFETY_BUFFER_COLORS.RUNWAY).withAlpha(0.5),
  },
  TAXIWAY: {
    fill: Color.fromCssColorString(SAFETY_BUFFER_COLORS.TAXIWAY).withAlpha(0.1),
    outline: Color.fromCssColorString(SAFETY_BUFFER_COLORS.TAXIWAY).withAlpha(0.5),
  },
};

// agl systems
export const AGL_COLOR = Color.fromCssColorString(TRAJECTORY_COLORS.ACCENT_MAGENTA);

// keep parity with utils/aglColor.ts → 2D map uses the same palette
const AGL_COLOR_BY_TYPE: Record<string, Color> = {
  PAPI: Color.fromCssColorString(TRAJECTORY_COLORS.ACCENT_MAGENTA),
  RUNWAY_EDGE_LIGHTS: Color.fromCssColorString("#f7b32b"),
};

/** cesium color matching utils/aglColor.ts. */
export function aglCesiumColor(aglType: string | null | undefined): Color {
  if (!aglType) return AGL_COLOR;
  return AGL_COLOR_BY_TYPE[aglType] ?? AGL_COLOR;
}

// waypoint inspection colors
export const INSPECTION_COLORS = [
  Color.fromCssColorString(TRAJECTORY_COLORS.PATH),
  Color.fromCssColorString(ZONE_COLORS.CTR),
  Color.fromCssColorString(ZONE_COLORS.RESTRICTED),
  Color.fromCssColorString(OBSTACLE_COLORS.TOWER.fill),
  Color.fromCssColorString(OBSTACLE_COLORS.BUILDING.fill),
];
export const TRANSIT_COLOR = Color.fromCssColorString("#7eb8e5");
export const MEASUREMENT_COLOR = Color.fromCssColorString(TRAJECTORY_COLORS.PATH);

// takeoff / landing
export const TAKEOFF_COLOR = Color.fromCssColorString(TRAJECTORY_COLORS.PATH);
export const LANDING_COLOR = Color.fromCssColorString(OBSTACLE_COLORS.BUILDING.fill);
