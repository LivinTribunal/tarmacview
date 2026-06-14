/** linearly interpolate altitude along a transit segment by projecting
 * `point` onto the from->to line.
 */
export function interpolateAltitude(
  from: [number, number, number],
  to: [number, number, number],
  point: [number, number],
): number {
  const dLng = to[0] - from[0];
  const dLat = to[1] - from[1];
  const lenSq = dLng * dLng + dLat * dLat;

  // degenerate segment - both endpoints colocated
  if (lenSq < 1e-14) {
    return from[2];
  }

  const t = ((point[0] - from[0]) * dLng + (point[1] - from[1]) * dLat) / lenSq;
  const clamped = Math.max(0, Math.min(1, t));
  return from[2] + clamped * (to[2] - from[2]);
}
