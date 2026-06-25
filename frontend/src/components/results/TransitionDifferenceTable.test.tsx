import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LightSeries } from "@/types/measurement";
import TransitionDifferenceTable from "./TransitionDifferenceTable";

function light(over: Partial<LightSeries>): LightSeries {
  return {
    light_name: "PAPI_A",
    setting_angle: 3.0,
    tolerance: 0.5,
    transition_angle_min: 2.8,
    transition_angle_middle: 3.0,
    transition_angle_max: 3.2,
    passed: true,
    points: [],
    ...over,
  };
}

describe("TransitionDifferenceTable", () => {
  it("renders start/middle/end/width/correction and a PASS pill", () => {
    render(<TransitionDifferenceTable lights={[light({})]} />);
    expect(
      screen.getByTestId("transition-difference-table"),
    ).toBeInTheDocument();
    expect(screen.getByText("2.80°")).toBeInTheDocument(); // start
    expect(screen.getByText("3.20°")).toBeInTheDocument(); // end
    expect(screen.getByText("0.40°")).toBeInTheDocument(); // width = max - min
    expect(screen.getByText("0.00°")).toBeInTheDocument(); // correction = middle - setting
    expect(screen.getByText("results.verdict.pass")).toBeInTheDocument();
  });

  it("maps the tri-state passed flag to fail and unknown verdicts", () => {
    render(
      <TransitionDifferenceTable
        lights={[
          light({ light_name: "PAPI_A", passed: false }),
          light({ light_name: "PAPI_B", passed: null }),
        ]}
      />,
    );
    expect(screen.getByText("results.verdict.fail")).toBeInTheDocument();
    expect(screen.getByText("results.verdict.unknown")).toBeInTheDocument();
  });

  it("renders n-1 pairwise rows and dashes a null middle", () => {
    render(
      <TransitionDifferenceTable
        lights={[
          light({ light_name: "PAPI_A", transition_angle_middle: 3.0 }),
          light({ light_name: "PAPI_B", transition_angle_middle: 3.5 }),
          light({ light_name: "PAPI_C", transition_angle_middle: null }),
        ]}
      />,
    );
    const pairwise = screen.getByTestId("transition-pairwise");
    expect(pairwise.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.getByText("-0.50°")).toBeInTheDocument(); // 3.0 - 3.5
  });

  it("shows the empty state with no lights", () => {
    render(<TransitionDifferenceTable lights={[]} />);
    expect(screen.getByText("results.transitionDiff.empty")).toBeInTheDocument();
    expect(screen.queryByTestId("transition-difference-table")).toBeNull();
  });
});
