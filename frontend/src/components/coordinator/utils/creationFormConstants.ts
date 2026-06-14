export type PendingGeometryType = "polygon" | "circle" | "point";

export type CategoryPolygon = "surface" | "safety_zone" | "obstacle";
export type CategoryPoint = "agl" | "lha";
export type Category = CategoryPolygon | CategoryPoint;

export type EntityType =
  | "runway"
  | "taxiway"
  | "safety_zone_ctr"
  | "safety_zone_restricted"
  | "safety_zone_prohibited"
  | "safety_zone_no_fly"
  | "safety_zone_airport_boundary"
  | "obstacle"
  | "agl"
  | "lha";

export const POLYGON_CATEGORIES: { value: CategoryPolygon; labelKey: string }[] = [
  { value: "surface", labelKey: "coordinator.creation.categorySurface" },
  { value: "safety_zone", labelKey: "coordinator.creation.categorySafetyZone" },
  { value: "obstacle", labelKey: "coordinator.creation.categoryObstacle" },
];

export const CIRCLE_CATEGORIES: { value: CategoryPolygon; labelKey: string }[] = [
  { value: "safety_zone", labelKey: "coordinator.creation.categorySafetyZone" },
  { value: "obstacle", labelKey: "coordinator.creation.categoryObstacle" },
];

export const POINT_CATEGORIES: { value: CategoryPoint; labelKey: string }[] = [
  { value: "agl", labelKey: "coordinator.creation.categoryAgl" },
  { value: "lha", labelKey: "coordinator.creation.categoryLha" },
];

export const SURFACE_SUBTYPES: { value: EntityType; labelKey: string }[] = [
  { value: "runway", labelKey: "coordinator.creation.typeRunway" },
  { value: "taxiway", labelKey: "coordinator.creation.typeTaxiway" },
];

export const SAFETY_ZONE_SUBTYPES: { value: EntityType; labelKey: string }[] = [
  { value: "safety_zone_ctr", labelKey: "coordinator.creation.typeSafetyZoneCtr" },
  { value: "safety_zone_restricted", labelKey: "coordinator.creation.typeSafetyZoneRestricted" },
  { value: "safety_zone_prohibited", labelKey: "coordinator.creation.typeSafetyZoneProhibited" },
  { value: "safety_zone_no_fly", labelKey: "coordinator.creation.typeSafetyZoneNoFly" },
  {
    value: "safety_zone_airport_boundary",
    labelKey: "coordinator.creation.typeSafetyZoneAirportBoundary",
  },
];

export const SAFETY_ZONE_TYPE_MAP: Record<string, string> = {
  safety_zone_ctr: "CTR",
  safety_zone_restricted: "RESTRICTED",
  safety_zone_prohibited: "PROHIBITED",
  safety_zone_no_fly: "TEMPORARY_NO_FLY",
  safety_zone_airport_boundary: "AIRPORT_BOUNDARY",
};

export const OBSTACLE_SUBTYPES: { value: string; labelKey: string }[] = [
  { value: "BUILDING", labelKey: "coordinator.detail.obstacleTypes.building" },
  { value: "ANTENNA", labelKey: "coordinator.detail.obstacleTypes.antenna" },
  { value: "VEGETATION", labelKey: "coordinator.detail.obstacleTypes.vegetation" },
  { value: "TOWER", labelKey: "coordinator.detail.obstacleTypes.tower" },
  { value: "OTHER", labelKey: "coordinator.detail.obstacleTypes.other" },
];
