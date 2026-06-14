import { describe, it, expect } from "vitest";
import type { MapFeature } from "@/types/map";
import { circleToPolygon } from "@/utils/geo";
import {
  extractEditState,
  radiusEdgePoint,
  buildVertexGeometryUpdate,
} from "./vertexEditorGeometry";

const squareRing: [number, number, number][] = [
  [0, 0, 5],
  [0, 0.001, 5],
  [0.002, 0.001, 5],
  [0.002, 0, 5],
  [0, 0, 5],
];

function safetyZone(ring: number[][]): MapFeature {
  return {
    type: "safety_zone",
    data: { id: "sz-1", geometry: { type: "Polygon", coordinates: [ring] } },
  } as unknown as MapFeature;
}

function obstacle(ring: number[][]): MapFeature {
  return {
    type: "obstacle",
    data: { id: "ob-1", boundary: { type: "Polygon", coordinates: [ring] } },
  } as unknown as MapFeature;
}

describe("extractEditState - circle vs polygon detection", () => {
  it("flags a uniform >=16-vertex ring as a circle", () => {
    const ring = circleToPolygon([10, 50], 100).map(([lng, lat]) => [lng, lat, 0]);
    const st = extractEditState(safetyZone(ring))!;
    expect(st.mode).toBe("circle");
    expect(st.radius).toBeCloseTo(100, 0);
    expect(st.corners).toEqual([]);
  });

  it("treats a 4-corner ring as a polygon", () => {
    const st = extractEditState(safetyZone(squareRing))!;
    expect(st.mode).toBe("polygon");
    expect(st.corners).toHaveLength(4);
  });

  it("returns null for a degenerate ring (<4 points)", () => {
    expect(extractEditState(safetyZone([[0, 0], [1, 1], [0, 0]]))).toBeNull();
  });

  it("detects circles for obstacles too", () => {
    const ring = circleToPolygon([0, 0], 42, 32).map(([lng, lat]) => [lng, lat, 0]);
    const st = extractEditState(obstacle(ring))!;
    expect(st.mode).toBe("circle");
    expect(st.radius).toBeCloseTo(42, 0);
  });
});

describe("extractEditState - surface boundary vs centerline fallback", () => {
  it("uses the stored boundary polygon when present", () => {
    const feat = {
      type: "surface",
      data: {
        id: "s-1",
        surface_type: "RUNWAY",
        boundary: { type: "Polygon", coordinates: [squareRing] },
        geometry: { type: "LineString", coordinates: [] },
      },
    } as unknown as MapFeature;
    const st = extractEditState(feat)!;
    expect(st.mode).toBe("polygon");
    expect(st.corners).toHaveLength(4);
  });

  it("reconstructs from centerline + width when boundary is absent", () => {
    const feat = {
      type: "surface",
      data: {
        id: "s-2",
        surface_type: "RUNWAY",
        boundary: null,
        width: 45,
        geometry: { type: "LineString", coordinates: [[0, 0, 0], [0.01, 0, 0]] },
      },
    } as unknown as MapFeature;
    const st = extractEditState(feat)!;
    expect(st.mode).toBe("polygon");
    expect(st.corners.length).toBeGreaterThanOrEqual(4);
  });
});

describe("radiusEdgePoint", () => {
  it("places the handle east of center at the given radius", () => {
    const [lng, lat] = radiusEdgePoint([10, 0], 1000);
    expect(lat).toBe(0);
    expect(lng).toBeGreaterThan(10);
  });
});

describe("buildVertexGeometryUpdate", () => {
  it("emits a closed polygon ring for a safety zone", () => {
    const st = extractEditState(safetyZone(squareRing))!;
    const u = buildVertexGeometryUpdate(safetyZone(squareRing), st)!;
    expect(u.geometry.type).toBe("Polygon");
    const ring = (u.geometry as GeoJSON.Polygon).coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("returns null when a polygon has fewer than 3 corners", () => {
    const st = { mode: "polygon" as const, corners: [[0, 0], [1, 1]] as [number, number][], center: [0, 0] as [number, number], radius: 0 };
    expect(buildVertexGeometryUpdate(safetyZone(squareRing), st)).toBeNull();
  });

  it("derives rounded width/length/heading for a 4-corner surface", () => {
    const feat = {
      type: "surface",
      data: {
        id: "s-3",
        surface_type: "RUNWAY",
        boundary: { type: "Polygon", coordinates: [squareRing] },
        geometry: { type: "LineString", coordinates: [] },
      },
    } as unknown as MapFeature;
    const st = extractEditState(feat)!;
    const u = buildVertexGeometryUpdate(feat, st)!;
    expect(u.geometry.type).toBe("LineString");
    expect(u.boundary).toBe(u.polygon);
    expect(typeof u.width).toBe("number");
    expect(typeof u.length).toBe("number");
    // heading is rounded to one decimal
    expect(u.heading).toBe(Math.round((u.heading ?? 0) * 10) / 10);
  });

  it("omits width for taxiways", () => {
    const feat = {
      type: "surface",
      data: {
        id: "s-4",
        surface_type: "TAXIWAY",
        boundary: { type: "Polygon", coordinates: [squareRing] },
        geometry: { type: "LineString", coordinates: [] },
      },
    } as unknown as MapFeature;
    const st = extractEditState(feat)!;
    const u = buildVertexGeometryUpdate(feat, st)!;
    expect(u.width).toBeUndefined();
  });
});
