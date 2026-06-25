import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DronePathPoint, ReferencePoint } from "@/types/measurement";
import DroneHeightProfileChart from "./DroneHeightProfileChart";

// recharts ResponsiveContainer measures its parent (0x0 in jsdom); clone the
// chart with fixed dimensions so the lines actually render.
vi.mock("recharts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("recharts")>();
  const React = await import("react");
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 400, height: 280 }),
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

function ref(over: Partial<ReferencePoint>): ReferencePoint {
  return {
    light_name: "PAPI_A",
    latitude: 48.1,
    longitude: 17.2,
    elevation: 120,
    lha_id: null,
    unit_designator: null,
    setting_angle: null,
    tolerance: null,
    ...over,
  };
}

describe("DroneHeightProfileChart", () => {
  it("plots elevation and a diff line per PAPI reference", () => {
    const path = [
      pt({ frame_number: 0, timestamp: 0, elevation: 130 }),
      pt({ frame_number: 1, timestamp: 1, elevation: 145 }),
    ];
    const { container } = render(
      <DroneHeightProfileChart
        dronePath={path}
        referencePoints={[ref({ light_name: "PAPI_A" })]}
      />,
    );
    expect(screen.getByTestId("chart-height-profile")).toBeInTheDocument();
    expect(
      container.querySelectorAll(".recharts-line").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("adds a touch-point diff series when a touch-point reference is present", () => {
    const path = [pt({ elevation: 130 })];
    const { container } = render(
      <DroneHeightProfileChart
        dronePath={path}
        referencePoints={[
          ref({ light_name: "PAPI_A" }),
          ref({ light_name: "TOUCH_POINT", elevation: 100 }),
        ]}
      />,
    );
    // drone elevation + 2 diff series
    expect(
      container.querySelectorAll(".recharts-line").length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("shows the empty state when no point has an elevation", () => {
    render(
      <DroneHeightProfileChart
        dronePath={[pt({ elevation: null })]}
        referencePoints={[]}
      />,
    );
    expect(screen.getByText("results.heightProfile.noData")).toBeInTheDocument();
  });
});
