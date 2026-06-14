import { describe, expect, it } from "vitest";
import { JulianDate } from "cesium";
import type { WaypointResponse } from "@/types/flightPlan";
import { buildFlyAlongTimeline, USER_SCALE } from "./buildFlyAlongTimeline";
import { terrainKey } from "./terrainSampling";

function wp(id: string, lng: number, lat: number, opts: Partial<WaypointResponse> = {}): WaypointResponse {
  return {
    id,
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
    agl: 50,
    ...opts,
  };
}

describe("buildFlyAlongTimeline", () => {
  it("returns null when fewer than two waypoints", () => {
    const heights = new Map([[terrainKey(10, 50), 100]]);
    const result = buildFlyAlongTimeline(null, [wp("a", 10, 50)], [], heights);
    expect(result).toBeNull();
  });

  it("returns null when segmentDurations length does not match waypoint count - 1", () => {
    const heights = new Map([
      [terrainKey(10, 50), 100],
      [terrainKey(10.01, 50), 100],
    ]);
    const wps = [wp("a", 10, 50), wp("b", 10.01, 50)];
    expect(buildFlyAlongTimeline(null, wps, [], heights)).toBeNull();
    expect(buildFlyAlongTimeline(null, wps, [10, 5], heights)).toBeNull();
  });

  it("returns null when terrain heights are missing for any waypoint", () => {
    // only first wp has a height
    const heights = new Map([[terrainKey(10, 50), 100]]);
    const wps = [wp("a", 10, 50), wp("b", 10.01, 50)];
    expect(buildFlyAlongTimeline(null, wps, [10], heights)).toBeNull();
  });

  it("builds a timeline with totalDuration = sum of segment durations (no hover)", () => {
    const wps = [
      wp("a", 10, 50),
      wp("b", 10.01, 50),
      wp("c", 10.02, 50),
    ];
    const heights = new Map([
      [terrainKey(10, 50), 100],
      [terrainKey(10.01, 50), 100],
      [terrainKey(10.02, 50), 100],
    ]);
    const timeline = buildFlyAlongTimeline(null, wps, [4, 6], heights);
    expect(timeline).not.toBeNull();
    expect(timeline!.totalDuration).toBe(10);
  });

  it("adds an extra hover sample at every waypoint with non-zero hover_duration", () => {
    const wps = [
      wp("a", 10, 50, { hover_duration: 2 }),
      wp("b", 10.01, 50),
    ];
    const heights = new Map([
      [terrainKey(10, 50), 100],
      [terrainKey(10.01, 50), 100],
    ]);
    // segmentTotal=5, hover[a]=2 -> hover sample at +2s, arrival at +5s
    const timeline = buildFlyAlongTimeline(null, wps, [5], heights);
    expect(timeline).not.toBeNull();
    expect(timeline!.totalDuration).toBe(5);

    const { positionProperty, startTime } = timeline!;
    const hoverTime = JulianDate.addSeconds(startTime, 2, new JulianDate());
    const arrivalTime = JulianDate.addSeconds(startTime, 5, new JulianDate());
    expect(positionProperty.getValue(startTime)).not.toBeUndefined();
    expect(positionProperty.getValue(hoverTime)).not.toBeUndefined();
    expect(positionProperty.getValue(arrivalTime)).not.toBeUndefined();
  });

  it("clamps negative or undefined segmentDurations to zero", () => {
    const wps = [wp("a", 10, 50), wp("b", 10.01, 50)];
    const heights = new Map([
      [terrainKey(10, 50), 100],
      [terrainKey(10.01, 50), 100],
    ]);
    const timeline = buildFlyAlongTimeline(null, wps, [-3], heights);
    expect(timeline).not.toBeNull();
    expect(timeline!.totalDuration).toBe(0);
  });

  it("exports USER_SCALE = 0.3 as the canonical default scale", () => {
    expect(USER_SCALE).toBe(0.3);
  });
});
