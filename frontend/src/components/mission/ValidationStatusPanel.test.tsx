import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ValidationStatusPanel from "./ValidationStatusPanel";
import type { FlightPlanResponse, ValidationViolation } from "@/types/flightPlan";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: "mission-1" }),
}));

function violation(kind: string | null, isWarning: boolean): ValidationViolation {
  /** minimal ValidationViolation with a given kind/severity. */
  return {
    id: `v-${kind}-${isWarning}`,
    category: isWarning ? "warning" : "violation",
    is_warning: isWarning,
    severity: isWarning ? "warning" : "violation",
    message: "irrelevant - panel matches on violation_kind",
    constraint_id: null,
    constraint_name: null,
    violation_kind: kind,
    waypoint_ref: null,
    waypoint_ids: [],
  };
}

function flightPlan(violations: ValidationViolation[]): FlightPlanResponse {
  /** wrap violations in the minimal shape the panel reads. */
  return {
    validation_result: { id: "vr", passed: false, validated_at: null, violations },
  } as unknown as FlightPlanResponse;
}

function chipFailed(key: string): boolean {
  /** true when the rendered check chip is in the failed style. */
  const label = screen.getByText(`mission.overview.checks.${key}`);
  const chip = label.closest("div");
  return chip?.className.includes("tv-status-cancelled-bg") ?? false;
}

function renderExpanded(violations: ValidationViolation[]) {
  /** render the panel and expand the check-details grid. */
  render(
    <ValidationStatusPanel
      flightPlan={flightPlan(violations)}
      hasTrajectory
      missionStatus="PLANNED"
    />,
  );
  fireEvent.click(screen.getByText("mission.overview.checkDetails"));
}

describe("ValidationStatusPanel kind-driven checks", () => {
  it("a soft surface_crossing fires surfaceCrossing, not runwayBuffer", () => {
    renderExpanded([violation("surface_crossing", true)]);
    expect(chipFailed("surfaceCrossing")).toBe(true);
    expect(chipFailed("runwayBuffer")).toBe(false);
  });

  it("a hard runway_buffer fires runwayBuffer, not surfaceCrossing", () => {
    renderExpanded([violation("runway_buffer", false)]);
    expect(chipFailed("runwayBuffer")).toBe(true);
    expect(chipFailed("surfaceCrossing")).toBe(false);
  });

  it("both fire simultaneously without conflation", () => {
    renderExpanded([
      violation("surface_crossing", true),
      violation("runway_buffer", false),
    ]);
    expect(chipFailed("surfaceCrossing")).toBe(true);
    expect(chipFailed("runwayBuffer")).toBe(true);
  });

  it("speed_framerate fires speedFramerateCheck, never speedCheck", () => {
    renderExpanded([violation("speed_framerate", true)]);
    expect(chipFailed("speedFramerateCheck")).toBe(true);
    expect(chipFailed("speedCheck")).toBe(false);
  });
});
