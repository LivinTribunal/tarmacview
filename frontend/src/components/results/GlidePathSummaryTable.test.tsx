import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LightSeries } from "@/types/measurement";
import GlidePathSummaryTable from "./GlidePathSummaryTable";

function light(over: Partial<LightSeries>): LightSeries {
  return {
    light_name: "PAPI_A",
    setting_angle: 3.0,
    tolerance: 0.5,
    transition_angle_min: 2.8,
    transition_angle_middle: 3.0,
    transition_angle_max: 3.2,
    transition_angle_min_touchpoint: null,
    transition_angle_middle_touchpoint: null,
    transition_angle_max_touchpoint: null,
    passed: true,
    points: [],
    ...over,
  };
}

describe("GlidePathSummaryTable", () => {
  it("derives the glide-path-to-PAPI angle from PAPI_B and PAPI_C", () => {
    render(
      <GlidePathSummaryTable
        lights={[
          light({ light_name: "PAPI_B", transition_angle_max: 3.4 }),
          light({ light_name: "PAPI_C", transition_angle_min: 3.0 }),
        ]}
      />,
    );
    expect(screen.getByTestId("glide-path-summary-table")).toBeInTheDocument();
    expect(screen.getByText("3.20°")).toBeInTheDocument(); // (3.4 + 3.0) / 2
    expect(screen.getByText("results.verdict.pass")).toBeInTheDocument();
  });

  it("renders the to-touch-point row as gated dashes", () => {
    render(
      <GlidePathSummaryTable
        lights={[
          light({ light_name: "PAPI_B" }),
          light({ light_name: "PAPI_C" }),
        ]}
      />,
    );
    expect(screen.getByText("results.verdict.unknown")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("populates the touch-point row from the touchpoint angles + props", () => {
    render(
      <GlidePathSummaryTable
        lights={[
          light({ light_name: "PAPI_B", transition_angle_max_touchpoint: 3.02 }),
          light({ light_name: "PAPI_C", transition_angle_min_touchpoint: 2.98 }),
        ]}
        nominalGlideSlope={3.0}
        harmonizationTolerance={0.05}
      />,
    );
    // touch-point glidepath mid = (3.02 + 2.98) / 2 = 3.00, within ±0.05 of 3.0 -> pass
    expect(screen.getByText("results.glidePath.toTouchPoint")).toBeInTheDocument();
    expect(screen.getAllByText("3.00°").length).toBeGreaterThanOrEqual(2);
    // both the to-PAPI and to-touch-point rows verdict PASS
    expect(screen.getAllByText("results.verdict.pass")).toHaveLength(2);
  });

  it("shows the empty state when PAPI_B or PAPI_C is missing", () => {
    render(
      <GlidePathSummaryTable
        lights={[light({ light_name: "PAPI_B" })]}
      />,
    );
    expect(screen.getByText("results.glidePath.empty")).toBeInTheDocument();
    expect(screen.queryByTestId("glide-path-summary-table")).toBeNull();
  });
});
