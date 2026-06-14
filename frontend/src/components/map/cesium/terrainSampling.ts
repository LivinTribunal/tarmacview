import { Cartesian3, Cartographic, sampleTerrainMostDetailed } from "cesium";
import type { Viewer as CesiumViewer } from "cesium";

/** key sampled-height map by lng/lat rounded to ~0.1m precision so repeated coords dedupe. */
export function terrainKey(lng: number, lat: number): string {
  return `${lng.toFixed(6)},${lat.toFixed(6)}`;
}

/** look up sampled terrain height at (lng, lat) and return ellipsoidal Cartesian3 at
 * sampled_cesium_terrain(lng, lat) + agl. returns null if the point hasn't been
 * sampled yet (caller skips the entity to avoid wrong-altitude flash). */
export function cartFromAgl(
  lng: number,
  lat: number,
  agl: number,
  heights: Map<string, number>,
): Cartesian3 | null {
  const h = heights.get(terrainKey(lng, lat));
  if (h == null) return null;
  return Cartesian3.fromDegrees(lng, lat, h + agl);
}

/** sample cesium terrain ellipsoidal heights for a batch of (lng, lat) points.
 * dedupes by terrainKey, awaits the deepest available tile via sampleTerrainMostDetailed,
 * and returns a map keyed by terrainKey(lng, lat). entries with null/undefined heights
 * are skipped. */
export async function resolveWaypointHeights(
  viewer: CesiumViewer,
  points: Array<[number, number]>,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (points.length === 0) return result;

  // dedupe by rounded key so takeoff = first wp etc. samples once
  const unique = new Map<string, [number, number]>();
  for (const [lng, lat] of points) {
    unique.set(terrainKey(lng, lat), [lng, lat]);
  }

  const cartos = Array.from(unique.values()).map(([lng, lat]) =>
    Cartographic.fromDegrees(lng, lat),
  );

  const sampled = await sampleTerrainMostDetailed(viewer.terrainProvider, cartos);
  const keys = Array.from(unique.keys());

  for (let i = 0; i < sampled.length; i++) {
    const h = sampled[i].height;
    if (h != null && Number.isFinite(h)) {
      result.set(keys[i], h);
    }
  }

  return result;
}
