import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SafetyZoneResponse } from "@/types/airport";
import SafetyZoneInfoPanel from "./SafetyZoneInfoPanel";

function makeZone(overrides: Partial<SafetyZoneResponse> = {}): SafetyZoneResponse {
  /** build a minimal safety zone fixture. */
  return {
    id: "z-1",
    airport_id: "a-1",
    name: "Z",
    type: "RESTRICTED",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [14.0, 50.0, 0],
          [14.001, 50.0, 0],
          [14.001, 50.001, 0],
          [14.0, 50.001, 0],
          [14.0, 50.0, 0],
        ],
      ],
    },
    altitude_floor: null,
    altitude_ceiling: null,
    is_active: true,
    ...overrides,
  };
}

describe("SafetyZoneInfoPanel - AIRPORT_BOUNDARY", () => {
  it("renders area and perimeter rows for a small boundary in m² / m", () => {
    const zone = makeZone({ type: "AIRPORT_BOUNDARY", name: "Perimeter" });
    render(<SafetyZoneInfoPanel zone={zone} />);

    // small square -> area is in m² (the unit key shows via the stub) and perimeter is in m
    const areaRow = screen.getByText("dashboard.poiArea").closest("div")!;
    expect(areaRow).toHaveTextContent(/common\.units\.m2/);
    const perimRow = screen.getByText("dashboard.poiPerimeter").closest("div")!;
    // a ~370 m perimeter is reported in m, not km
    expect(perimRow).toHaveTextContent(/common\.units\.m\b/);
  });

  it("uses km² for boundaries crossing the 1 km² threshold", () => {
    const zone = makeZone({
      type: "AIRPORT_BOUNDARY",
      name: "Big",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [14.0, 50.0, 0],
            [14.05, 50.0, 0],
            [14.05, 50.05, 0],
            [14.0, 50.05, 0],
            [14.0, 50.0, 0],
          ],
        ],
      },
    });
    render(<SafetyZoneInfoPanel zone={zone} />);

    const areaRow = screen.getByText("dashboard.poiArea").closest("div")!;
    expect(areaRow).toHaveTextContent(/common\.units\.km2/);
  });
});

describe("SafetyZoneInfoPanel - regular zone", () => {
  it("only renders floor / ceiling rows when set", () => {
    const { rerender } = render(
      <SafetyZoneInfoPanel zone={makeZone({ altitude_floor: null, altitude_ceiling: null })} />,
    );
    expect(screen.queryByText("dashboard.poiFloor")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard.poiCeiling")).not.toBeInTheDocument();

    rerender(
      <SafetyZoneInfoPanel
        zone={makeZone({ altitude_floor: 100, altitude_ceiling: 300 })}
      />,
    );
    expect(screen.getByText("dashboard.poiFloor")).toBeInTheDocument();
    expect(screen.getByText("dashboard.poiCeiling")).toBeInTheDocument();
  });
});
