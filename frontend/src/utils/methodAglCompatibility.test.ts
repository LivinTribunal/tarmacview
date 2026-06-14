import { describe, it, expect } from "vitest";
import {
  AGL_AGNOSTIC_METHODS,
  ALL_INSPECTION_METHODS,
  METHOD_AGL_COMPAT,
  METHOD_CAPABILITIES,
  METHODS_BY_AGL,
  aglTypesForMethod,
  compatibleMethods,
  isMethodCompatibleWithAgl,
  methodCaps,
  methodsForAgl,
} from "./methodAglCompatibility";

describe("isMethodCompatibleWithAgl", () => {
  it("PAPI accepts VERTICAL_PROFILE / HORIZONTAL_RANGE / APPROACH_DESCENT", () => {
    expect(isMethodCompatibleWithAgl("VERTICAL_PROFILE", "PAPI")).toBe(true);
    expect(isMethodCompatibleWithAgl("HORIZONTAL_RANGE", "PAPI")).toBe(true);
    expect(isMethodCompatibleWithAgl("APPROACH_DESCENT", "PAPI")).toBe(true);
  });

  it("PAPI accepts MEHT_CHECK", () => {
    expect(isMethodCompatibleWithAgl("MEHT_CHECK", "PAPI")).toBe(true);
  });

  it("PAPI rejects FLY_OVER, PARALLEL_SIDE_SWEEP, and HOVER_POINT_LOCK", () => {
    expect(isMethodCompatibleWithAgl("FLY_OVER", "PAPI")).toBe(false);
    expect(isMethodCompatibleWithAgl("PARALLEL_SIDE_SWEEP", "PAPI")).toBe(false);
    expect(isMethodCompatibleWithAgl("HOVER_POINT_LOCK", "PAPI")).toBe(false);
  });

  it("RUNWAY_EDGE_LIGHTS accepts FLY_OVER / PARALLEL_SIDE_SWEEP", () => {
    expect(isMethodCompatibleWithAgl("FLY_OVER", "RUNWAY_EDGE_LIGHTS")).toBe(true);
    expect(isMethodCompatibleWithAgl("PARALLEL_SIDE_SWEEP", "RUNWAY_EDGE_LIGHTS")).toBe(true);
  });

  it("RUNWAY_EDGE_LIGHTS rejects VERTICAL_PROFILE, HORIZONTAL_RANGE, HOVER_POINT_LOCK, and MEHT_CHECK", () => {
    expect(isMethodCompatibleWithAgl("VERTICAL_PROFILE", "RUNWAY_EDGE_LIGHTS")).toBe(false);
    expect(isMethodCompatibleWithAgl("HORIZONTAL_RANGE", "RUNWAY_EDGE_LIGHTS")).toBe(false);
    expect(isMethodCompatibleWithAgl("HOVER_POINT_LOCK", "RUNWAY_EDGE_LIGHTS")).toBe(false);
    expect(isMethodCompatibleWithAgl("MEHT_CHECK", "RUNWAY_EDGE_LIGHTS")).toBe(false);
  });
});

describe("methodsForAgl / aglTypesForMethod", () => {
  it("methodsForAgl returns expected method count per type", () => {
    expect(methodsForAgl("PAPI")).toHaveLength(4);
    expect(methodsForAgl("RUNWAY_EDGE_LIGHTS")).toHaveLength(2);
  });

  it("aglTypesForMethod matches matrix entries", () => {
    expect(aglTypesForMethod("HOVER_POINT_LOCK")).toEqual([]);
    expect(aglTypesForMethod("VERTICAL_PROFILE")).toEqual(["PAPI"]);
    expect(aglTypesForMethod("APPROACH_DESCENT")).toEqual(["PAPI"]);
    expect(aglTypesForMethod("FLY_OVER")).toEqual(["RUNWAY_EDGE_LIGHTS"]);
    expect(aglTypesForMethod("MEHT_CHECK")).toEqual(["PAPI"]);
  });
});

describe("compatibleMethods", () => {
  it("filters a method list by required AGL set (single)", () => {
    const result = compatibleMethods(
      ["VERTICAL_PROFILE", "FLY_OVER", "HOVER_POINT_LOCK"],
      ["PAPI"],
    );
    expect(result).toEqual(["VERTICAL_PROFILE"]);
  });

  it("returns empty when mixed AGL types are required", () => {
    const result = compatibleMethods(
      ["VERTICAL_PROFILE", "FLY_OVER", "HOVER_POINT_LOCK"],
      ["PAPI", "RUNWAY_EDGE_LIGHTS"],
    );
    expect(result).toEqual([]);
  });

  it("empty agl list returns all methods", () => {
    const all = ["VERTICAL_PROFILE", "FLY_OVER"] as const;
    expect(compatibleMethods([...all], [])).toEqual([...all]);
  });
});

describe("matrix shape", () => {
  it("every AGL-specific method has at least one compatible AGL type", () => {
    // hover-point-lock and surface-scan are AGL-agnostic (empty list joins them
    // into AGL_AGNOSTIC_METHODS); every other method must target an AGL type.
    for (const [method, allowed] of Object.entries(METHOD_AGL_COMPAT)) {
      if (method === "HOVER_POINT_LOCK" || method === "SURFACE_SCAN") {
        expect(allowed).toHaveLength(0);
      } else {
        expect(allowed.length).toBeGreaterThan(0);
      }
    }
  });

  it("AGL_AGNOSTIC_METHODS contains hover-point-lock and surface-scan", () => {
    expect(AGL_AGNOSTIC_METHODS).toContain("HOVER_POINT_LOCK");
    expect(AGL_AGNOSTIC_METHODS).toContain("SURFACE_SCAN");
  });

  it("METHODS_BY_AGL is the inverse of METHOD_AGL_COMPAT", () => {
    for (const [method, agls] of Object.entries(METHOD_AGL_COMPAT)) {
      for (const agl of agls) {
        expect(METHODS_BY_AGL[agl]).toContain(method);
      }
    }
  });
});

describe("METHOD_CAPABILITIES", () => {
  it("has one entry per inspection method", () => {
    const keys = Object.keys(METHOD_CAPABILITIES).sort();
    expect(keys).toEqual([...ALL_INSPECTION_METHODS].sort());
  });

  it("methodCaps returns the table row", () => {
    expect(methodCaps("SURFACE_SCAN")).toBe(METHOD_CAPABILITIES.SURFACE_SCAN);
  });

  it("surface scan targets a surface and drops density/hover but keeps direction", () => {
    expect(methodCaps("SURFACE_SCAN")).toMatchObject({
      target: "SURFACE",
      usesDensity: false,
      usesHover: false,
      usesDirection: true,
      formSlot: "trailing",
    });
  });

  it("hover point lock drops speed/density and targets an LHA", () => {
    expect(methodCaps("HOVER_POINT_LOCK")).toMatchObject({
      target: "LHA",
      usesMeasurementSpeed: false,
      usesDensity: false,
      usesDirection: false,
      formSlot: "trailing",
    });
  });

  it("meht check drops speed/density", () => {
    expect(methodCaps("MEHT_CHECK")).toMatchObject({
      usesMeasurementSpeed: false,
      usesDensity: false,
      usesDirection: false,
      formSlot: "trailing",
    });
  });

  it("vertical profile and horizontal range have no method-specific FormSection slot", () => {
    expect(methodCaps("VERTICAL_PROFILE").formSlot).toBeNull();
    expect(methodCaps("HORIZONTAL_RANGE").formSlot).toBeNull();
  });

  it("only surface scan targets a surface", () => {
    const surfaceMethods = ALL_INSPECTION_METHODS.filter(
      (m) => methodCaps(m).target === "SURFACE",
    );
    expect(surfaceMethods).toEqual(["SURFACE_SCAN"]);
  });

  it("usesDirection matches the four orientation methods", () => {
    const oriented = ALL_INSPECTION_METHODS.filter((m) => methodCaps(m).usesDirection);
    expect(oriented.sort()).toEqual(
      ["FLY_OVER", "HORIZONTAL_RANGE", "PARALLEL_SIDE_SWEEP", "SURFACE_SCAN"].sort(),
    );
  });
});
