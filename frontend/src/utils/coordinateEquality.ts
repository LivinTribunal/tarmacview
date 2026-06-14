import type { PointZ } from "@/types/common";

// permissive epsilons absorb postgis srid 4326 round-trip drift
const DEG_EPSILON = 1e-7;
const ALT_EPSILON = 0.01;

/** true when both points are non-null and lat/lon/alt match within a small epsilon. */
export function pointsEqual(
  a: PointZ | null | undefined,
  b: PointZ | null | undefined,
): boolean {
  if (!a || !b) return false;
  const [lonA, latA, altA] = a.coordinates;
  const [lonB, latB, altB] = b.coordinates;
  return (
    Math.abs(lonA - lonB) <= DEG_EPSILON &&
    Math.abs(latA - latB) <= DEG_EPSILON &&
    Math.abs(altA - altB) <= ALT_EPSILON
  );
}
