import { describe, it, expect } from "vitest";
import { computeMehtHeight, resolveMehtHeight } from "./mehtHeight";

const DEFAULT_GLIDE_SLOPE_DEG = 3.0;

describe("computeMehtHeight", () => {
  it("computes distance * tan(glide slope)", () => {
    expect(computeMehtHeight(300, 3)).toBeCloseTo(15.72, 2);
  });
});

describe("resolveMehtHeight", () => {
  it("returns the surveyed value when meht_height_m is set", () => {
    const agl = { meht_height_m: 18.5, distance_from_threshold: 300, glide_slope_angle: 3 };
    expect(resolveMehtHeight(agl, DEFAULT_GLIDE_SLOPE_DEG)).toBe(18.5);
  });

  it("returns the surveyed value even when distance is null", () => {
    const agl = { meht_height_m: 18.5, distance_from_threshold: null, glide_slope_angle: null };
    expect(resolveMehtHeight(agl, DEFAULT_GLIDE_SLOPE_DEG)).toBe(18.5);
  });

  it("derives from distance and glide slope when meht_height_m is null", () => {
    const agl = { meht_height_m: null, distance_from_threshold: 300, glide_slope_angle: 3 };
    expect(resolveMehtHeight(agl, DEFAULT_GLIDE_SLOPE_DEG)).toBeCloseTo(15.72, 2);
  });

  it("falls back to the default glide slope when glide_slope_angle is null", () => {
    const agl = { meht_height_m: null, distance_from_threshold: 300, glide_slope_angle: null };
    expect(resolveMehtHeight(agl, DEFAULT_GLIDE_SLOPE_DEG)).toBeCloseTo(
      computeMehtHeight(300, DEFAULT_GLIDE_SLOPE_DEG),
      6,
    );
  });

  it("returns null when neither surveyed height nor distance is available", () => {
    const agl = { meht_height_m: null, distance_from_threshold: null, glide_slope_angle: 3 };
    expect(resolveMehtHeight(agl, DEFAULT_GLIDE_SLOPE_DEG)).toBeNull();
  });
});
