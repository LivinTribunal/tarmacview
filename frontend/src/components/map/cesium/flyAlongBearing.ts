import { Math as CesiumMath } from "cesium";
import type { WaypointResponse } from "@/types/flightPlan";

// match `_body_tracks_target` in the backend DJI exporter: if wp.heading is
// within this much of the bearing toward camera_target, the body is meant to
// face the target (HR / VP / HPL / MEHT pattern). otherwise the heading is a
// row direction (FO / PSS) and should be honored verbatim.
export const BODY_TRACKS_TARGET_TOLERANCE_DEG = 5;

/** initial great-circle compass bearing between two lat/lng points, in degrees. */
export function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = CesiumMath.toRadians(lng2 - lng1);
  const lat1Rad = CesiumMath.toRadians(lat1);
  const lat2Rad = CesiumMath.toRadians(lat2);
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  return (CesiumMath.toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/** initial compass bearing from waypoint a to waypoint b, in degrees. */
export function bearingBetweenWaypoints(a: WaypointResponse, b: WaypointResponse): number {
  const [aLng, aLat] = a.position.coordinates;
  const [bLng, bLat] = b.position.coordinates;
  return bearing(aLat, aLng, bLat, bLng);
}

// true when the planned wp.heading is the bearing toward camera_target (within
// the tolerance). HR / VP / HPL / MEHT set wp.heading = bearing-to-target; FO
// and PSS set it to the row direction instead. mirrors the backend
// `_body_tracks_target` predicate in the DJI WPML exporter.
export function bodyTracksTarget(wp: WaypointResponse): boolean {
  if (!wp.camera_target) return false;
  const [lng, lat] = wp.position.coordinates;
  const [tLng, tLat] = wp.camera_target.coordinates;
  const targetBearing = bearing(lat, lng, tLat, tLng);
  if (wp.heading == null || !Number.isFinite(wp.heading)) return true;
  const diff = Math.abs(((wp.heading - targetBearing + 540) % 360) - 180);
  return diff <= BODY_TRACKS_TARGET_TOLERANCE_DEG;
}
