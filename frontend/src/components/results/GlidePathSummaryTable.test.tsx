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
