import { describe, it, expect } from "vitest";
import { FIELDS, droneToForm, formToPayload } from "./droneFields";
import type { DroneProfileResponse } from "@/types/droneProfile";

const DRONE = {
  id: "d-1",
  name: "Matrice 300",
  manufacturer: "DJI",
  model: "M300 RTK",
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
  created_at: "2026-03-19T00:00:00Z",
  updated_at: "2026-03-19T00:00:00Z",
  mission_count: 1,
} as DroneProfileResponse;

describe("droneToForm", () => {
  it("stringifies present values", () => {
    const form = droneToForm(DRONE);
    expect(form.name).toBe("Matrice 300");
    expect(form.max_speed).toBe("23");
    expect(form.weight).toBe("6.3");
  });

  it("maps null values to empty strings", () => {
    const form = droneToForm(DRONE);
    expect(form.max_optical_zoom).toBe("");
    expect(form.sensor_base_focal_length).toBe("");
  });

  it("covers every defined field", () => {
    const form = droneToForm(DRONE);
    for (const f of FIELDS) {
      expect(form).toHaveProperty(f.key);
    }
  });
});

describe("formToPayload", () => {
  it("coerces number fields and keeps text fields", () => {
    const payload = formToPayload(droneToForm(DRONE)) as Record<string, unknown>;
    expect(payload.max_speed).toBe(23);
    expect(payload.name).toBe("Matrice 300");
  });

  it("maps empty number fields to null, empty text fields to null", () => {
    const payload = formToPayload({
      name: "",
      max_speed: "",
    }) as Record<string, unknown>;
    expect(payload.name).toBeNull();
    expect(payload.max_speed).toBeNull();
  });

  it("round-trips through droneToForm without losing values", () => {
    const payload = formToPayload(droneToForm(DRONE)) as Record<string, unknown>;
    expect(payload.battery_capacity).toBe(5935);
    expect(payload.camera_resolution).toBe("20MP");
  });
});
