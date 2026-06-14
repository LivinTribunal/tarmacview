import { describe, it, expect } from "vitest";
import { pointsEqual } from "./coordinateEquality";
import type { PointZ } from "@/types/common";

function pt(lon: number, lat: number, alt: number): PointZ {
  /** build a pointz triple. */
  return { type: "Point", coordinates: [lon, lat, alt] };
}

describe("pointsEqual", () => {
  /** epsilon-based equality for round-tripped postgis points. */

  it("returns true for identical coordinates", () => {
    expect(pointsEqual(pt(17.21, 48.17, 100), pt(17.21, 48.17, 100))).toBe(true);
  });

  it("returns true within the lat/lon epsilon", () => {
    // 1e-8 deg drift is well below the 1e-7 threshold
    expect(
      pointsEqual(pt(17.21, 48.17, 100), pt(17.21 + 1e-8, 48.17 - 1e-8, 100)),
    ).toBe(true);
  });

  it("returns true within the altitude epsilon", () => {
    expect(
      pointsEqual(pt(17.21, 48.17, 100), pt(17.21, 48.17, 100.005)),
    ).toBe(true);
  });

  it("returns false beyond the lat/lon epsilon", () => {
    // 1e-6 deg drift exceeds the 1e-7 threshold
    expect(
      pointsEqual(pt(17.21, 48.17, 100), pt(17.21 + 1e-6, 48.17, 100)),
    ).toBe(false);
  });

  it("returns false beyond the altitude epsilon", () => {
    expect(
      pointsEqual(pt(17.21, 48.17, 100), pt(17.21, 48.17, 100.5)),
    ).toBe(false);
  });

  it("returns false when either side is null", () => {
    expect(pointsEqual(null, pt(17.21, 48.17, 100))).toBe(false);
    expect(pointsEqual(pt(17.21, 48.17, 100), null)).toBe(false);
    expect(pointsEqual(null, null)).toBe(false);
    expect(pointsEqual(undefined, pt(17.21, 48.17, 100))).toBe(false);
  });
});
