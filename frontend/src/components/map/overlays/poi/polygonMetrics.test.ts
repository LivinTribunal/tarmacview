import { describe, it, expect } from "vitest";
import type { PolygonZ } from "@/types/common";
import { computePolygonAreaPerimeter, formatArea, formatLength } from "./polygonMetrics";

function tStub(key: string, opts?: Record<string, unknown>): string {
  /** translation stub returning the defaultValue when given, otherwise the key. */
  if (opts && typeof opts.defaultValue === "string") return opts.defaultValue;
  return key;
}

describe("computePolygonAreaPerimeter", () => {
  it("returns zeros for null / undefined polygon", () => {
    expect(computePolygonAreaPerimeter(null)).toEqual({ areaM2: 0, perimeterM: 0 });
    expect(computePolygonAreaPerimeter(undefined)).toEqual({ areaM2: 0, perimeterM: 0 });
  });

  it("returns zeros for a ring with fewer than 3 vertices", () => {
    const polygon: PolygonZ = {
      type: "Polygon",
      coordinates: [[[14, 50, 0], [14.001, 50, 0]]],
    };
    expect(computePolygonAreaPerimeter(polygon)).toEqual({ areaM2: 0, perimeterM: 0 });
  });

  it("computes plausible area and perimeter for a small square near 50°N", () => {
    // ~111 m per 0.001° lat; ~71.5 m per 0.001° lon at 50°N
    const polygon: PolygonZ = {
      type: "Polygon",
      coordinates: [
        [
          [14.0, 50.0, 0],
          [14.001, 50.0, 0],
          [14.001, 50.001, 0],
          [14.0, 50.001, 0],
          [14.0, 50.0, 0],
        ],
      ],
    };
    const { areaM2, perimeterM } = computePolygonAreaPerimeter(polygon);
    // square is ~71.5 m × ~111 m -> ~7935 m²
    expect(areaM2).toBeGreaterThan(7500);
    expect(areaM2).toBeLessThan(8400);
    // perimeter ~ 2*(71.5 + 111) ~ 365 m
    expect(perimeterM).toBeGreaterThan(340);
    expect(perimeterM).toBeLessThan(390);
  });
});

describe("formatArea", () => {
  it("uses m² below the 1 km² boundary", () => {
    expect(formatArea(500_000, tStub)).toBe("500000 m²");
    expect(formatArea(999_999, tStub)).toBe("999999 m²");
  });

  it("switches to km² at and above 1 000 000 m²", () => {
    expect(formatArea(1_000_000, tStub)).toBe("1.00 km²");
    expect(formatArea(2_500_000, tStub)).toBe("2.50 km²");
  });
});

describe("formatLength", () => {
  it("uses meters below 1 km", () => {
    // formatLength uses t("common.units.m") with no defaultValue, so the stub returns the key
    expect(formatLength(250, tStub)).toBe("250 common.units.m");
  });

  it("switches to km at and above 1000 m", () => {
    expect(formatLength(1000, tStub)).toBe("1.00 km");
    expect(formatLength(4321, tStub)).toBe("4.32 km");
  });
});
