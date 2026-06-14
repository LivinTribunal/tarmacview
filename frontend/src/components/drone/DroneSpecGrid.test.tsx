import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DroneSpecGrid from "./DroneSpecGrid";
import type { DroneProfileResponse } from "@/types/droneProfile";

function drone(overrides: Partial<DroneProfileResponse> = {}): DroneProfileResponse {
  return {
    id: "d-1",
    name: "Matrice",
    manufacturer: "DJI",
    model: "M300",
    max_speed: 23,
    max_climb_rate: 6,
    max_altitude: 5000,
    battery_capacity: 5935,
    endurance_minutes: 55,
    camera_resolution: "20MP",
    camera_frame_rate: 30,
    sensor_fov: 84,
    weight: 6.3,
    model_identifier: null,
    max_optical_zoom: null,
    sensor_base_focal_length: null,
    default_optical_zoom: null,
    supports_geozone_upload: false,
    supports_dji_wpml: false,
    is_dji: false,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    mission_count: 0,
    ...overrides,
  };
}

describe("DroneSpecGrid", () => {
  it("renders fields in the locked order", () => {
    const { container } = render(<DroneSpecGrid drone={drone()} />);
    const labels = Array.from(container.querySelectorAll("span.text-xs")).map(
      (n) => n.textContent ?? "",
    );

    // grid renders labels in the order defined by FIELDS
    expect(labels[0]).toBe("coordinator.drones.fields.name");
    expect(labels[1]).toBe("coordinator.drones.fields.manufacturer");
    expect(labels[2]).toBe("coordinator.drones.fields.model");
    expect(labels[3]).toBe(
      "coordinator.drones.fields.maxSpeed (coordinator.drones.units.ms)",
    );
    expect(labels[labels.length - 1]).toBe(
      "coordinator.drones.fields.weight (coordinator.drones.units.kg)",
    );
  });

  it("renders an em-dash placeholder for null fields", () => {
    render(<DroneSpecGrid drone={drone({ manufacturer: null, weight: null })} />);
    // at least two cells render the em-dash
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});
