import { describe, it, expect, vi } from "vitest";
import { resolveRingZ, resolvePointAltitude } from "./resolveCreationElevations";

describe("resolveRingZ", () => {
  it("returns airport elevation for every vertex when no resolver is provided", async () => {
    const ring: [number, number][] = [
      [17.0, 48.0],
      [17.1, 48.0],
      [17.1, 48.1],
      [17.0, 48.1],
    ];
    const result = await resolveRingZ(ring, undefined, 210);
    expect(result).toEqual([
      [17.0, 48.0, 210],
      [17.1, 48.0, 210],
      [17.1, 48.1, 210],
      [17.0, 48.1, 210],
    ]);
  });

  it("stamps per-vertex DEM elevations from the resolver", async () => {
    const resolver = vi.fn(async (lat: number) => 100 + lat);
    const ring: [number, number][] = [
      [17.0, 48.0],
      [17.1, 48.2],
    ];
    const result = await resolveRingZ(ring, resolver, 0);
    expect(result).toEqual([
      [17.0, 48.0, 148.0],
      [17.1, 48.2, 148.2],
    ]);
  });

  it("falls back per-vertex when the resolver returns null (does not abort the ring)", async () => {
    // mimics two successes, one failure (null), one success
    const resolver = vi
      .fn<(lat: number, lon: number) => Promise<number | null>>()
      .mockResolvedValueOnce(101)
      .mockResolvedValueOnce(102)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(104);
    const ring: [number, number][] = [
      [17.0, 48.0],
      [17.1, 48.0],
      [17.1, 48.1],
      [17.0, 48.1],
    ];
    const result = await resolveRingZ(ring, resolver, 210);
    expect(result).toEqual([
      [17.0, 48.0, 101],
      [17.1, 48.0, 102],
      [17.1, 48.1, 210],
      [17.0, 48.1, 104],
    ]);
  });

  it("FLAT-mode parity: resolver returning airport elevation produces byte-identical output", async () => {
    const airportElevation = 187.5;
    const resolver = vi.fn(async () => airportElevation);
    const ring: [number, number][] = [
      [17.0, 48.0],
      [17.1, 48.0],
      [17.0, 48.1],
    ];
    const result = await resolveRingZ(ring, resolver, airportElevation);
    expect(result).toEqual([
      [17.0, 48.0, airportElevation],
      [17.1, 48.0, airportElevation],
      [17.0, 48.1, airportElevation],
    ]);
  });
});

describe("resolvePointAltitude", () => {
  it("returns airport elevation when no resolver is set", async () => {
    const v = await resolvePointAltitude(48.0, 17.0, undefined, 210);
    expect(v).toBe(210);
  });

  it("returns resolver value on success", async () => {
    const resolver = vi.fn(async () => 175.25);
    const v = await resolvePointAltitude(48.0, 17.0, resolver, 210);
    expect(v).toBe(175.25);
    expect(resolver).toHaveBeenCalledWith(48.0, 17.0);
  });

  it("falls back to airport elevation when resolver returns null", async () => {
    const resolver = vi.fn(async () => null);
    const v = await resolvePointAltitude(48.0, 17.0, resolver, 210);
    expect(v).toBe(210);
  });
});
