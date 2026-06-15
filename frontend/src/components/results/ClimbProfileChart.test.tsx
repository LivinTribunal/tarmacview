import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DronePathPoint } from "@/types/measurement";
import ClimbProfileChart from "./ClimbProfileChart";

// recharts ResponsiveContainer measures its parent (0x0 in jsdom); clone the
// chart with fixed dimensions so the line actually renders.
vi.mock("recharts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("recharts")>();
  const React = await import("react");
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 400, height: 260 }),
  };
});

function point(over: Partial<DronePathPoint>): DronePathPoint {
  return {
    frame_number: 0,
    timestamp: 0,
    latitude: 48.1,
    longitude: 17.2,
    elevation: 150,
    ...over,
  };
}

describe("ClimbProfileChart", () => {
  it("renders the altitude line when elevation data is present", () => {
    const path = [
      point({ frame_number: 0, timestamp: 0, elevation: 150 }),
      point({ frame_number: 1, timestamp: 0.1, elevation: 152 }),
    ];
    const { container } = render(<ClimbProfileChart dronePath={path} />);
    expect(screen.getByTestId("chart-climb-profile")).toBeInTheDocument();
    expect(container.querySelector(".recharts-line")).not.toBeNull();
  });

  it("shows the empty state when every point has null elevation", () => {
    const path = [point({ elevation: null }), point({ elevation: null })];
    render(<ClimbProfileChart dronePath={path} />);
    expect(screen.getByText("results.noData")).toBeInTheDocument();
  });

  it("shows the empty state when the path is empty", () => {
    render(<ClimbProfileChart dronePath={[]} />);
    expect(screen.getByText("results.noData")).toBeInTheDocument();
  });
});
