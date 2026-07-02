import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LightSummary } from "@/types/measurement";
import TransitionAngleTable, { transitionVerdict } from "./TransitionAngleTable";

function summary(over: Partial<LightSummary>): LightSummary {
  return {
    light_name: "PAPI_A",
    setting_angle: 3.0,
    tolerance: 0.5,
    measured_transition_angle: 3.0,
    measured_transition_angle_touchpoint: null,
    passed: true,
    ...over,
  };
}

describe("transitionVerdict", () => {
  it("passes inside the setting +/- tolerance band", () => {
    expect(transitionVerdict(3.2, 3.0, 0.5)).toBe("pass");
    expect(transitionVerdict(3.5, 3.0, 0.5)).toBe("pass"); // boundary inclusive
  });

  it("fails outside the band", () => {
    expect(transitionVerdict(3.8, 3.0, 0.5)).toBe("fail");
  });

  it("is unknown when any input is missing", () => {
    expect(transitionVerdict(null, 3.0, 0.5)).toBe("unknown");
    expect(transitionVerdict(3.0, null, 0.5)).toBe("unknown");
    expect(transitionVerdict(3.0, 3.0, null)).toBe("unknown");
  });
});

describe("TransitionAngleTable", () => {
  it("renders a PASS verdict for an in-tolerance light", () => {
    render(
      <TransitionAngleTable
        summaries={[summary({ measured_transition_angle: 3.1 })]}
      />,
    );
    expect(screen.getByTestId("transition-angle-table")).toBeInTheDocument();
    expect(screen.getByText("results.verdict.pass")).toBeInTheDocument();
  });

  it("renders a FAIL verdict for an out-of-tolerance light", () => {
    render(
      <TransitionAngleTable
        summaries={[summary({ measured_transition_angle: 4.0 })]}
      />,
    );
    expect(screen.getByText("results.verdict.fail")).toBeInTheDocument();
  });

  it("renders UNKNOWN when the measurement or ground truth is missing", () => {
    render(
      <TransitionAngleTable
        summaries={[
          summary({ measured_transition_angle: null, passed: null }),
          summary({ light_name: "PAPI_B", setting_angle: null, passed: null }),
        ]}
      />,
    );
    expect(screen.getAllByText("results.verdict.unknown")).toHaveLength(2);
  });

  it("shows an empty message with no summaries", () => {
    render(<TransitionAngleTable summaries={[]} />);
    expect(screen.getByText("results.table.empty")).toBeInTheDocument();
    expect(screen.queryByTestId("transition-angle-table")).toBeNull();
  });
});
