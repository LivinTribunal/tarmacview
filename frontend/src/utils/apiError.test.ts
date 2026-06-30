import { describe, it, expect } from "vitest";
import { apiErrorMessage, extractApiErrorMessage } from "./apiError";

describe("extractApiErrorMessage", () => {
  it("reads a string detail", () => {
    expect(extractApiErrorMessage({ response: { data: { detail: "boom" } } })).toBe("boom");
  });

  it("reads a {message} detail object", () => {
    expect(
      extractApiErrorMessage({ response: { data: { detail: { message: "nope" } } } }),
    ).toBe("nope");
  });

  it("returns null when there is no usable detail", () => {
    expect(extractApiErrorMessage({ response: { data: {} } })).toBeNull();
    expect(extractApiErrorMessage(new Error("x"))).toBeNull();
    expect(extractApiErrorMessage(null)).toBeNull();
  });
});

describe("apiErrorMessage", () => {
  it("returns the extracted message when present", () => {
    expect(apiErrorMessage({ response: { data: { detail: "boom" } } }, "fb")).toBe("boom");
  });

  it("falls back when no message is present", () => {
    expect(apiErrorMessage(new Error("x"), "fb")).toBe("fb");
  });
});
