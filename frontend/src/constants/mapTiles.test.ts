import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ESRI_IMAGERY_DEFAULT =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_REFERENCE_DEFAULT =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const OSM_DEFAULT = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION_DEFAULT = "Tiles © Esri";

// load mapTiles.ts fresh after stubbing env so the module-level constants pick
// up the current import.meta.env values.
async function loadMapTiles() {
  vi.resetModules();
  return import("./mapTiles");
}

describe("mapTiles env-var fallbacks", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("falls back to the cloud defaults when no VITE_TILE_* env vars are set", async () => {
    vi.stubEnv("VITE_TILE_IMAGERY_URL", "");
    vi.stubEnv("VITE_TILE_REFERENCE_URL", "");
    vi.stubEnv("VITE_TILE_OSM_URL", "");
    vi.stubEnv("VITE_TILE_IMAGERY_ATTRIBUTION", "");

    const tiles = await loadMapTiles();

    expect(tiles.ESRI_WORLD_IMAGERY_TILES).toBe(ESRI_IMAGERY_DEFAULT);
    expect(tiles.ESRI_REFERENCE_TILES).toBe(ESRI_REFERENCE_DEFAULT);
    expect(tiles.OSM_TILES).toBe(OSM_DEFAULT);
    expect(tiles.ESRI_ATTRIBUTION).toBe(ATTRIBUTION_DEFAULT);
  });

  it("respects VITE_TILE_IMAGERY_URL when set", async () => {
    vi.stubEnv(
      "VITE_TILE_IMAGERY_URL",
      "https://tiles.internal/imagery/{z}/{y}/{x}",
    );
    const tiles = await loadMapTiles();
    expect(tiles.ESRI_WORLD_IMAGERY_TILES).toBe(
      "https://tiles.internal/imagery/{z}/{y}/{x}",
    );
  });

  it("respects VITE_TILE_REFERENCE_URL when set", async () => {
    vi.stubEnv(
      "VITE_TILE_REFERENCE_URL",
      "https://tiles.internal/reference/{z}/{y}/{x}",
    );
    const tiles = await loadMapTiles();
    expect(tiles.ESRI_REFERENCE_TILES).toBe(
      "https://tiles.internal/reference/{z}/{y}/{x}",
    );
  });

  it("respects VITE_TILE_OSM_URL when set", async () => {
    vi.stubEnv("VITE_TILE_OSM_URL", "https://tiles.internal/osm/{z}/{x}/{y}.png");
    const tiles = await loadMapTiles();
    expect(tiles.OSM_TILES).toBe("https://tiles.internal/osm/{z}/{x}/{y}.png");
  });

  it("respects VITE_TILE_IMAGERY_ATTRIBUTION when set", async () => {
    vi.stubEnv("VITE_TILE_IMAGERY_ATTRIBUTION", "Internal tile mirror");
    const tiles = await loadMapTiles();
    expect(tiles.ESRI_ATTRIBUTION).toBe("Internal tile mirror");
  });
});
