import { describe, it, expect } from "vitest";
import { extractCenterline } from "@/utils/geo";
import {
  openRing,
  derivePolygonWidth,
  shoelaceArea,
  circleArea,
} from "./polygonGeometryDerivation";

const rect: [number, number][] = [
  [0, 0],
  [0, 0.001],
  [0.002, 0.001],
  [0.002, 0],
  [0, 0],
];

describe("openRing", () => {
  it("drops the closing vertex when the ring is explicitly closed", () => {
    expect(openRing(rect)).toEqual([
      [0, 0],
      [0, 0.001],
      [0.002, 0.001],
      [0.002, 0],
    ]);
  });

  it("returns the ring untouched when it is not closed", () => {
    const open: [number, number][] = [[0, 0], [1, 0], [1, 1]];
    expect(openRing(open)).toBe(open);
  });
});

describe("derivePolygonWidth", () => {
  it("averages the shorter opposite-edge pair for a 4-corner rectangle", () => {
    const ring = rect;
    const centerline = extractCenterline(ring);
    const pts = openRing(ring);
    const w = derivePolygonWidth(ring, centerline, pts);
    expect(w).toBeGreaterThan(0);
    // ~0.002 deg lon at the equator ≈ 222 m long edge; the ~0.001 deg lat
    // ≈ 111 m short edge is the width
    expect(w).toBeCloseTo(111.19, 0);
  });

  it("uses the median cross-section for a free-form >4-vertex polygon", () => {
    const ring: [number, number][] = [
      [0, 0],
      [0.001, 0.0005],
      [0.002, 0],
      [0.002, 0.001],
      [0.001, 0.0015],
      [0, 0.001],
      [0, 0],
    ];
    const centerline = extractCenterline(ring);
    const pts = openRing(ring);
    expect(derivePolygonWidth(ring, centerline, pts)).toBeGreaterThan(0);
  });

  it("returns undefined for a triangle (not 4 and not >4)", () => {
    const tri: [number, number][] = [[0, 0], [1, 0], [0.5, 1]];
    expect(derivePolygonWidth(tri, extractCenterline(tri), tri)).toBeUndefined();
  });
});

describe("shoelaceArea", () => {
  it("returns undefined under 3 points", () => {
    expect(shoelaceArea([[0, 0], [1, 1]])).toBeUndefined();
  });

  it("computes a positive projected area for the rectangle", () => {
    const area = shoelaceArea(openRing(rect))!;
    // 0.002 deg lon * 111320 ≈ 222.64 m, 0.001 deg lat * 111320 ≈ 111.32 m
    expect(area).toBeCloseTo(111320 * 0.002 * (111320 * 0.001), 2);
  });
});

describe("circleArea", () => {
  it("is pi * r^2", () => {
    expect(circleArea(10)).toBeCloseTo(Math.PI * 100, 9);
  });
});
