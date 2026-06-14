import { describe, expect, it } from "vitest";
import {
  GEOZONE_ADVISORY_FORMATS,
  GEOZONE_CAPABLE_FORMATS,
  GEOZONE_ENFORCED_FORMATS,
  canIncludeGeozones,
} from "./exportCapabilities";

describe("GEOZONE_*_FORMATS sets", () => {
  it("CAPABLE = ENFORCED + ADVISORY", () => {
    const union = new Set([
      ...GEOZONE_ENFORCED_FORMATS,
      ...GEOZONE_ADVISORY_FORMATS,
    ]);
    expect([...GEOZONE_CAPABLE_FORMATS].sort()).toEqual([...union].sort());
  });

  it("ENFORCED and ADVISORY are disjoint", () => {
    for (const fmt of GEOZONE_ENFORCED_FORMATS) {
      expect(GEOZONE_ADVISORY_FORMATS.has(fmt)).toBe(false);
    }
  });
});

describe("canIncludeGeozones", () => {
  const drone = { supports_geozone_upload: true };

  it("returns disabled when no formats are selected", () => {
    expect(canIncludeGeozones([], drone)).toEqual({
      enabled: false,
      reasonKey: "noFormatSelected",
    });
  });

  it("returns disabled when only incapable formats are selected", () => {
    expect(canIncludeGeozones(["GPX", "CSV"], drone)).toEqual({
      enabled: false,
      reasonKey: "noCapableFormat",
    });
  });

  it("returns disabled when no drone is supplied", () => {
    expect(canIncludeGeozones(["MAVLINK"], null)).toEqual({
      enabled: false,
      reasonKey: "droneNotSelected",
    });
  });

  it("returns disabled when drone lacks the capability", () => {
    expect(canIncludeGeozones(["MAVLINK"], { supports_geozone_upload: false })).toEqual({
      enabled: false,
      reasonKey: "droneIncapable",
    });
  });

  it("returns enabled when at least one capable format and drone supports it", () => {
    expect(canIncludeGeozones(["MAVLINK", "GPX"], drone)).toEqual({
      enabled: true,
    });
  });

  it("treats KML and KMZ as capable (advisory)", () => {
    expect(canIncludeGeozones(["KML"], drone).enabled).toBe(true);
    expect(canIncludeGeozones(["KMZ"], drone).enabled).toBe(true);
  });
});
