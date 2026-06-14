import { haversineDistance, midpoint } from "./distance";

/** extract a centerline from a polygon ring for surface geometry. returns a 2-point linestring. */
export function extractCenterline(
  ring: [number, number][],
): [number, number][] {
  // find the longest edge pair to determine the main axis
  const pts = ring[ring.length - 1][0] === ring[0][0] && ring[ring.length - 1][1] === ring[0][1]
    ? ring.slice(0, -1)
    : ring;

  if (pts.length < 3) return pts.length >= 2 ? [pts[0], pts[1]] : [[0, 0], [0, 0]];

  // for a rectangle-like polygon, pair opposite edges and return their midpoints
  if (pts.length === 4) {
    const d01 = haversineDistance(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
    const d12 = haversineDistance(pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
    if (d01 >= d12) {
      // edges 0-1 and 2-3 are the long edges
      return [midpoint(pts[0], pts[3]), midpoint(pts[1], pts[2])];
    } else {
      // edges 1-2 and 3-0 are the long edges
      return [midpoint(pts[0], pts[1]), midpoint(pts[2], pts[3])];
    }
  }

  // general case: use first and farthest point
  let maxDist = 0;
  let farthestIdx = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = haversineDistance(pts[0][0], pts[0][1], pts[i][0], pts[i][1]);
    if (d > maxDist) {
      maxDist = d;
      farthestIdx = i;
    }
  }
  return [pts[0], pts[farthestIdx]];
}
