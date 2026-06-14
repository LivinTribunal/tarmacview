import { describe, it, expect } from "vitest";
import { buildCreatePayload } from "./buildCreatePayload";

describe("buildCreatePayload", () => {
  it("trims the name, omits empty number fields, and forwards model id", () => {
    const payload = buildCreatePayload(
      {
        name: "  Mavic  ",
        max_speed: "15",
        max_altitude: "",
        endurance_minutes: "40",
        camera_frame_rate: "",
      },
      "model-x",
    );
    expect(payload).toEqual({
      name: "Mavic",
      max_speed: 15,
      max_altitude: undefined,
      endurance_minutes: 40,
      camera_frame_rate: undefined,
      model_identifier: "model-x",
    });
  });

  it("returns undefined model_identifier when no model selected", () => {
    const payload = buildCreatePayload(
      {
        name: "Phantom",
        max_speed: "",
        max_altitude: "",
        endurance_minutes: "",
        camera_frame_rate: "",
      },
      null,
    );
    expect(payload.model_identifier).toBeUndefined();
  });

  it("uses Number coercion (e.g. trailing zeros)", () => {
    const payload = buildCreatePayload(
      {
        name: "x",
        max_speed: "10.00",
        max_altitude: "",
        endurance_minutes: "",
        camera_frame_rate: "",
      },
      null,
    );
    expect(payload.max_speed).toBe(10);
  });
});
