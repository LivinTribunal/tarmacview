import { describe, it, expect } from "vitest";
import { alongRunwayDistanceFromThreshold } from "./aglDistance";

describe("alongRunwayDistanceFromThreshold", () => {
  // shared (threshold, end, point) fixtures with the expected float computed by
  // the python helper in backend/app/services/airport/surfaces.py, captured at
  // a tighter tolerance than any sub-cm rounding the UI uses.
  it("matches python helper for a point near the centerline (parity)", () => {
    const threshold: [number, number] = [17.213, 48.170];
    const end: [number, number] = [17.265, 48.190];
    const point: [number, number] = [17.221, 48.173];
    const expected = 680.5628713137744;
    const got = alongRunwayDistanceFromThreshold(threshold, end, point[0], point[1]);
    expect(got).not.toBeNull();
    expect(Math.abs((got as number) - expected)).toBeLessThan(1e-6);
  });

  it("matches python helper for an off-axis point (parity)", () => {
    const threshold: [number, number] = [17.213, 48.170];
    const end: [number, number] = [17.265, 48.190];
    const point: [number, number] = [17.225, 48.180];
    const expected = 1326.5027678018357;
    const got = alongRunwayDistanceFromThreshold(threshold, end, point[0], point[1]);
    expect(got).not.toBeNull();
    expect(Math.abs((got as number) - expected)).toBeLessThan(1e-6);
  });

  it("returns 0 when the queried point equals the threshold", () => {
    const threshold: [number, number] = [17.213, 48.170];
    const end: [number, number] = [17.265, 48.190];
    const got = alongRunwayDistanceFromThreshold(threshold, end, threshold[0], threshold[1]);
    expect(got).not.toBeNull();
    expect(Math.abs(got as number)).toBeLessThan(1e-9);
  });

  it("returns null when threshold is missing", () => {
    const end: [number, number] = [17.265, 48.190];
    expect(alongRunwayDistanceFromThreshold(null, end, 17.221, 48.173)).toBeNull();
    expect(alongRunwayDistanceFromThreshold(undefined, end, 17.221, 48.173)).toBeNull();
  });

  it("returns null when end is missing", () => {
    const threshold: [number, number] = [17.213, 48.170];
    expect(alongRunwayDistanceFromThreshold(threshold, null, 17.221, 48.173)).toBeNull();
  });
});
