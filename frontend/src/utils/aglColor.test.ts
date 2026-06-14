import { describe, it, expect } from "vitest";
import { aglColorForType } from "./aglColor";
import { AGL_COLORS } from "@/constants/palette";

describe("aglColorForType", () => {
  it("returns the PAPI palette token", () => {
    expect(aglColorForType("PAPI")).toBe(AGL_COLORS.PAPI);
  });

  it("returns the runway-edge-lights palette token", () => {
    expect(aglColorForType("RUNWAY_EDGE_LIGHTS")).toBe(AGL_COLORS.RUNWAY_EDGE_LIGHTS);
  });

  it("falls back to the default token for null / undefined", () => {
    expect(aglColorForType(null)).toBe(AGL_COLORS.DEFAULT);
    expect(aglColorForType(undefined)).toBe(AGL_COLORS.DEFAULT);
  });

  it("falls back to the default token for an unknown type", () => {
    expect(aglColorForType("SOMETHING_ELSE")).toBe(AGL_COLORS.DEFAULT);
  });

  it("preserves the historic hex values (behavior-neutral)", () => {
    expect(aglColorForType("PAPI")).toBe("#e91e90");
    expect(aglColorForType("RUNWAY_EDGE_LIGHTS")).toBe("#f7b32b");
    expect(aglColorForType(null)).toBe("#e91e90");
  });
});
