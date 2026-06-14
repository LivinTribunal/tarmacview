import { describe, it, expect } from "vitest";
import { roundCoord, roundAlt } from "./coordRounding";

describe("roundCoord", () => {
  it("rounds to 6 decimal places", () => {
    expect(roundCoord(48.123456789)).toBe(48.123457);
  });

  it("leaves a value already within 6 dp untouched", () => {
    expect(roundCoord(17.000001)).toBe(17.000001);
  });

  it("rounds negatives half-up", () => {
    expect(roundCoord(-14.2606755)).toBe(-14.260675);
  });

  it("returns a number, not a string", () => {
    expect(typeof roundCoord(50.1)).toBe("number");
  });

  it("matches the inline idiom byte-for-byte across sampled inputs", () => {
    for (const x of [0, 14.26, -90.000001, 179.9999994, 48.1234565, -0.0000005]) {
      expect(roundCoord(x)).toBe(Math.round(x * 1e6) / 1e6);
    }
  });
});

describe("roundAlt", () => {
  it("rounds to 2 decimal places", () => {
    expect(roundAlt(123.456)).toBe(123.46);
  });

  it("leaves a value already within 2 dp untouched", () => {
    expect(roundAlt(45.5)).toBe(45.5);
  });

  it("rounds negatives half-up", () => {
    expect(roundAlt(-2.005)).toBe(-2);
  });

  it("returns a number, not a string", () => {
    expect(typeof roundAlt(3000)).toBe("number");
  });

  it("matches the inline idiom byte-for-byte across sampled inputs", () => {
    for (const x of [0, 3000, 45.456, -12.005, 0.004, 999.999]) {
      expect(roundAlt(x)).toBe(Math.round(x * 100) / 100);
    }
  });
});
