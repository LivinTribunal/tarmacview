import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LightSeries, LightSeriesPoint } from "@/types/measurement";
import LightAngleChart from "./LightAngleChart";

// recharts ResponsiveContainer measures its parent (0x0 in jsdom); clone the
// chart with fixed dimensions so the lines actually render.
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
    chromaticity_x: 0.33,
    chromaticity_y: 0.33,
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
    passed: true,
    points: [
      point({ frame_number: 0, timestamp: 0, angle: 2.5 }),
      point({ frame_number: 1, timestamp: 0.1, angle: 3.5 }),
    ],
    ...over,
  };
}

describe("LightAngleChart", () => {
  it("renders the chart container with line data", () => {
    const { container } = render(<LightAngleChart lights={[series({})]} />);
    expect(screen.getByTestId("chart-angle")).toBeInTheDocument();
    // recharts draws each series as a .recharts-line group
    expect(container.querySelector(".recharts-line")).not.toBeNull();
  });

  it("shows the empty state when no light has angle data", () => {
    const empty = series({ points: [point({ angle: null })] });
    render(<LightAngleChart lights={[empty]} />);
    expect(screen.getByText("results.noData")).toBeInTheDocument();
  });

  it("shades the red/white transition zones from the light's transition band", () => {
    const { container } = render(<LightAngleChart lights={[series({})]} />);
    // one red band (min->middle) + one white band (middle->max) per banded light
    expect(container.querySelectorAll(".recharts-reference-area")).toHaveLength(2);
  });

  it("omits transition zones when the band is incomplete", () => {
    const noBand = series({ transition_angle_max: null });
    const { container } = render(<LightAngleChart lights={[noBand]} />);
    expect(container.querySelector(".recharts-reference-area")).toBeNull();
  });
});
