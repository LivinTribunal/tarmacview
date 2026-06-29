import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LightSeries, LightSeriesPoint } from "@/types/measurement";
import HorizontalAnalysisSection from "./HorizontalAnalysisSection";

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
    horizontal_angle: -2,
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
    transition_angle_min: null,
    transition_angle_middle: null,
    transition_angle_max: null,
    passed: null,
    points: [
      point({ horizontal_angle: -2, intensity: 0.4 }),
      point({ horizontal_angle: 1, intensity: 0.9 }),
    ],
  };
}

describe("HorizontalAnalysisSection", () => {
  it("renders both horizontal charts with a centerline and the direction card", () => {
    const { container } = render(
      <HorizontalAnalysisSection lights={[series("PAPI_A")]} />,
    );
    expect(screen.getByTestId("chart-horizontal-red-chroma")).toBeInTheDocument();
    expect(screen.getByTestId("chart-horizontal-luminosity")).toBeInTheDocument();
    expect(screen.getByTestId("light-direction-card")).toBeInTheDocument();
    // centerline reference line at x=0
    expect(container.querySelector(".recharts-reference-line")).not.toBeNull();
  });
});
