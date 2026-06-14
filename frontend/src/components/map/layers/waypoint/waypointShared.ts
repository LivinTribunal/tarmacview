// shared colour / label / segment-key helpers for the waypoint layer split.
// these were file-private in the old waypointLayers.ts - exported here for
// cross-module use only, deliberately NOT re-exported from the barrel so the
// original private/public boundary is preserved.

export const TRANSIT_PATH_COLOR = "#7eb8e5";
export const DEFAULT_MEASUREMENT_COLOR = "#3bbb3b";

/** rounds a coordinate to ~0.1m precision for stack grouping. */
export function coordKey(lon: number, lat: number): string {
  return `${lon.toFixed(6)},${lat.toFixed(6)}`;
}

/** creates a segment key from two coordinate pairs, sorted so both directions match. */
export function segmentKey(a: number[], b: number[]): string {
  const ak = `${a[0].toFixed(6)},${a[1].toFixed(6)}`;
  const bk = `${b[0].toFixed(6)},${b[1].toFixed(6)}`;
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

/** offsets a line segment to the left of its heading by adding arc midpoints. */
export function offsetSegmentLeft(
  from: number[],
  to: number[],
  meters: number,
): number[][] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return [from, to];

  // left perpendicular in lon/lat space (rotated 90 degrees ccw)
  const perpLon = -dy / len;
  const perpLat = dx / len;

  // approximate degrees offset (~1 degree lat = 111km)
  const degOffset = meters / 111000;

  // three arc midpoints for a smooth curve
  const mid1Lon = from[0] + dx * 0.25 + perpLon * degOffset * 0.7;
  const mid1Lat = from[1] + dy * 0.25 + perpLat * degOffset * 0.7;
  const mid2Lon = from[0] + dx * 0.5 + perpLon * degOffset;
  const mid2Lat = from[1] + dy * 0.5 + perpLat * degOffset;
  const mid3Lon = from[0] + dx * 0.75 + perpLon * degOffset * 0.7;
  const mid3Lat = from[1] + dy * 0.75 + perpLat * degOffset * 0.7;

  const alt = ((from[2] ?? 0) + (to[2] ?? 0)) / 2;
  return [
    from,
    [mid1Lon, mid1Lat, alt],
    [mid2Lon, mid2Lat, alt],
    [mid3Lon, mid3Lat, alt],
    to,
  ];
}

/** resolves color for a waypoint based on type. */
export function resolveWaypointColor(type: string): string {
  if (type === "TAKEOFF") return "#4595e5";
  if (type === "LANDING") return "#e54545";
  if (type === "TRANSIT") return "#ffffff";
  if (type === "HOVER") return "#e5a545";
  return DEFAULT_MEASUREMENT_COLOR;
}

/** resolves color for a line segment leading to a waypoint. */
export function resolveSegmentColor(toType: string): string {
  if (toType === "TRANSIT" || toType === "TAKEOFF" || toType === "LANDING") {
    return TRANSIT_PATH_COLOR;
  }
  return DEFAULT_MEASUREMENT_COLOR;
}

/** resolves the label text for a waypoint. */
export function resolveLabel(
  type: string,
  inspectionId: string | null,
  indexMap?: Record<string, number>,
): string {
  if (type === "MEASUREMENT" && inspectionId && indexMap?.[inspectionId] !== undefined) {
    return String(indexMap[inspectionId]);
  }
  return "";
}
