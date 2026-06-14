// order scattered points into a non-self-intersecting ring by sorting them by
// polar angle around their centroid (atan2). convex footprints (runway
// surfaces, obstacle bounds) come out clean; concave shapes are out of scope.

/** sort [lon, lat] points counter-clockwise by polar angle around the centroid. */
export function orderPolygonRing(points: [number, number][]): [number, number][] {
  if (points.length < 3) return [...points];

  const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;

  return [...points].sort((a, b) => {
    const angleA = Math.atan2(a[1] - cy, a[0] - cx);
    const angleB = Math.atan2(b[1] - cy, b[0] - cx);
    return angleA - angleB;
  });
}

// the caller supplies points in final ring order (seeded by orderPolygonRing,
// then manually reordered); this only closes the ring so a manual reorder is
// not silently overwritten by a second polar sort.
/** build a closed GeoJSON polygon (first vertex repeated) from already-ordered points. */
export function pointsToPolygon(points: [number, number][]): GeoJSON.Polygon {
  const closed: [number, number][] =
    points.length > 0 ? [...points, points[0]] : [];
  return { type: "Polygon", coordinates: [closed] };
}
