import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LightSeries, LightSeriesPoint } from "@/types/measurement";
import LuminosityComparisonTable from "./LuminosityComparisonTable";

function pt(intensity: number | null): LightSeriesPoint {
  return {
    frame_number: 0,
    timestamp: 0,
    status: null,
    angle: null,
    horizontal_angle: null,
    intensity,
    area_pixels: null,
    chromaticity_x: null,
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
    passed: null,
    points: [],
    ...over,
  };
}

describe("LuminosityComparisonTable", () => {
  it("renders per-light min/max/avg/range as plain numbers", () => {
    render(
      <LuminosityComparisonTable
        lights={[light({ points: [pt(10), pt(30)] })]}
      />,
    );
    expect(
      screen.getByTestId("luminosity-comparison-table"),
    ).toBeInTheDocument();
    expect(screen.getByText("10.0")).toBeInTheDocument(); // min
    expect(screen.getByText("30.0")).toBeInTheDocument(); // max
    expect(screen.getAllByText("20.0")).toHaveLength(2); // avg and range
  });

  it("shows the empty state when no light has data", () => {
    render(
      <LuminosityComparisonTable lights={[light({ points: [pt(null)] })]} />,
    );
    expect(
      screen.getByText("results.luminosityCompare.empty"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("luminosity-comparison-table")).toBeNull();
  });
});
