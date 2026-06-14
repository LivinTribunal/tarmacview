import { haversineDistance, computePolygonMedianWidth } from "@/utils/geo";

/** drop the closing vertex when the ring is explicitly closed. */
export function openRing(ring: [number, number][]): [number, number][] {
  return ring[ring.length - 1][0] === ring[0][0] && ring[ring.length - 1][1] === ring[0][1]
    ? ring.slice(0, -1)
    : ring;
}

/** width from a 4-corner rectangle (mean of the shorter opposite-edge pair)
 *  or the median perpendicular cross-section for free-form polygons. */
export function derivePolygonWidth(
  ring: [number, number][],
  centerline: [number, number][],
  pts: [number, number][],
): number | undefined {
  if (pts.length === 4) {
    const d01 = haversineDistance(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
    const d12 = haversineDistance(pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
    if (d01 >= d12) {
      return (d12 + haversineDistance(pts[3][0], pts[3][1], pts[0][0], pts[0][1])) / 2;
    }
    return (d01 + haversineDistance(pts[2][0], pts[2][1], pts[3][0], pts[3][1])) / 2;
  }
  if (pts.length > 4 && centerline.length >= 2) {
    return computePolygonMedianWidth(ring, centerline);
  }
  return undefined;
}

/** polygon area via shoelace on locally-projected metres; undefined under 3 pts. */
export function shoelaceArea(pts: [number, number][]): number | undefined {
  if (pts.length < 3) return undefined;
  const refLat = pts[0][1];
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((refLat * Math.PI) / 180);
  const projected = pts.map((p) => [
    (p[0] - pts[0][0]) * mPerDegLng,
    (p[1] - pts[0][1]) * mPerDegLat,
  ]);
  let sum = 0;
  for (let i = 0; i < projected.length; i++) {
    const j = (i + 1) % projected.length;
    sum += projected[i][0] * projected[j][1] - projected[j][0] * projected[i][1];
  }
  return Math.abs(sum) / 2;
}

/** circle area from radius in metres. */
export function circleArea(radius: number): number {
  return Math.PI * radius * radius;
}
