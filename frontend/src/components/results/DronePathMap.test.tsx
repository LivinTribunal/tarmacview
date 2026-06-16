import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DronePathPoint, ReferencePoint } from "@/types/measurement";
import DronePathMap, { isDegenerateBbox } from "./DronePathMap";

// the global maplibre mock (src/setupTests.ts) never fires the "load" handler,
// so the marker layer + degenerate-bbox zoom are validated in browser-verify.
// here we pin the empty-state gate: noPath shows only when there are no points.

function pathPoint(over: Partial<DronePathPoint>): DronePathPoint {
  return {
    frame_number: 0,
    timestamp: 0,
    latitude: 48.1,
    longitude: 17.2,
    elevation: 130,
    ...over,
  };
}

function refPoint(over: Partial<ReferencePoint>): ReferencePoint {
  return {
    light_name: "PAPI_A",
    latitude: 48.1,
    longitude: 17.2,
    elevation: 130,
    lha_id: null,
    unit_designator: "A",
    setting_angle: 3.0,
    tolerance: 0.5,
    ...over,
  };
}

describe("DronePathMap", () => {
  it("shows the noPath empty state when the drone path is empty", () => {
    render(<DronePathMap dronePath={[]} referencePoints={[refPoint({})]} />);
    expect(screen.getByTestId("drone-path-map")).toBeInTheDocument();
    expect(screen.getByText("results.map.noPath")).toBeInTheDocument();
  });

  it("hides the noPath state for a single-point (stationary) path", () => {
    render(
      <DronePathMap
        dronePath={[pathPoint({})]}
        referencePoints={[refPoint({})]}
      />,
    );
    expect(screen.getByTestId("drone-path-map")).toBeInTheDocument();
    expect(screen.queryByText("results.map.noPath")).not.toBeInTheDocument();
  });
});

describe("isDegenerateBbox", () => {
  it("returns false for an empty coordinate list", () => {
    expect(isDegenerateBbox([])).toBe(false);
  });

  it("treats a single point as degenerate (zero span)", () => {
    expect(isDegenerateBbox([[17.2, 48.1]])).toBe(true);
  });

  it("treats a sub-metre cluster as degenerate", () => {
    expect(
      isDegenerateBbox([
        [17.2, 48.1],
        [17.200001, 48.100001],
        [17.200002, 48.099999],
      ]),
    ).toBe(true);
  });

  it("is not degenerate when the lng span clears the threshold", () => {
    expect(
      isDegenerateBbox([
        [17.2, 48.1],
        [17.21, 48.1],
      ]),
    ).toBe(false);
  });

  it("is not degenerate when the lat span clears the threshold", () => {
    expect(
      isDegenerateBbox([
        [17.2, 48.1],
        [17.2, 48.11],
      ]),
    ).toBe(false);
  });

  it("does not overflow the stack on a very long path (no spread)", () => {
    const long: [number, number][] = Array.from(
      { length: 200000 },
      (_, i) => [17.2 + i * 1e-9, 48.1],
    );
    expect(() => isDegenerateBbox(long)).not.toThrow();
  });
});
