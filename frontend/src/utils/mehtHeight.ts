/** compute MEHT height above threshold from PAPI distance and glide slope angle. */
export function computeMehtHeight(
  distanceFromThreshold: number,
  glideSlopeAngle: number,
): number {
  return distanceFromThreshold * Math.tan((glideSlopeAngle * Math.PI) / 180);
}

/** resolve MEHT height: surveyed meht_height_m when set, else the derived value. */
export function resolveMehtHeight(
  agl: {
    meht_height_m: number | null;
    distance_from_threshold: number | null;
    glide_slope_angle: number | null;
  },
  defaultGlideSlope: number,
): number | null {
  if (agl.meht_height_m != null) return agl.meht_height_m;
  if (agl.distance_from_threshold == null) return null;
  return computeMehtHeight(agl.distance_from_threshold, agl.glide_slope_angle ?? defaultGlideSlope);
}
