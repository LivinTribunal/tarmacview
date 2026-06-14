import { describe, it, expect, vi } from "vitest";

// minimal cesium mock - sampleTerrainMostDetailed and Cartographic.fromDegrees only.
const sampleMock = vi.fn();

vi.mock("cesium", () => {
  return {
    Cartographic: {
      fromDegrees: (lng: number, lat: number) => ({ lng, lat }),
    },
    sampleTerrainMostDetailed: (
      provider: unknown,
      points: Array<{ lng: number; lat: number }>,
    ) => sampleMock(provider, points),
  };
});

import { resolveWaypointHeights, terrainKey } from "./terrainSampling";

describe("terrainKey", () => {
  it("rounds to 6 decimal places of lng/lat", () => {
    expect(terrainKey(10.1234567, 20.7654321)).toBe("10.123457,20.765432");
  });

  it("collapses near-duplicates that round to the same key", () => {
    expect(terrainKey(10.0000001, 20.0000001)).toBe(
      terrainKey(10.0000002, 20.0000002),
    );
  });
});

describe("resolveWaypointHeights", () => {
  const fakeViewer = { terrainProvider: { id: "world-terrain" } } as never;

  it("returns an empty map for an empty input", async () => {
    const result = await resolveWaypointHeights(fakeViewer, []);
    expect(result.size).toBe(0);
  });

  it("dedupes repeated coordinates so each unique key samples once", async () => {
    sampleMock.mockReset();
    sampleMock.mockResolvedValueOnce([
      { height: 100 },
      { height: 200 },
    ]);
    const result = await resolveWaypointHeights(fakeViewer, [
      [10, 20],
      [10, 20],
      [11, 21],
    ]);
    expect(sampleMock).toHaveBeenCalledTimes(1);
    const cartos = sampleMock.mock.calls[0][1];
    expect(cartos).toHaveLength(2);
    expect(result.get(terrainKey(10, 20))).toBe(100);
    expect(result.get(terrainKey(11, 21))).toBe(200);
  });

  it("accepts negative heights (geoid undulation case)", async () => {
    sampleMock.mockReset();
    sampleMock.mockResolvedValueOnce([{ height: -90 }]);
    const result = await resolveWaypointHeights(fakeViewer, [[80, -5]]);
    expect(result.get(terrainKey(80, -5))).toBe(-90);
  });

  it("skips entries with null/undefined/NaN heights without throwing", async () => {
    sampleMock.mockReset();
    sampleMock.mockResolvedValueOnce([
      { height: null },
      { height: undefined },
      { height: NaN },
      { height: 42 },
    ]);
    const result = await resolveWaypointHeights(fakeViewer, [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
    expect(result.size).toBe(1);
    expect(result.get(terrainKey(4, 4))).toBe(42);
  });
});
