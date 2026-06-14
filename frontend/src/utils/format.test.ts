import { describe, it, expect } from "vitest";
import { formatNumber, formatDate, formatDuration, formatDurationLong } from "./format";

describe("formatNumber", () => {
  it("formats zero with the requested decimals", () => {
    expect(formatNumber(0, 1)).toBe("0.0");
  });

  it("pads integer inputs to the requested decimals", () => {
    expect(formatNumber(12, 2)).toBe("12.00");
  });

  it("truncates and rounds a long double to two decimals", () => {
    expect(formatNumber(12.345678901234, 2)).toBe("12.35");
  });

  it("truncates and rounds a long double to one decimal", () => {
    expect(formatNumber(12.345678901234, 1)).toBe("12.3");
  });

  it("preserves negative numbers", () => {
    expect(formatNumber(-3.7, 1)).toBe("-3.7");
  });

  it("returns empty string for null", () => {
    expect(formatNumber(null, 1)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatNumber(undefined, 1)).toBe("");
  });

  it("rounds to zero decimals", () => {
    expect(formatNumber(0.999, 0)).toBe("1");
  });

  it("returns empty string for NaN", () => {
    expect(formatNumber(Number.NaN, 1)).toBe("");
  });
});

describe("formatDate", () => {
  it("formats an iso date string as a localized day", () => {
    expect(formatDate("2026-03-19T00:00:00Z")).toMatch(/2026/);
  });
});

describe("formatDuration", () => {
  it("formats whole minutes with zero-padded seconds", () => {
    expect(formatDuration(120)).toBe("2:00");
  });

  it("zero-pads single-digit seconds", () => {
    expect(formatDuration(125)).toBe("2:05");
  });

  it("handles sub-minute durations", () => {
    expect(formatDuration(42)).toBe("0:42");
  });

  it("rounds fractional seconds", () => {
    expect(formatDuration(125.6)).toBe("2:06");
  });
});

describe("formatDurationLong", () => {
  it("returns em-dash for null", () => {
    expect(formatDurationLong(null)).toBe("—");
  });

  it("formats sub-hour durations in minutes", () => {
    expect(formatDurationLong(300)).toBe("5 min");
  });

  it("rounds seconds to the nearest minute", () => {
    expect(formatDurationLong(330)).toBe("6 min");
  });

  it("formats whole-hour durations without remainder", () => {
    expect(formatDurationLong(3600)).toBe("1h");
  });

  it("formats hour-plus-minutes durations", () => {
    expect(formatDurationLong(5400)).toBe("1h 30m");
  });
});
