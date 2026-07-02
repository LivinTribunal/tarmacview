import { describe, it, expect } from "vitest";
import { methodBadgeStyle } from "./inspectionMethodBadge";

describe("methodBadgeStyle", () => {
  it("derives bg/text css vars from a known method slug", () => {
    expect(methodBadgeStyle("HORIZONTAL_RANGE")).toEqual({
      backgroundColor: "var(--tv-method-horizontal-range-bg)",
      color: "var(--tv-method-horizontal-range-text)",
    });
  });

  it("slugifies multi-underscore method names", () => {
    expect(methodBadgeStyle("PARALLEL_SIDE_SWEEP")).toEqual({
      backgroundColor: "var(--tv-method-parallel-side-sweep-bg)",
      color: "var(--tv-method-parallel-side-sweep-text)",
    });
  });

  it("derives runway-horizontal-range vars from its slug", () => {
    expect(methodBadgeStyle("RUNWAY_HORIZONTAL_RANGE")).toEqual({
      backgroundColor: "var(--tv-method-runway-horizontal-range-bg)",
      color: "var(--tv-method-runway-horizontal-range-text)",
    });
  });

  it("returns no styling for an unknown method", () => {
    expect(methodBadgeStyle("NOT_A_METHOD")).toEqual({});
    expect(methodBadgeStyle("")).toEqual({});
  });
});
