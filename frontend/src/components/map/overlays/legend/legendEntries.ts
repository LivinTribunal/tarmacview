import type { MissionStatus } from "@/types/enums";

export type SwatchType =
  | "rectangle"
  | "runway"
  | "taxiway"
  | "circle"
  | "circle-outline"
  | "circle-border"
  | "triangle"
  | "dashed-hatch"
  | "dashed-rectangle"
  | "tower"
  | "antenna"
  | "tree"
  | "rounded-square-letter"
  | "hover-icon"
  | "line-arrow";

export interface LegendItem {
  key: string;
  i18nKey: string;
  swatch: SwatchType;
  color: string;
  size?: "sm" | "md";
  letter?: string;
}

// ground surfaces
export const surfaceItems: LegendItem[] = [
  { key: "runway", i18nKey: "dashboard.runways", swatch: "runway", color: "#4a4a4a" },
  { key: "taxiway", i18nKey: "dashboard.taxiways", swatch: "taxiway", color: "#c8a83c" },
];

// safety zones - crosshatched swatches
export const zoneItems: LegendItem[] = [
  { key: "ctr", i18nKey: "dashboard.ctr", swatch: "dashed-hatch", color: "#4595e5" },
  { key: "restricted", i18nKey: "dashboard.restricted", swatch: "dashed-hatch", color: "#e5a545" },
  { key: "prohibited", i18nKey: "dashboard.prohibited", swatch: "dashed-hatch", color: "#e54545" },
  { key: "temporaryNoFly", i18nKey: "dashboard.temporaryNoFly", swatch: "dashed-hatch", color: "#e5e545" },
  { key: "airportBoundary", i18nKey: "boundary.airportBoundary", swatch: "dashed-rectangle", color: "#ffffff" },
];

// obstacles - per-type icons matching map symbology
export const obstacleItems: LegendItem[] = [
  { key: "building", i18nKey: "dashboard.building", swatch: "triangle", color: "#e54545" },
  { key: "tower", i18nKey: "dashboard.tower", swatch: "tower", color: "#9b59b6" },
  { key: "antenna", i18nKey: "dashboard.antenna", swatch: "antenna", color: "#e5a545" },
  { key: "vegetation", i18nKey: "dashboard.vegetation", swatch: "tree", color: "#3bbb3b" },
  { key: "other", i18nKey: "dashboard.other", swatch: "triangle", color: "#6b6b6b" },
];

// agl systems grouped by type
export const papiItems: LegendItem[] = [
  { key: "papi-lha", i18nKey: "dashboard.papiLha", swatch: "circle", color: "#e91e90", size: "sm" },
];

export const relItems: LegendItem[] = [
  { key: "rel-lha", i18nKey: "dashboard.relLha", swatch: "circle", color: "#f7b32b", size: "sm" },
];

// flight plan - takeoff/landing only
export const takeoffLandingItems: LegendItem[] = [
  { key: "takeoff", i18nKey: "dashboard.waypointTakeoff", swatch: "rounded-square-letter", color: "#4595e5", letter: "T" },
  { key: "landing", i18nKey: "dashboard.waypointLanding", swatch: "rounded-square-letter", color: "#e54545", letter: "L" },
];

// flight plan - all waypoint types
export const allWaypointItems: LegendItem[] = [
  { key: "measurement", i18nKey: "dashboard.measurement", swatch: "circle-outline", color: "#3bbb3b" },
  { key: "transit", i18nKey: "dashboard.transit", swatch: "circle-border", color: "#ffffff" },
  { key: "hover", i18nKey: "dashboard.hover", swatch: "hover-icon", color: "#e5a545" },
  { key: "transit-path", i18nKey: "dashboard.transitPath", swatch: "line-arrow", color: "#7eb8e5" },
  ...takeoffLandingItems,
];

export const STATUSES_WITH_FULL_WAYPOINTS: MissionStatus[] = [
  "PLANNED",
  "VALIDATED",
  "EXPORTED",
  "COMPLETED",
];
