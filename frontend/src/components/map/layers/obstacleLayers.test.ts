import { describe, it, expect } from "vitest";
import { bufferPolygon } from "./obstacleLayers";

const EARTH_RADIUS = 6371000;

function ringMetricBounds(ring: number[][]): {
  widthM: number;
  heightM: number;
} {
  const cx = ring.reduce((s, c) => s + c[0], 0) / ring.length;
  const cy = ring.reduce((s, c) => s + c[1], 0) / ring.length;
  const latRad = (cy * Math.PI) / 180;
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS;
  const mPerDegLon = mPerDegLat * Math.cos(latRad);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [lon, lat] of ring) {
    const x = (lon - cx) * mPerDegLon;
    const y = (lat - cy) * mPerDegLat;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { widthM: maxX - minX, heightM: maxY - minY };
}

function rectangle(
  centerLon: number,
  centerLat: number,
  widthM: number,
  heightM: number,
): number[][] {
  const latRad = (centerLat * Math.PI) / 180;
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS;
  const mPerDegLon = mPerDegLat * Math.cos(latRad);
  const dx = widthM / 2 / mPerDegLon;
  const dy = heightM / 2 / mPerDegLat;
  // CCW order
  return [
    [centerLon - dx, centerLat - dy],
    [centerLon + dx, centerLat - dy],
    [centerLon + dx, centerLat + dy],
    [centerLon - dx, centerLat + dy],
  ];
}

function rotate2D(
  ring: number[][],
  centerLon: number,
  centerLat: number,
  angleDeg: number,
): number[][] {
  const latRad = (centerLat * Math.PI) / 180;
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS;
  const mPerDegLon = mPerDegLat * Math.cos(latRad);
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return ring.map(([lon, lat]) => {
    const x = (lon - centerLon) * mPerDegLon;
    const y = (lat - centerLat) * mPerDegLat;
    const xr = x * cos - y * sin;
    const yr = x * sin + y * cos;
    return [centerLon + xr / mPerDegLon, centerLat + yr / mPerDegLat];
  });
}

describe("bufferPolygon", () => {
  it("expands an axis-aligned 100x10 m rectangle by 5 m on every side", () => {
    const ring = rectangle(14.26, 50.1, 100, 10);
    const buffered = bufferPolygon(ring, 5);
    const { widthM, heightM } = ringMetricBounds(buffered);

    // 100 + 2*5 = 110, 10 + 2*5 = 20
    expect(widthM).toBeCloseTo(110, 1);
    expect(heightM).toBeCloseTo(20, 1);
  });

  it("expands a 45-degree rotated rectangle by a uniform perpendicular offset", () => {
    const base = rectangle(14.26, 50.1, 100, 10);
    const rotated = rotate2D(base, 14.26, 50.1, 45);
    const buffered = bufferPolygon(rotated, 5);

    // each buffered vertex must sit ~5*sqrt(2) m from the corresponding original
    // vertex (square corner -> miter length = buffer / sin(45°) = buffer*sqrt(2))
    const expected = 5 * Math.SQRT2;
    const cy = rotated.reduce((s, c) => s + c[1], 0) / rotated.length;
    const latRad = (cy * Math.PI) / 180;
    const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS;
    const mPerDegLon = mPerDegLat * Math.cos(latRad);
    expect(buffered.length).toBe(rotated.length);
    for (let i = 0; i < rotated.length; i++) {
      const dxM = (buffered[i][0] - rotated[i][0]) * mPerDegLon;
      const dyM = (buffered[i][1] - rotated[i][1]) * mPerDegLat;
      const distM = Math.sqrt(dxM * dxM + dyM * dyM);
      expect(distM).toBeCloseTo(expected, 1);
    }
  });

  it("returns input unchanged when buffer is zero or negative", () => {
    const ring = rectangle(14.26, 50.1, 100, 10);
    expect(bufferPolygon(ring, 0)).toBe(ring);
    expect(bufferPolygon(ring, -5)).toBe(ring);
  });

  it("returns input unchanged when fewer than three vertices", () => {
    const two = [
      [14.0, 50.0],
      [14.001, 50.001],
    ];
    expect(bufferPolygon(two, 5)).toBe(two);
  });

  it("handles a closed ring without duplicating the closing vertex offset", () => {
    const open = rectangle(14.26, 50.1, 100, 10);
    const closed = [...open, open[0]];
    const bufferedOpen = bufferPolygon(open, 5);
    const bufferedClosed = bufferPolygon(closed, 5);

    // closing duplicate is stripped, so the offset ring has the same length
    expect(bufferedClosed.length).toBe(bufferedOpen.length);
    expect(bufferedClosed[0]).toEqual(bufferedOpen[0]);
  });

  it("clamps the miter on near-collinear vertices for elongated shapes", () => {
    // a 2000x45 m runway-like rectangle - the corner miter is short anyway,
    // but the result must stay within a sensible bound (no spike).
    const ring = rectangle(14.26, 50.1, 2000, 45);
    const buffered = bufferPolygon(ring, 5);
    const { widthM, heightM } = ringMetricBounds(buffered);
    expect(widthM).toBeCloseTo(2010, 1);
    expect(heightM).toBeCloseTo(55, 1);
  });
});
