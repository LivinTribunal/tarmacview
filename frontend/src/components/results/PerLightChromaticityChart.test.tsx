import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { LightSeries, LightSeriesPoint } from "@/types/measurement";
import PerLightChromaticityChart from "./PerLightChromaticityChart";

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
    points: [point({ timestamp: 0 }), point({ timestamp: 0.1, chromaticity_x: 0.45 })],
    ...over,
  };
}

describe("PerLightChromaticityChart", () => {
  it("renders the three normalized channels plus a white reference line", () => {
    const { container } = render(
      <PerLightChromaticityChart lights={[series({})]} />,
    );
    expect(screen.getByTestId("chart-per-light-chroma")).toBeInTheDocument();
    // three channels + the angle overlay
    expect(container.querySelectorAll(".recharts-line").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector(".recharts-reference-line")).not.toBeNull();
  });

  it("reflects the light's verdict and switches units", () => {
    const a = series({ light_name: "PAPI_A", passed: false });
    const b = series({ light_name: "PAPI_B", passed: true });
    render(<PerLightChromaticityChart lights={[a, b]} />);
    expect(screen.getByTestId("verdict-fail")).toBeInTheDocument();
    fireEvent.click(screen.getByText("B"));
    expect(screen.getByTestId("verdict-pass")).toBeInTheDocument();
  });
});
