import { describe, expect, it } from "vitest";
import { EARTH_RADIUS_M, METRES_PER_DEGREE } from "./geo";
import { EARTH_RADIUS } from "@/utils/geo";

describe("geo constants single source", () => {
  it("pins the spherical earth radius value", () => {
    expect(EARTH_RADIUS_M).toBe(6_371_000);
  });

  it("pins the metres-per-degree value", () => {
    expect(METRES_PER_DEGREE).toBe(111_320);
  });

  it("keeps the historic utils/geo EARTH_RADIUS re-export in sync", () => {
    expect(EARTH_RADIUS).toBe(EARTH_RADIUS_M);
  });
});
