import { EARTH_RADIUS_M } from "@/constants/geo";

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

function bearingBetween(lon1: number, lat1: number, lon2: number, lat2: number): number {
  /** initial bearing in degrees from point 1 to point 2 (0=north, 90=east). */
  const lat1r = toRad(lat1);
  const lat2r = toRad(lat2);
  const dLon = toRad(lon2 - lon1);
  const east = Math.sin(dLon) * Math.cos(lat2r);
  const north =
    Math.cos(lat1r) * Math.sin(lat2r) -
    Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLon);
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

function distanceBetween(lon1: number, lat1: number, lon2: number, lat2: number): number {
  /** great-circle distance in meters between two WGS84 points (haversine). */
  const lat1r = toRad(lat1);
  const lat2r = toRad(lat2);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1r) * Math.cos(lat2r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
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
  const rwyBearing = bearingBetween(tLon, tLat, eLon, eLat);
  const ptBearing = bearingBetween(tLon, tLat, lon, lat);
  const ptDistance = distanceBetween(tLon, tLat, lon, lat);
  const delta = toRad(ptBearing - rwyBearing);
  return ptDistance * Math.cos(delta);
}
