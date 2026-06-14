import { describe, expect, it } from "vitest";
import { orderPolygonRing, pointsToPolygon } from "./orderPolygonRing";

describe("orderPolygonRing", () => {
  it("returns the input unchanged for fewer than 3 points", () => {
    expect(orderPolygonRing([])).toEqual([]);
    expect(orderPolygonRing([[1, 2]])).toEqual([[1, 2]]);
    expect(orderPolygonRing([[1, 2], [3, 4]])).toEqual([[1, 2], [3, 4]]);
  });

  it("orders scattered square corners into a non-self-intersecting ring", () => {
    // corners fed in a self-crossing order (diagonal-first)
    const scrambled: [number, number][] = [
      [0, 0],
      [1, 1],
      [1, 0],
      [0, 1],
    ];
    const ring = orderPolygonRing(scrambled);

    // walking the ring, consecutive corners must be edges of the square
    // (length 1), never the diagonal (length sqrt(2)) - that is what makes
    // it non-self-intersecting.
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      expect(dist).toBeCloseTo(1, 6);
    }
  });

  it("sorts counter-clockwise by polar angle around the centroid", () => {
    const pts: [number, number][] = [
      [0, 1],
      [-1, 0],
      [1, 0],
      [0, -1],
    ];
    const ring = orderPolygonRing(pts);
    // centroid is the origin; atan2 ascending starts at the -x axis (pi),
    // wrapping through -pi.. so the order is bottom, right, top, left
    expect(ring).toEqual([
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]);
  });

  it("does not mutate the input array", () => {
    const pts: [number, number][] = [[0, 0], [1, 1], [1, 0]];
    const copy = pts.map((p) => [...p]);
    orderPolygonRing(pts);
    expect(pts).toEqual(copy);
  });
});

describe("pointsToPolygon", () => {
  it("builds a closed GeoJSON polygon with the first vertex repeated", () => {
    const pts: [number, number][] = [[0, 0], [1, 1], [1, 0], [0, 1]];
    const polygon = pointsToPolygon(pts);

    expect(polygon.type).toBe("Polygon");
    const ring = polygon.coordinates[0];
    expect(ring.length).toBe(5);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("preserves the caller's vertex order (no re-sort)", () => {
    // a deliberately non-polar order must survive so a manual reorder in the
    // extractor dialog actually takes effect
    const ordered: [number, number][] = [[0, 1], [1, 0], [0, 0], [1, 1]];
    const polygon = pointsToPolygon(ordered);
    expect(polygon.coordinates[0]).toEqual([
      [0, 1],
      [1, 0],
      [0, 0],
      [1, 1],
      [0, 1],
    ]);
  });

  it("emits an empty ring for no points", () => {
    const polygon = pointsToPolygon([]);
    expect(polygon.coordinates[0]).toEqual([]);
  });
});
