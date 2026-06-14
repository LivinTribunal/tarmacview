import { describe, expect, it } from "vitest";
import type { WaypointResponse } from "@/types/flightPlan";
import {
  BODY_TRACKS_TARGET_TOLERANCE_DEG,
  bearing,
  bearingBetweenWaypoints,
  bodyTracksTarget,
} from "./flyAlongBearing";

function wp(lng: number, lat: number, opts: Partial<WaypointResponse> = {}): WaypointResponse {
  return {
    id: "wp",
    flight_plan_id: "fp",
    inspection_id: null,
    sequence_order: 1,
    position: { type: "Point", coordinates: [lng, lat, 0] },
    heading: null,
    speed: null,
    hover_duration: null,
    camera_action: null,
    waypoint_type: "TRANSIT",
    camera_target: null,
    gimbal_pitch: null,
    ...opts,
  };
}

describe("bearing", () => {
  it("returns 0 when destination is due north", () => {
    expect(bearing(50, 10, 51, 10)).toBeCloseTo(0, 1);
  });

  it("returns 90 when destination is due east", () => {
    expect(bearing(50, 10, 50, 11)).toBeCloseTo(90, 0);
  });

  it("returns 180 when destination is due south", () => {
    expect(bearing(50, 10, 49, 10)).toBeCloseTo(180, 1);
  });

  it("returns 270 when destination is due west", () => {
    expect(bearing(50, 10, 50, 9)).toBeCloseTo(270, 0);
  });

  it("wraps across the antimeridian", () => {
    // due west across the 180/-180 seam
    const result = bearing(0, 179, 0, -179);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(360);
    expect(result).toBeCloseTo(90, 0);
  });
});

describe("bearingBetweenWaypoints", () => {
  it("threads (lng, lat) order correctly", () => {
    const a = wp(10, 50);
    const b = wp(11, 50);
    expect(bearingBetweenWaypoints(a, b)).toBeCloseTo(90, 0);
  });
});

describe("bodyTracksTarget", () => {
  it("returns false when there is no camera_target", () => {
    expect(bodyTracksTarget(wp(10, 50))).toBe(false);
  });

  it("returns true when heading is null but a camera_target exists", () => {
    const w = wp(10, 50, {
      camera_target: { type: "Point", coordinates: [10, 51, 0] },
      heading: null,
    });
    expect(bodyTracksTarget(w)).toBe(true);
  });

  it("returns true when wp.heading is within tolerance of bearing-to-target", () => {
    // target due east, heading approximately east within the 5 deg tolerance
    const w = wp(10, 50, {
      camera_target: { type: "Point", coordinates: [11, 50, 0] },
      heading: 92,
    });
    expect(bodyTracksTarget(w)).toBe(true);
  });

  it("returns false when heading is a row direction (FO/PSS-style)", () => {
    // target due east but heading is northward (row sweep)
    const w = wp(10, 50, {
      camera_target: { type: "Point", coordinates: [11, 50, 0] },
      heading: 0,
    });
    expect(bodyTracksTarget(w)).toBe(false);
  });

  it("exports the canonical tolerance constant", () => {
    expect(BODY_TRACKS_TARGET_TOLERANCE_DEG).toBe(5);
  });
});
