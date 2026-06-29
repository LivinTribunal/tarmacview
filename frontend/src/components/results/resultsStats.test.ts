import { describe, it, expect } from "vitest";
import { seriesStats } from "./resultsStats";

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
