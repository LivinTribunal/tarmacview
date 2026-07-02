import { describe, it, expect } from "vitest";
import type { AGLResponse, LHAResponse, ObstacleResponse, SafetyZoneResponse } from "@/types/airport";
import { aglFields, labelKeyOf, lhaFields, obstacleFields, safetyZoneFields } from "./index";

const t = (key: string) => {
  const map: Record<string, string> = {
    "common.units.m": "m",
    "common.datum.msl": "MSL",
    "common.datum.agl": "AGL",
    "common.yes": "Yes",
    "common.no": "No",
  };
  return map[key] ?? key;
};

describe("featureFields label keys", () => {
  it("every field carries a featureFields.* (or existing) label key", () => {
    for (const def of [...obstacleFields, ...safetyZoneFields, ...aglFields, ...lhaFields]) {
      expect(def.labelKey.length).toBeGreaterThan(0);
    }
  });

  it("labelKeyOf resolves a data key to its label", () => {
    expect(labelKeyOf(obstacleFields, "height")).toBe("featureFields.height");
    expect(labelKeyOf(obstacleFields, "missing")).toBe("missing");
  });
});

describe("obstacle read formatters", () => {
  const obstacle = {
    height: 30,
    type: "TOWER",
    name: "Mast",
    buffer_distance: 15,
    base_altitude_msl: 5,
    top_altitude_msl: 35,
  } as ObstacleResponse;

  it("height is datum-labeled AGL", () => {
    const height = obstacleFields.find((f) => f.key === "height")!;
    expect(height.read!(obstacle, t)).toBe("30.00m AGL");
  });

  it("base/top are datum-labeled MSL", () => {
    expect(obstacleFields.find((f) => f.key === "base_altitude_msl")!.read!(obstacle, t)).toBe("5.00m MSL");
    expect(obstacleFields.find((f) => f.key === "top_altitude_msl")!.read!(obstacle, t)).toBe("35.00m MSL");
  });
});

describe("safety zone read formatters", () => {
  it("includes floorAgl / ceilingAgl derived fields", () => {
    const keys = safetyZoneFields.map((f) => f.key);
    expect(keys).toContain("altitude_floor_agl");
    expect(keys).toContain("altitude_ceiling_agl");
  });

  it("floor is MSL and floorAgl is AGL", () => {
    const zone = {
      altitude_floor: 250,
      altitude_floor_agl: 50,
    } as SafetyZoneResponse;
    expect(safetyZoneFields.find((f) => f.key === "altitude_floor")!.read!(zone, t)).toBe("250.00m MSL");
    expect(safetyZoneFields.find((f) => f.key === "altitude_floor_agl")!.read!(zone, t)).toBe("50.00m AGL");
  });
});

describe("agl read formatters", () => {
  it("includes mehtHeight, mehtAltitude and glideTolerance (read parity)", () => {
    const keys = aglFields.map((f) => f.key);
    expect(keys).toContain("meht_height_m");
    expect(keys).toContain("meht_altitude_msl");
    expect(keys).toContain("glide_slope_angle_tolerance");
  });

  it("meht fields are visible only for PAPI with data", () => {
    const papi = {
      agl_type: "PAPI",
      meht_height_m: 15,
      meht_altitude_msl: 315,
    } as AGLResponse;
    const rel = { agl_type: "RUNWAY_EDGE_LIGHTS", meht_height_m: 15 } as AGLResponse;
    const mehtHeight = aglFields.find((f) => f.key === "meht_height_m")!;
    const mehtAlt = aglFields.find((f) => f.key === "meht_altitude_msl")!;
    expect(mehtHeight.visible!(papi)).toBe(true);
    expect(mehtHeight.visible!(rel)).toBe(false);
    expect(mehtHeight.read!(papi, t)).toBe("15.00m AGL");
    expect(mehtAlt.read!(papi, t)).toBe("315.00m MSL");
  });
});

describe("lha read formatters", () => {
  it("lens heights carry MSL / AGL datums", () => {
    const lha = { lens_height_msl_m: 300, lens_height_agl_m: 12 } as LHAResponse;
    expect(lhaFields.find((f) => f.key === "lens_height_msl_m")!.read!(lha, t)).toBe("300.00m MSL");
    expect(lhaFields.find((f) => f.key === "lens_height_agl_m")!.read!(lha, t)).toBe("12.00m AGL");
  });
});
