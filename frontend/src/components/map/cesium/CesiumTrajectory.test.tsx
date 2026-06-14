import { describe, it, expect, vi } from "vitest";

// minimal cesium mock - jsdom lacks WebGL, and cartFromAgl only needs
// Cartesian3.fromDegrees to assert the sampled-terrain + agl math.
vi.mock("cesium", () => {
  const Cartesian3 = class {
    constructor(public x = 0, public y = 0, public z = 0) {}
    static fromDegrees(lng: number, lat: number, alt: number) {
      return { lng, lat, alt };
    }
  };
  const Cartographic = {
    fromDegrees: (lng: number, lat: number) => ({ lng, lat }),
  };
  const sampleTerrainMostDetailed = vi.fn(async () => []);
  return { Cartesian3, Cartographic, sampleTerrainMostDetailed };
});

import { cartFromAgl, terrainKey } from "./terrainSampling";

describe("cartFromAgl", () => {
  it("renders at sampled_cesium_terrain(lng, lat) + agl", () => {
    const sampledHeight = 412;
    const heights = new Map([[terrainKey(10, 20), sampledHeight]]);
    const result = cartFromAgl(10, 20, 50, heights) as unknown as { alt: number };
    expect(result).toBeDefined();
    expect(result.alt).toBe(sampledHeight + 50);
  });

  it("works with negative sampled heights (geoid undulation case)", () => {
    const heights = new Map([[terrainKey(80, -5), -90]]);
    const result = cartFromAgl(80, -5, 30, heights) as unknown as { alt: number };
    expect(result).toBeDefined();
    expect(result.alt).toBe(-90 + 30);
  });

  it("returns null when the point has not been sampled yet (no flash-frame)", () => {
    const heights = new Map<string, number>();
    expect(cartFromAgl(10, 20, 100, heights)).toBeNull();
  });

  it("places agl=0 (TAKEOFF/LANDING) directly on the sampled terrain", () => {
    const sampledHeight = 412;
    const heights = new Map([[terrainKey(10, 20), sampledHeight]]);
    const result = cartFromAgl(10, 20, 0, heights) as unknown as { alt: number };
    expect(result.alt).toBe(sampledHeight);
  });
});
