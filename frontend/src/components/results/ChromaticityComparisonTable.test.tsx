import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LightSeries, LightSeriesPoint } from "@/types/measurement";
import ChromaticityComparisonTable from "./ChromaticityComparisonTable";

function pt(chromaticity_x: number | null): LightSeriesPoint {
  return {
    frame_number: 0,
    timestamp: 0,
    status: null,
    angle: null,
    horizontal_angle: null,
    intensity: null,
    area_pixels: null,
    chromaticity_x,
    chromaticity_y: null,
    red: null,
    green: null,
    blue: null,
    distance_ground: null,
  };
}

function light(over: Partial<LightSeries>): LightSeries {
  return {
    light_name: "PAPI_A",
    setting_angle: null,
    tolerance: null,
    transition_angle_min: null,
    transition_angle_middle: null,
    transition_angle_max: null,
    transition_angle_min_touchpoint: null,
    transition_angle_middle_touchpoint: null,
    transition_angle_max_touchpoint: null,
    passed: null,
    points: [],
    ...over,
  };
}

describe("ChromaticityComparisonTable", () => {
  it("renders per-light min/max/avg/range as percent", () => {
    render(
      <ChromaticityComparisonTable
        lights={[light({ points: [pt(0.4), pt(0.6)] })]}
      />,
    );
    expect(
      screen.getByTestId("chromaticity-comparison-table"),
    ).toBeInTheDocument();
    expect(screen.getByText("40.0 %")).toBeInTheDocument(); // min
    expect(screen.getByText("60.0 %")).toBeInTheDocument(); // max
    expect(screen.getByText("50.0 %")).toBeInTheDocument(); // avg
    expect(screen.getByText("20.0 %")).toBeInTheDocument(); // range
  });

  it("dashes a light with no chromaticity points", () => {
    render(
      <ChromaticityComparisonTable
        lights={[
          light({ light_name: "PAPI_A", points: [pt(0.5)] }),
          light({ light_name: "PAPI_B", points: [pt(null)] }),
        ]}
      />,
    );
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  it("shows the empty state when no light has data", () => {
    render(
      <ChromaticityComparisonTable lights={[light({ points: [pt(null)] })]} />,
    );
    expect(
      screen.getByText("results.chromaticityCompare.empty"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("chromaticity-comparison-table")).toBeNull();
  });
});
