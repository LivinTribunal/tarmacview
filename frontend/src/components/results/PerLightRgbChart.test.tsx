import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { LightSeries, LightSeriesPoint } from "@/types/measurement";
import PerLightRgbChart from "./PerLightRgbChart";

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
    red: 200,
    green: 150,
    blue: 80,
    chromaticity_x: 0.33,
    chromaticity_y: 0.33,
    distance_ground: 50,
    ...over,
  };
}

function series(over: Partial<LightSeries>): LightSeries {
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
    points: [point({ timestamp: 0 }), point({ timestamp: 0.1, red: 180 })],
    ...over,
  };
}

describe("PerLightRgbChart", () => {
  it("renders channel lines for the active light", () => {
    const { container } = render(<PerLightRgbChart lights={[series({})]} />);
    expect(screen.getByTestId("chart-per-light-rgb")).toBeInTheDocument();
    // three channels + the angle overlay
    expect(container.querySelectorAll(".recharts-line").length).toBeGreaterThanOrEqual(3);
  });

  it("switches to another unit's data via the selector", () => {
    const a = series({ light_name: "PAPI_A" });
    const b = series({ light_name: "PAPI_B", passed: false });
    render(<PerLightRgbChart lights={[a, b]} />);
    expect(screen.getByTestId("verdict-pass")).toBeInTheDocument();
    fireEvent.click(screen.getByText("B"));
    expect(screen.getByTestId("verdict-fail")).toBeInTheDocument();
  });

  it("shows the empty state when the active unit has no rgb data", () => {
    const empty = series({
      points: [point({ red: null, green: null, blue: null })],
    });
    render(<PerLightRgbChart lights={[empty]} />);
    expect(screen.getByText("results.noData")).toBeInTheDocument();
  });
});
