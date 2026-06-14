import type { ElevationResolver } from "@/utils/takeoffLandingPlacement";

/** resolve dem elevation per [lng, lat] vertex, fall back per-vertex on failure. */
export async function resolveRingZ(
  ring: [number, number][],
  resolver: ElevationResolver | undefined,
  fallbackElevation: number,
): Promise<[number, number, number][]> {
  if (!resolver) {
    return ring.map(([lng, lat]) => [lng, lat, fallbackElevation]);
  }
  const zs = await Promise.all(
    ring.map(([lng, lat]) =>
      resolver(lat, lng).then((v) => (v == null ? fallbackElevation : v)),
    ),
  );
  return ring.map(([lng, lat], i) => [lng, lat, zs[i]]);
}

/** resolve dem elevation for one point, fall back to airport elevation on failure. */
export async function resolvePointAltitude(
  lat: number,
  lon: number,
  resolver: ElevationResolver | undefined,
  fallbackElevation: number,
): Promise<number> {
  if (!resolver) return fallbackElevation;
  const v = await resolver(lat, lon);
  return v == null ? fallbackElevation : v;
}
