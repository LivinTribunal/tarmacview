import { describe, expect, it } from "vitest";
import type maplibregl from "maplibre-gl";
import type { AirportDetailResponse } from "@/types/airport";
import type { WaypointResponse } from "@/types/flightPlan";
import {
  ALL_WP_HOVER_LAYERS,
  WAYPOINT_QUERY_LAYERS,
  buildInfraFeature,
  buildWaypointFeature,
  resolveTransitInsertion,
} from "./pickFeatureBuilders";
import {
  WAYPOINT_HOVER_LAYER,
  WAYPOINT_LANDING_LAYER,
  WAYPOINT_MEASUREMENT_CIRCLE_LAYER,
  WAYPOINT_TAKEOFF_LAYER,
  WAYPOINT_TRANSIT_CIRCLE_LAYER,
  SIMPLIFIED_LANDING_LAYER,
  SIMPLIFIED_TAKEOFF_LAYER,
} from "../layers/waypointLayers";
import { SAFETY_ZONE_FILL_LAYER } from "../layers/safetyZoneLayers";

function makeWaypoint(id: string): WaypointResponse {
  return {
    id,
    flight_plan_id: "fp",
    inspection_id: null,
    sequence_order: 3,
    position: { type: "Point", coordinates: [10, 50, 100] },
    heading: 90,
    speed: 5,
    hover_duration: null,
    camera_action: null,
    waypoint_type: "MEASUREMENT",
    camera_target: null,
    gimbal_pitch: -45,
  };
}

function makeHit(props: Record<string, unknown>, geom?: GeoJSON.Geometry): maplibregl.MapGeoJSONFeature {
  return {
    properties: props,
    geometry: geom ?? { type: "Point", coordinates: [10, 50, 100] },
    layer: { id: WAYPOINT_TRANSIT_CIRCLE_LAYER },
    type: "Feature",
    id: "hit",
  } as unknown as maplibregl.MapGeoJSONFeature;
}

describe("resolveTransitInsertion", () => {
  it("interpolates altitude along the segment when endpoints are present", () => {
    const props = {
      from_alt: 100,
      to_alt: 200,
      from_seq: 4,
      from_lng: 10,
      from_lat: 50,
      to_lng: 10.02,
      to_lat: 50,
    };
    const result = resolveTransitInsertion(props, { lng: 10.01, lat: 50 });
    expect(result.afterSeq).toBe(4);
    // midpoint = 150
    expect(result.alt).toBeCloseTo(150, 1);
  });

  it("falls back to from_alt when endpoint lng/lat are missing", () => {
    const props = { from_alt: 80, to_alt: 120, from_seq: 1 };
    const result = resolveTransitInsertion(props, { lng: 10, lat: 50 });
    expect(result.alt).toBe(80);
    expect(result.afterSeq).toBe(1);
  });

  it("defaults afterSeq to 0 and altitude to 0 when no properties supplied", () => {
    const result = resolveTransitInsertion(null, { lng: 0, lat: 0 });
    expect(result).toEqual({ alt: 0, afterSeq: 0 });
  });
});

describe("buildWaypointFeature", () => {
  it("returns null when the hit has no id", () => {
    const hit = makeHit({});
    expect(buildWaypointFeature(hit, [])).toBeNull();
  });

  it("hydrates from the matching waypoint when one is found", () => {
    const wp = makeWaypoint("wp-1");
    const hit = makeHit({
      id: "wp-1",
      waypoint_type: "MEASUREMENT",
      sequence_order: 5,
      altitude: 110,
      stack_count: 1,
    });
    const built = buildWaypointFeature(hit, [wp]);
    expect(built).not.toBeNull();
    expect(built!.wpId).toBe("wp-1");
    if (built!.feature.type === "waypoint") {
      expect(built!.feature.data.heading).toBe(90);
      expect(built!.feature.data.gimbal_pitch).toBe(-45);
      expect(built!.feature.data.stack_count).toBe(1);
      expect(built!.feature.data.position.coordinates[2]).toBe(110);
    }
  });

  it("falls back to coordinate altitude when no altitude property is set", () => {
    const hit = makeHit(
      { id: "wp-x", waypoint_type: "TRANSIT", sequence_order: 0, stack_count: 1 },
      { type: "Point", coordinates: [10, 50, 215] } as GeoJSON.Point,
    );
    const built = buildWaypointFeature(hit, []);
    expect(built).not.toBeNull();
    if (built!.feature.type === "waypoint") {
      expect(built!.feature.data.position.coordinates[2]).toBe(215);
    }
  });

  it("treats a comma-joined id as a stack key and resolves the first member", () => {
    const wp = makeWaypoint("wp-1");
    const hit = makeHit({
      id: "wp-1,wp-2",
      waypoint_type: "MEASUREMENT",
      sequence_order: 1,
      stack_count: 2,
      seq_min: 1,
      seq_max: 2,
      alt_min: 100,
      alt_max: 120,
    });
    const built = buildWaypointFeature(hit, [wp]);
    expect(built).not.toBeNull();
    expect(built!.wpId).toBe("wp-1,wp-2");
    if (built!.feature.type === "waypoint") {
      expect(built!.feature.data.stack_count).toBe(2);
      expect(built!.feature.data.seq_min).toBe(1);
      expect(built!.feature.data.seq_max).toBe(2);
    }
  });
});

describe("buildInfraFeature", () => {
  const airport = {
    surfaces: [
      {
        id: "rwy-1",
        agls: [
          { id: "agl-1", lhas: [{ id: "lha-1" }] },
        ],
      },
    ],
    obstacles: [{ id: "obs-1" }],
    safety_zones: [{ id: "zone-1" }],
  } as unknown as AirportDetailResponse;

  it("resolves a surface entity-type hit", () => {
    const f = {
      properties: { id: "rwy-1", entityType: "surface" },
      layer: { id: "runways-fill" },
    } as unknown as maplibregl.MapGeoJSONFeature;
    expect(buildInfraFeature([f], airport)?.type).toBe("surface");
  });

  it("resolves an AGL entity-type hit by walking surfaces", () => {
    const f = {
      properties: { id: "agl-1", entityType: "agl" },
      layer: { id: "agl-marker" },
    } as unknown as maplibregl.MapGeoJSONFeature;
    expect(buildInfraFeature([f], airport)?.type).toBe("agl");
  });

  it("resolves an LHA entity-type hit by walking surfaces.agls.lhas", () => {
    const f = {
      properties: { id: "lha-1", entityType: "lha" },
      layer: { id: "lha-marker" },
    } as unknown as maplibregl.MapGeoJSONFeature;
    expect(buildInfraFeature([f], airport)?.type).toBe("lha");
  });

  it("prefers a point hit over a safety-zone fill in the same query result", () => {
    const fill = {
      properties: { id: "zone-1", entityType: "safety_zone" },
      layer: { id: SAFETY_ZONE_FILL_LAYER },
    } as unknown as maplibregl.MapGeoJSONFeature;
    const point = {
      properties: { id: "obs-1", entityType: "obstacle" },
      layer: { id: "obstacles-icon" },
    } as unknown as maplibregl.MapGeoJSONFeature;
    // fill comes first but should not win
    const result = buildInfraFeature([fill, point], airport);
    expect(result?.type).toBe("obstacle");
  });

  it("returns null when entityType is unknown", () => {
    const f = {
      properties: { id: "x", entityType: "bogus" },
      layer: { id: "x" },
    } as unknown as maplibregl.MapGeoJSONFeature;
    expect(buildInfraFeature([f], airport)).toBeNull();
  });
});

describe("layer id tables", () => {
  it("WAYPOINT_QUERY_LAYERS contains both full and simplified T/L plus circles", () => {
    expect(WAYPOINT_QUERY_LAYERS).toEqual([
      WAYPOINT_TRANSIT_CIRCLE_LAYER,
      WAYPOINT_MEASUREMENT_CIRCLE_LAYER,
      WAYPOINT_TAKEOFF_LAYER,
      WAYPOINT_LANDING_LAYER,
      WAYPOINT_HOVER_LAYER,
      SIMPLIFIED_TAKEOFF_LAYER,
      SIMPLIFIED_LANDING_LAYER,
    ]);
  });

  it("ALL_WP_HOVER_LAYERS excludes the simplified-trajectory markers", () => {
    expect(ALL_WP_HOVER_LAYERS).toEqual([
      WAYPOINT_TRANSIT_CIRCLE_LAYER,
      WAYPOINT_MEASUREMENT_CIRCLE_LAYER,
      WAYPOINT_TAKEOFF_LAYER,
      WAYPOINT_LANDING_LAYER,
      WAYPOINT_HOVER_LAYER,
    ]);
    expect(ALL_WP_HOVER_LAYERS).not.toContain(SIMPLIFIED_TAKEOFF_LAYER);
    expect(ALL_WP_HOVER_LAYERS).not.toContain(SIMPLIFIED_LANDING_LAYER);
  });
});
