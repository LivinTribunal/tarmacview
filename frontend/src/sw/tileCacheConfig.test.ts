import { describe, expect, it } from "vitest";
import {
  isTileRequest,
  TILE_CACHE_MAX_AGE_SECONDS,
  TILE_CACHE_MAX_ENTRIES,
  TILE_CACHE_NAME,
} from "./tileCacheConfig";

describe("isTileRequest", () => {
  // hosts the cache should match
  it.each([
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/4/5",
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/3/4/5",
    "https://tile.openstreetmap.org/3/4/5.png",
    "https://assets.cesium.com/1/0/0/0.terrain",
    "https://assets.ion.cesium.com/1/0/0/0.terrain",
  ])("matches tile host %s", (url) => {
    expect(isTileRequest(url)).toBe(true);
  });

  // hosts the cache must leave alone
  it.each([
    "/api/v1/missions",
    "https://app.example.com/api/v1/missions",
    "https://fonts.googleapis.com/css2?family=Inter",
    "https://fonts.gstatic.com/s/inter/v1/font.woff2",
    "https://evil.example.com/server.arcgisonline.com/x",
    "http://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/4/5",
    // ion token endpoint - short-lived auth, must not be cached
    "https://api.cesium.com/v1/assets/1/endpoint",
  ])("ignores non-tile request %s", (url) => {
    expect(isTileRequest(url)).toBe(false);
  });
});

describe("cache caps", () => {
  it("pins the cache name and bounds", () => {
    expect(TILE_CACHE_NAME).toBe("tile-cache");
    expect(TILE_CACHE_MAX_ENTRIES).toBe(5000);
    expect(TILE_CACHE_MAX_AGE_SECONDS).toBe(604800);
  });
});
