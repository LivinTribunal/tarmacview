import { describe, it, expect } from "vitest";
import { EARTH_RADIUS_M } from "@/constants/geo";
import * as geo from "@/utils/geo";

describe("utils/geo barrel", () => {
  it("re-exports the full historic public surface", () => {
    const expected = [
      "EARTH_RADIUS",
      "computeBearing",
      "haversineDistance",
      "formatDistance",
      "pixelDistance",
      "midpoint",
      "rectangleDimensions",
      "computePolygonArea",
      "formatArea",
      "circleToPolygon",
      "polygonCentroid",
      "computePolygonMedianWidth",
      "extractCenterline",
      "distanceFromCenterline",
    ];
    for (const name of expected) {
      expect(geo, `missing export: ${name}`).toHaveProperty(name);
    }
  });

  it("keeps toRad internal (not part of the barrel)", () => {
    expect(geo).not.toHaveProperty("toRad");
  });

  it("keeps EARTH_RADIUS as the single-source re-export of EARTH_RADIUS_M", () => {
    expect(geo.EARTH_RADIUS).toBe(EARTH_RADIUS_M);
  });

  it("distance + polygon + centerline helpers compute through the barrel", () => {
    expect(geo.haversineDistance(0, 0, 0, 0)).toBe(0);
    expect(geo.formatDistance(1500)).toBe("1.50 km");
    expect(geo.midpoint([0, 0], [2, 4])).toEqual([1, 2]);

    const square: [number, number][] = [
      [0, 0],
      [0, 0.001],
      [0.001, 0.001],
      [0.001, 0],
    ];
    expect(geo.computePolygonArea(square)).toBeGreaterThan(0);
    expect(geo.circleToPolygon([0, 0], 100).length).toBe(65);
    expect(geo.polygonCentroid(square)).toEqual([0.0005, 0.0005]);

    const ring: [number, number][] = [
      [0, 0],
      [0.01, 0],
      [0.01, 0.001],
      [0, 0.001],
      [0, 0],
    ];
    const cl = geo.extractCenterline(ring);
    expect(cl).toHaveLength(2);
    expect(geo.distanceFromCenterline([0.005, 0.0005], cl)).toBeGreaterThanOrEqual(0);
  });
});
