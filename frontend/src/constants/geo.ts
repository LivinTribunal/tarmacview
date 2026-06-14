// shared geographic constants. single source for the spherical-earth and
// metres-per-degree approximations used across map and geometry utils.

/** mean earth radius in meters (spherical approximation). */
export const EARTH_RADIUS_M = 6_371_000;

/** meters per degree of latitude at WGS84 - rough but consistent with backend. */
export const METRES_PER_DEGREE = 111_320;

// wgs84 coordinate bounds - single source for lat/lon range validation.

/** valid latitude range in decimal degrees. */
export const LAT_BOUNDS = { min: -90, max: 90 };

/** valid longitude range in decimal degrees. */
export const LON_BOUNDS = { min: -180, max: 180 };
