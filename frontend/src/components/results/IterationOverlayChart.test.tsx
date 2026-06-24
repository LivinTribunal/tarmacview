import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { IterationSeries } from "@/types/measurement";
import IterationOverlayChart from "./IterationOverlayChart";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      key === "iterationCompare.iterationN" ? `Iteration ${opts?.index}` : key,
  }),
}));

// recharts ResponsiveContainer measures 0x0 in jsdom; give it fixed dimensions
vi.mock("recharts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("recharts")>();
  const React = await import("react");
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 400, height: 260 }),
  };
});

function series(index: number): IterationSeries {
  return {
    iteration_index: index,
    transition_angle_min: 2.8,
    transition_angle_middle: 3.0,
    transition_angle_max: 3.2,
    points: [
      { frame_number: 0, timestamp: 0, status: "red", angle: 2.5, horizontal_angle: 0, intensity: 0.5, area_pixels: 10, chromaticity_x: 0.3, chromaticity_y: 0.3 },
      { frame_number: 1, timestamp: 0.1, status: "white", angle: 3.4, horizontal_angle: 0, intensity: 0.6, area_pixels: 12, chromaticity_x: 0.32, chromaticity_y: 0.31 },
    ],
  };
}

describe("IterationOverlayChart", () => {
  it("renders one line per iteration for the given field", () => {
    const { container } = render(
      <IterationOverlayChart
        title="Angle"
        series={[series(1), series(2)]}
        field="angle"
        yLabel="deg"
      />,
    );
    expect(screen.getByTestId("iteration-chart-angle")).toBeInTheDocument();
    expect(container.querySelectorAll(".recharts-line")).toHaveLength(2);
  });

  it("shows the empty state when no series has the field", () => {
    const empty = { ...series(1), points: series(1).points.map((p) => ({ ...p, angle: null })) };
    render(
      <IterationOverlayChart title="Angle" series={[empty]} field="angle" yLabel="deg" />,
    );
    expect(screen.getByText("iterationCompare.noData")).toBeInTheDocument();
  });
});
