import { EARTH_RADIUS_M } from "@/constants/geo";

// re-exported under the historic name so existing importers stay unchanged
export const EARTH_RADIUS = EARTH_RADIUS_M;
const R = EARTH_RADIUS;

/** convert degrees to radians. */
export function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

/** compute geographic bearing from point 1 to point 2 in degrees. */
export function computeBearing(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number,
): number {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** compute distance in meters between two lng/lat points. */
export function haversineDistance(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** format distance for display labels. */
export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

/** compute screen pixel distance between two lnglat points on a map. */
export function pixelDistance(
  map: { project: (lngLat: [number, number]) => { x: number; y: number } },
  a: [number, number],
  b: [number, number],
): number {
  const pa = map.project(a);
  const pb = map.project(b);
  return Math.sqrt((pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2);
}

/** compute geographic midpoint. */
export function midpoint(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** compute width and height in meters of an axis-aligned rectangle. */
export function rectangleDimensions(
  corner1: [number, number],
  corner2: [number, number],
): { width: number; height: number } {
  const width = haversineDistance(corner1[0], corner1[1], corner2[0], corner1[1]);
  const height = haversineDistance(corner1[0], corner1[1], corner1[0], corner2[1]);
  return { width, height };
}
