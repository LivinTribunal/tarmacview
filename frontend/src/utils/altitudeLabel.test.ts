import { describe, it, expect } from "vitest";
import { datumHeightLabel, mslAglLabel, mslAglRangeLabel } from "./altitudeLabel";

// stub t: resolves the datum + unit tokens we care about
const t = (key: string) => {
  const map: Record<string, string> = {
    "common.units.m": "m",
    "common.datum.msl": "MSL",
    "common.datum.agl": "AGL",
  };
  return map[key] ?? key;
};

describe("datumHeightLabel", () => {
  it("labels an MSL value", () => {
    expect(datumHeightLabel(1234.5, t, "MSL")).toBe("1234.50m MSL");
  });
  it("labels an AGL value with custom decimals", () => {
    expect(datumHeightLabel(12, t, "AGL", 1)).toBe("12.0m AGL");
  });
  it("returns empty string for null", () => {
    expect(datumHeightLabel(null, t, "MSL")).toBe("");
  });
});

describe("mslAglLabel", () => {
  it("joins both datums", () => {
    expect(mslAglLabel(123, 45, t)).toBe("123.00m MSL / 45.00m AGL");
  });
  it("drops the AGL segment when agl is null", () => {
    expect(mslAglLabel(123, null, t)).toBe("123.00m MSL");
  });
  it("returns just AGL when msl is null", () => {
    expect(mslAglLabel(null, 45, t)).toBe("45.00m AGL");
  });
});

describe("mslAglRangeLabel", () => {
  it("renders both ranges with arrows", () => {
    expect(mslAglRangeLabel(100, 140, 8.3, 24.5, t)).toBe(
      "100.0 → 140.0m MSL / 8.3 → 24.5m AGL",
    );
  });
  it("keeps a negative AGL bound readable", () => {
    expect(mslAglRangeLabel(100, 140, -2, 10, t)).toBe(
      "100.0 → 140.0m MSL / -2.0 → 10.0m AGL",
    );
  });
  it("drops the MSL pair when null", () => {
    expect(mslAglRangeLabel(null, null, 8.3, 24.5, t)).toBe("8.3 → 24.5m AGL");
  });
});
