import { describe, it, expect } from "vitest";
import { interpolateAltitude } from "./altitudeInterpolation";

describe("interpolateAltitude", () => {
  it("returns the mean at the segment midpoint", () => {
    const from: [number, number, number] = [0, 0, 0];
    const to: [number, number, number] = [0, 0.001, 50];
    const mid: [number, number] = [0, 0.0005];
    expect(interpolateAltitude(from, to, mid)).toBeCloseTo(25, 6);
  });

  it("returns from.alt at the from endpoint", () => {
    const from: [number, number, number] = [10, 20, 5];
    const to: [number, number, number] = [10.001, 20.001, 100];
    expect(interpolateAltitude(from, to, [from[0], from[1]])).toBeCloseTo(5, 6);
  });

  it("returns to.alt at the to endpoint", () => {
    const from: [number, number, number] = [10, 20, 5];
    const to: [number, number, number] = [10.001, 20.001, 100];
    expect(interpolateAltitude(from, to, [to[0], to[1]])).toBeCloseTo(100, 6);
  });

  it("clamps to from.alt when click is before the from endpoint", () => {
    const from: [number, number, number] = [0, 0, 10];
    const to: [number, number, number] = [0, 0.001, 50];
    expect(interpolateAltitude(from, to, [0, -0.0005])).toBeCloseTo(10, 6);
  });

  it("clamps to to.alt when click is past the to endpoint", () => {
    const from: [number, number, number] = [0, 0, 10];
    const to: [number, number, number] = [0, 0.001, 50];
    expect(interpolateAltitude(from, to, [0, 0.002])).toBeCloseTo(50, 6);
  });

  it("returns from.alt for a zero-length segment without producing NaN", () => {
    const from: [number, number, number] = [5, 5, 42];
    const to: [number, number, number] = [5, 5, 99];
    const result = interpolateAltitude(from, to, [5, 5]);
    expect(result).toBe(42);
    expect(Number.isNaN(result)).toBe(false);
  });

  it("interpolates a TAKEOFF -> cruise segment at 25%", () => {
    const from: [number, number, number] = [12.34, 56.78, 0];
    const to: [number, number, number] = [12.34, 56.781, 50];
    const quarter: [number, number] = [12.34, 56.78025];
    expect(interpolateAltitude(from, to, quarter)).toBeCloseTo(12.5, 4);
  });

  it("stays monotonic on a descending segment (from.alt > to.alt)", () => {
    const from: [number, number, number] = [0, 0, 80];
    const to: [number, number, number] = [0, 0.001, 20];
    const at25: [number, number] = [0, 0.00025];
    const at75: [number, number] = [0, 0.00075];
    const a = interpolateAltitude(from, to, at25);
    const b = interpolateAltitude(from, to, at75);
    expect(a).toBeGreaterThan(b);
    expect(a).toBeCloseTo(65, 4);
    expect(b).toBeCloseTo(35, 4);
  });

  it("projects an off-line click onto the segment", () => {
    // click is offset perpendicular to the segment - projection should still land at midpoint
    const from: [number, number, number] = [0, 0, 0];
    const to: [number, number, number] = [0, 0.001, 100];
    const offMid: [number, number] = [0.0005, 0.0005];
    expect(interpolateAltitude(from, to, offMid)).toBeCloseTo(50, 4);
  });
});
