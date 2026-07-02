import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LightSeries, LightSeriesPoint } from "@/types/measurement";
import LightDirectionCard from "./LightDirectionCard";

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

function series(name: string, points: LightSeriesPoint[]): LightSeries {
  return {
    light_name: name,
    setting_angle: 3.0,
    tolerance: 0.5,
    transition_angle_min: null,
    transition_angle_middle: null,
    transition_angle_max: null,
    transition_angle_min_touchpoint: null,
    transition_angle_middle_touchpoint: null,
    transition_angle_max_touchpoint: null,
    passed: null,
    points,
  };
}

describe("LightDirectionCard", () => {
  it("shows the horizontal angle of the brightest frame", () => {
    const light = series("PAPI_A", [
      point({ horizontal_angle: -3, intensity: 0.2 }),
      point({ horizontal_angle: 2.5, intensity: 0.9 }),
      point({ horizontal_angle: 4, intensity: 0.4 }),
    ]);
    render(<LightDirectionCard lights={[light]} />);
    expect(screen.getByText("2.5°")).toBeInTheDocument();
  });

  it("renders an empty state with no lights", () => {
    render(<LightDirectionCard lights={[]} />);
    expect(screen.getByText("results.noData")).toBeInTheDocument();
  });
});
