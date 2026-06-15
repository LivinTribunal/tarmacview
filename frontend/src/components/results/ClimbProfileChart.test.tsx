import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DronePathPoint } from "@/types/measurement";
import ClimbProfileChart from "./ClimbProfileChart";

// recharts ResponsiveContainer measures its parent (0x0 in jsdom); clone the
// chart with fixed dimensions so the area actually renders.
vi.mock("recharts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("recharts")>();
  const React = await import("react");
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 400, height: 260 }),
  };
});

function pt(over: Partial<DronePathPoint>): DronePathPoint {
  return {
    frame_number: 0,
    timestamp: 0,
    latitude: 48.1,
    longitude: 17.2,
    elevation: 130,
    ...over,
  };
}

describe("ClimbProfileChart", () => {
  it("plots the elevation profile when the path carries elevations", () => {
    const path = [
      pt({ frame_number: 0, timestamp: 0, elevation: 130 }),
      pt({ frame_number: 1, timestamp: 1, elevation: 145 }),
    ];
    const { container } = render(<ClimbProfileChart dronePath={path} />);
    expect(screen.getByTestId("chart-climb-profile")).toBeInTheDocument();
    expect(container.querySelector(".recharts-area")).not.toBeNull();
  });

  it("shows the empty state when no point has an elevation", () => {
    render(<ClimbProfileChart dronePath={[pt({ elevation: null })]} />);
    expect(screen.getByText("results.climb.noData")).toBeInTheDocument();
  });
});
