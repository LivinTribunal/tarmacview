import { computeBearing, haversineDistance } from "@/utils/geo";

// behavior-mirroring port of backend
// `_along_runway_distance_from_threshold` (app/services/airport/surfaces.py).
// projects (lon, lat) onto the runway axis defined by threshold -> end and
// returns the signed along-track distance in meters, or null when either
// endpoint is missing. uses the same haversine + equirectangular math as the
// backend so the prefill preview matches what the server persists.

function toRad(deg: number): number {
  /** convert degrees to radians. */
  return (deg * Math.PI) / 180;
}

/** along-centerline distance from runway threshold to (lon, lat), in meters.
 *
 * mirrors `_along_runway_distance_from_threshold` in
 * `backend/app/services/airport/surfaces.py`. returns null when threshold or
 * end is missing.
 */
export function alongRunwayDistanceFromThreshold(
  threshold: [number, number] | null | undefined,
  end: [number, number] | null | undefined,
  lon: number,
  lat: number,
): number | null {
  if (!threshold || !end) return null;
  const [tLon, tLat] = threshold;
  const [eLon, eLat] = end;
  const rwyBearing = computeBearing(tLon, tLat, eLon, eLat);
  const ptBearing = computeBearing(tLon, tLat, lon, lat);
  const ptDistance = haversineDistance(tLon, tLat, lon, lat);
  const delta = toRad(ptBearing - rwyBearing);
  return ptDistance * Math.cos(delta);
}
