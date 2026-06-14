import { describe, it, expect } from "vitest";
import { computeSegmentDurations } from "./flyAlongTiming";
import { haversineDistance } from "./geo";
import type { WaypointResponse } from "@/types/flightPlan";

function wp(
  lng: number,
  lat: number,
  alt: number,
  overrides: Partial<WaypointResponse> = {},
): WaypointResponse {
  return {
    id: `${lng},${lat}`,
    flight_plan_id: "fp",
    inspection_id: null,
    sequence_order: 0,
    position: { type: "Point", coordinates: [lng, lat, alt] },
    heading: null,
    speed: null,
    hover_duration: null,
    camera_action: null,
    waypoint_type: "TRANSIT",
    camera_target: null,
    gimbal_pitch: null,
    ...overrides,
  };
}

describe("computeSegmentDurations", () => {
  it("returns empty array for zero waypoints", () => {
    expect(computeSegmentDurations([])).toEqual([]);
  });

  it("returns empty array for one waypoint", () => {
    expect(computeSegmentDurations([wp(0, 0, 0)])).toEqual([]);
  });

  it("uses each source waypoint's speed for its outgoing segment", () => {
    const a = wp(0, 0, 0, { speed: 5 });
    const b = wp(0, 0.008993, 0, { speed: 10 });
    const c = wp(0, 0.017986, 0, { speed: 10 });
    const dist = haversineDistance(0, 0, 0, 0.008993);
    const durations = computeSegmentDurations([a, b, c]);
    expect(durations).toHaveLength(2);
    expect(durations[0]).toBeCloseTo(dist / 5, 3);
    expect(durations[1]).toBeCloseTo(dist / 10, 3);
  });

  it("falls back to provided speed when waypoint speed is missing", () => {
    const a = wp(0, 0, 0, { speed: null });
    const b = wp(0, 0.008993, 0, { speed: null });
    const dist = haversineDistance(0, 0, 0, 0.008993);
    const [duration] = computeSegmentDurations([a, b], { fallbackSpeed: 4 });
    expect(duration).toBeCloseTo(dist / 4, 3);
  });

  it("adds hover_duration from the source waypoint to the segment", () => {
    const a = wp(0, 0, 0, { speed: 10, hover_duration: 7 });
    const b = wp(0, 0.008993, 0, { speed: 10 });
    const dist = haversineDistance(0, 0, 0, 0.008993);
    const [duration] = computeSegmentDurations([a, b]);
    expect(duration).toBeCloseTo(7 + dist / 10, 3);
  });

  it("matches haversine within 0.1 m on a ~1 km horizontal segment", () => {
    // dLat ~= 0.00899322 deg ≈ 1000 m at the equator
    const a = wp(0, 0, 0, { speed: 1 });
    const b = wp(0, 0.00899322, 0);
    const [duration] = computeSegmentDurations([a, b], { fallbackSpeed: 1 });
    const horizontal = haversineDistance(0, 0, 0, 0.00899322);
    expect(Math.abs(duration - horizontal)).toBeLessThan(0.1);
  });

  it("includes vertical component in 3d distance", () => {
    const a = wp(0, 0, 0, { speed: 1 });
    const b = wp(0, 0, 30);
    const [duration] = computeSegmentDurations([a, b]);
    expect(duration).toBeCloseTo(30, 3);
  });

  it("produces zero travel time when no speed is available", () => {
    const a = wp(0, 0, 0, { speed: null, hover_duration: 2 });
    const b = wp(0, 0.0001, 0);
    const [duration] = computeSegmentDurations([a, b]);
    expect(duration).toBe(2);
  });
});
