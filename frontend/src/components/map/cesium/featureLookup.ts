import type { AirportDetailResponse } from "@/types/airport";
import type { WaypointResponse } from "@/types/flightPlan";
import type { PointZ } from "@/types/common";
import type { MapFeature, MapFeatureType } from "@/types/map";

const VALID_FEATURE_TYPES: ReadonlySet<string> = new Set<MapFeatureType>([
  "surface", "obstacle", "safety_zone", "agl", "lha", "waypoint",
]);

/** type guard to validate a raw string is a known map feature type. */
export function isMapFeatureType(value: unknown): value is MapFeatureType {
  return typeof value === "string" && VALID_FEATURE_TYPES.has(value);
}

/** look up full entity data from airport/waypoints by type and id to construct a proper MapFeature. */
export function lookupFeature(
  airport: AirportDetailResponse,
  type: MapFeatureType,
  id: string,
  waypoints?: WaypointResponse[],
  takeoffCoord?: PointZ | null,
  landingCoord?: PointZ | null,
): MapFeature | null {
  switch (type) {
    case "surface": {
      const data = (airport.surfaces ?? []).find((s) => s.id === id);
      return data ? { type: "surface", data } : null;
    }
    case "obstacle": {
      const data = (airport.obstacles ?? []).find((o) => o.id === id);
      return data ? { type: "obstacle", data } : null;
    }
    case "safety_zone": {
      const data = (airport.safety_zones ?? []).find((z) => z.id === id);
      return data ? { type: "safety_zone", data } : null;
    }
    case "agl": {
      for (const surface of airport.surfaces ?? []) {
        const data = (surface.agls ?? []).find((a) => a.id === id);
        if (data) return { type: "agl", data };
      }
      return null;
    }
    case "lha": {
      for (const surface of airport.surfaces ?? []) {
        for (const agl of surface.agls ?? []) {
          const data = (agl.lhas ?? []).find((l) => l.id === id);
          if (data) return { type: "lha", data };
        }
      }
      return null;
    }
    case "waypoint": {
      const wp = (waypoints ?? []).find((w) => w.id === id);
      if (wp) {
        return {
          type: "waypoint",
          data: {
            id: wp.id,
            waypoint_type: wp.waypoint_type,
            sequence_order: wp.sequence_order,
            position: wp.position,
            stack_count: 1,
            heading: wp.heading,
            speed: wp.speed,
            camera_action: wp.camera_action,
            camera_target: wp.camera_target,
            gimbal_pitch: wp.gimbal_pitch,
            hover_duration: wp.hover_duration ?? null,
            agl: wp.agl ?? null,
            camera_target_agl: wp.camera_target_agl ?? null,
          },
        };
      }

      // standalone takeoff/landing from mission coordinates
      const coord = id === "takeoff" ? takeoffCoord : id === "landing" ? landingCoord : null;
      if (coord) {
        return {
          type: "waypoint",
          data: {
            id,
            waypoint_type: id === "takeoff" ? "TAKEOFF" : "LANDING",
            sequence_order: 0,
            position: coord,
            stack_count: 1,
            heading: null,
            speed: null,
            camera_action: null,
            camera_target: null,
            gimbal_pitch: null,
          },
        };
      }
      return null;
    }
    default:
      return null;
  }
}
