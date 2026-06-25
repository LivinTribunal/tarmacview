import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LightSeries, LightSeriesPoint } from "@/types/measurement";
import VerticalAnalysisSection from "./VerticalAnalysisSection";

vi.mock("recharts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("recharts")>();
  const React = await import("react");
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 400, height: 260 }),
  };
});

function point(over: Partial<LightSeriesPoint>): LightSeriesPoint {
  return {
    frame_number: 0,
    timestamp: 0,
    status: "white",
    angle: 3.0,
    horizontal_angle: 0,
    intensity: 0.5,
    area_pixels: 100,
    chromaticity_x: 0.4,
    chromaticity_y: 0.3,
    red: 200,
    green: 150,
    blue: 80,
    distance_ground: 50,
    ...over,
  };
}

function series(name: string): LightSeries {
  return {
    light_name: name,
    setting_angle: 3.0,
    tolerance: 0.5,
    transition_angle_min: 2.8,
    transition_angle_middle: 3.0,
    transition_angle_max: 3.2,
    passed: true,
    points: [point({ timestamp: 0 }), point({ timestamp: 0.1, intensity: 0.7 })],
  };
}

describe("VerticalAnalysisSection", () => {
  it("renders all four aggregate charts", () => {
    render(<VerticalAnalysisSection lights={[series("PAPI_A"), series("PAPI_B")]} />);
    expect(screen.getByTestId("chart-vertical-red-chroma")).toBeInTheDocument();
    expect(screen.getByTestId("chart-vertical-luminosity")).toBeInTheDocument();
    expect(screen.getByTestId("chart-vertical-color-diff")).toBeInTheDocument();
    expect(screen.getByTestId("chart-vertical-light-area")).toBeInTheDocument();
  });

  it("shows the empty state for each chart when there are no lights", () => {
    render(<VerticalAnalysisSection lights={[]} />);
    expect(screen.getAllByText("results.noData")).toHaveLength(4);
  });
});
