import { describe, it, expect } from "vitest";
import { buildLhaCreatePayload } from "./buildLhaCreatePayload";

describe("buildLhaCreatePayload", () => {
  it("preserves null setting_angle for papi (no fallback to 3.0)", () => {
    const payload = buildLhaCreatePayload(
      {
        unit_designator: "B",
        setting_angle: null,
        lamp_type: "LED",
        tolerance: 0.5,
        altitude: 210,
      },
      [17.0, 48.0],
    );
    expect(payload.setting_angle).toBeNull();
    expect(payload.unit_designator).toBe("B");
    expect(payload.lamp_type).toBe("LED");
    expect(payload.tolerance).toBe(0.5);
    expect(payload.position).toEqual({
      type: "Point",
      coordinates: [17.0, 48.0, 210],
    });
  });

  it("passes through a numeric setting_angle for edge lights", () => {
    const payload = buildLhaCreatePayload(
      {
        unit_designator: "A",
        setting_angle: 0.0,
        lamp_type: "HALOGEN",
        altitude: 210,
      },
      [17.0, 48.0],
    );
    expect(payload.setting_angle).toBe(0.0);
    expect(payload.tolerance).toBeUndefined();
    expect(payload.position.coordinates[2]).toBe(210);
  });

  it("defaults missing unit_designator and lamp_type", () => {
    const payload = buildLhaCreatePayload(
      { setting_angle: 2.75, altitude: 210 },
      [17.0, 48.0],
    );
    expect(payload.unit_designator).toBe("A");
    expect(payload.lamp_type).toBe("HALOGEN");
    expect(payload.setting_angle).toBe(2.75);
  });

  it("uses data.altitude as the Z coordinate", () => {
    const payload = buildLhaCreatePayload(
      { unit_designator: "A", setting_angle: 3.0, altitude: 187.5 },
      [17.5, 48.5],
    );
    expect(payload.position).toEqual({
      type: "Point",
      coordinates: [17.5, 48.5, 187.5],
    });
  });

  it("falls back to 0 when altitude is missing", () => {
    const payload = buildLhaCreatePayload(
      { unit_designator: "A", setting_angle: 3.0 },
      [17.0, 48.0],
    );
    expect(payload.position.coordinates[2]).toBe(0);
  });
});
