import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import WarningInfoPanel from "./WarningInfoPanel";
import type { ValidationViolation } from "@/types/flightPlan";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

function makeViolation(overrides: Partial<ValidationViolation> = {}): ValidationViolation {
  /** test factory for a ValidationViolation. */
  return {
    id: "v1",
    category: "warning",
    is_warning: true,
    severity: "warning",
    message: "msg",
    constraint_id: null,
    constraint_name: "Surface Crossing",
    violation_kind: "surface_crossing",
    waypoint_ref: null,
    waypoint_ids: [],
    ...overrides,
  };
}

describe("WarningInfoPanel surface_crossing rendering", () => {
  it("renders crossing detail for the per-transit message format", () => {
    const v = makeViolation({
      message: "wp 24-25 (WaypointType.TRANSIT): crosses RUNWAY 1 (1m)",
    });
    render(<WarningInfoPanel violation={v} onClose={() => {}} />);

    expect(screen.getByText("map.warningSuggestion.surfaceCrossing")).toBeTruthy();
    expect(screen.getByText(/1m crossing RUNWAY 1/i)).toBeTruthy();
  });

  it("renders crossing detail for the grouped-measurement message format", () => {
    const v = makeViolation({
      message: "inspection 2 crosses TAXIWAY A during measurement (3 segments)",
    });
    render(<WarningInfoPanel violation={v} onClose={() => {}} />);

    // suggestion is kind-driven, independent of message format
    expect(screen.getByText("map.warningSuggestion.surfaceCrossing")).toBeTruthy();
    expect(screen.getByText("map.warningActualCrossing")).toBeTruthy();
  });

  it("falls back to message regex when violation_kind is null (legacy row)", () => {
    const v = makeViolation({
      violation_kind: null,
      constraint_name: null,
      message: "wp 3-4 (WaypointType.TRANSIT): crosses RUNWAY 09L (5m)",
    });
    render(<WarningInfoPanel violation={v} onClose={() => {}} />);

    expect(screen.getByText("map.warningSuggestion.surfaceCrossing")).toBeTruthy();
    expect(screen.getByText(/5m crossing RUNWAY 09L/i)).toBeTruthy();
  });
});
