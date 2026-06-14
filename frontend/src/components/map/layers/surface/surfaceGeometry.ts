import { EARTH_RADIUS_M } from "@/constants/geo";
import type { SurfaceResponse } from "@/types/airport";

/** buffers a linestring centerline by half-width in meters to produce a polygon. */
export function bufferLineString(
  coordinates: number[][],
  widthMeters: number,
): number[][] {
  if (coordinates.length < 2) return [];

  const half = widthMeters / 2;
  const left: [number, number][] = [];
  const right: [number, number][] = [];

  for (let i = 0; i < coordinates.length; i++) {
    const [lon, lat] = coordinates[i];

    // compute perpendicular direction from segment heading
    let dx: number, dy: number;
    if (i < coordinates.length - 1) {
      dx = coordinates[i + 1][0] - lon;
      dy = coordinates[i + 1][1] - lat;
    } else {
      dx = lon - coordinates[i - 1][0];
      dy = lat - coordinates[i - 1][1];
    }

    // convert direction to meters so perpendicular is geographically correct
    const latRad = (lat * Math.PI) / 180;
    const mPerDegLon = (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(latRad);
    const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;

    const dxM = dx * mPerDegLon;
    const dyM = dy * mPerDegLat;
    const lenM = Math.sqrt(dxM * dxM + dyM * dyM);

    // coincident points - reuse previous offset to keep left/right arrays aligned
    if (lenM === 0) {
      if (left.length > 0) {
        left.push(left[left.length - 1]);
        right.push(right[right.length - 1]);
      } else {
        left.push([lon, lat]);
        right.push([lon, lat]);
      }
      continue;
    }

    // perpendicular unit vector in metric space (rotated 90 degrees)
    const perpXM = -dyM / lenM;
    const perpYM = dxM / lenM;

    // convert meter offset back to degrees
    const offsetLon = (perpXM * half) / mPerDegLon;
    const offsetLat = (perpYM * half) / mPerDegLat;

    left.push([lon + offsetLon, lat + offsetLat]);
    right.push([lon - offsetLon, lat - offsetLat]);
  }

  // close the polygon: left side forward, right side reversed
  if (left.length === 0) return [];
  right.reverse();
  const ring = [...left, ...right, left[0]];
  return ring;
}

/** drops the higher-id direction of every paired RUNWAY pair so the map renders one
 *  shape per physical runway. lower id wins; click resolves to that side's sidebar entry.
 *  unpaired surfaces and TAXIWAY rows pass through untouched.
 */
export function dedupPairedRunways(
  surfaces: SurfaceResponse[],
): SurfaceResponse[] {
  const byId = new Map(surfaces.map((s) => [s.id, s]));
  const skip = new Set<string>();
  for (const s of surfaces) {
    if (s.surface_type !== "RUNWAY" || !s.paired_surface_id) continue;
    if (skip.has(s.id)) continue;
    const pair = byId.get(s.paired_surface_id);
    if (!pair) continue;
    // lower-id wins; the other side is hidden from the layer.
    const loser = s.id < pair.id ? pair : s;
    skip.add(loser.id);
  }
  return surfaces.filter((s) => !skip.has(s.id));
}

/** display label for a paired runway: both reciprocal identifiers joined with "/",
 *  sorted ascending so callers see "01/19" not "19/01". falls back to the surface's
 *  own identifier when unpaired or partner missing.
 */
export function pairedRunwayLabel(
  surface: SurfaceResponse,
  byId: Map<string, SurfaceResponse>,
): string {
  if (!surface.paired_surface_id) return surface.identifier;
  const pair = byId.get(surface.paired_surface_id);
  if (!pair) return surface.identifier;
  return [surface.identifier, pair.identifier].sort().join("/");
}
