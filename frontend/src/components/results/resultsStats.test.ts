import { describe, it, expect } from "vitest";
import type { LightSeries } from "@/types/measurement";
import { computeGlidePathAngle, seriesStats } from "./resultsStats";

function light(over: Partial<LightSeries>): LightSeries {
  return {
    light_name: "PAPI_A",
    setting_angle: null,
    tolerance: null,
    transition_angle_min: null,
    transition_angle_middle: null,
    transition_angle_max: null,
    transition_angle_min_touchpoint: null,
    transition_angle_middle_touchpoint: null,
    transition_angle_max_touchpoint: null,
    passed: null,
    points: [],
    ...over,
  };
}

describe("computeGlidePathAngle", () => {
  it("returns the midpoint of B.max and C.min when both present", () => {
    const lights = [
      light({ light_name: "PAPI_B", transition_angle_max: 3.2 }),
      light({ light_name: "PAPI_C", transition_angle_min: 2.8 }),
    ];
    expect(computeGlidePathAngle(lights)).toBeCloseTo(3.0);
  });

  it("returns null when either transition is missing or the lights are absent", () => {
    expect(
      computeGlidePathAngle([light({ light_name: "PAPI_B", transition_angle_max: 3.2 })]),
    ).toBeNull();
    expect(computeGlidePathAngle([])).toBeNull();
  });
});

describe("seriesStats", () => {
  it("computes min/max/avg/range over the finite values", () => {
    expect(seriesStats([2, 4, 6])).toEqual({
      min: 2,
      max: 6,
      avg: 4,
      range: 4,
    });
  });

  it("ignores null values", () => {
    expect(seriesStats([null, 10, null, 20])).toEqual({
      min: 10,
      max: 20,
      avg: 15,
      range: 10,
    });
  });

  it("returns null for an all-null or empty series", () => {
    expect(seriesStats([])).toBeNull();
    expect(seriesStats([null, null])).toBeNull();
  });

  it("yields a zero range for a single value", () => {
    expect(seriesStats([7])).toEqual({ min: 7, max: 7, avg: 7, range: 0 });
  });
});
