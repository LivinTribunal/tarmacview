import { describe, it, expect } from "vitest";
import { formatLat, formatLon, formatAlt } from "./coordinates";

describe("formatLat / formatLon", () => {
  it("formats latitude at 9 decimals", () => {
    expect(formatLat(49.171234567891)).toBe("49.171234568");
  });

  it("formats longitude at 9 decimals", () => {
    expect(formatLon(18.6123456784)).toBe("18.612345678");
  });

  it("pads a short value out to 9 decimals", () => {
    expect(formatLat(49.5)).toBe("49.500000000");
  });

  it("preserves negative coordinates", () => {
    expect(formatLon(-122.123456789)).toBe("-122.123456789");
  });

  it("honours a decimal override (AGL panel uses 8 dp)", () => {
    expect(formatLat(50.123456789, 8)).toBe("50.12345679");
    expect(formatLon(14.987654321, 8)).toBe("14.98765432");
  });

  it("returns empty string for null/undefined/NaN", () => {
    expect(formatLat(null)).toBe("");
    expect(formatLon(undefined)).toBe("");
    expect(formatLat(Number.NaN)).toBe("");
  });
});

describe("formatAlt", () => {
  it("defaults to 1 decimal", () => {
    expect(formatAlt(234.456)).toBe("234.5");
  });

  it("honours a custom decimal count", () => {
    expect(formatAlt(234.456, 2)).toBe("234.46");
  });

  it("formats zero altitude", () => {
    expect(formatAlt(0)).toBe("0.0");
  });

  it("returns empty string for null/undefined/NaN", () => {
    expect(formatAlt(null)).toBe("");
    expect(formatAlt(undefined, 2)).toBe("");
    expect(formatAlt(Number.NaN)).toBe("");
  });
});
