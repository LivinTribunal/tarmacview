/** tile-host matcher + cache caps shared by vite.config.ts and unit tests. */

// public CDN hosts the 2D (maplibre) and 3D (cesium) viewers fetch tiles from.
// closed-network deploys override tile URLs (VITE_TILE_* / VITE_CESIUM_*) to
// internal hosts, which simply won't match here - the cache no-ops, no harm.
// note: api.cesium.com is intentionally excluded - it serves short-lived Ion
// access tokens (per-request auth), not tiles; CacheFirst would serve a stale
// token and break 3D once it expires even while online.
export const TILE_HOST_PATTERN =
  /^https:\/\/(server\.arcgisonline\.com|tile\.openstreetmap\.org|assets\.cesium\.com|assets\.ion\.cesium\.com)\//;

export const TILE_CACHE_NAME = "tile-cache";
export const TILE_CACHE_MAX_ENTRIES = 5000;
export const TILE_CACHE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

/** true when a request url is an external map/terrain tile GET we cache. */
export function isTileRequest(url: string): boolean {
  return TILE_HOST_PATTERN.test(url);
}
