import { describe, expect, it } from "vitest";
import type { AirportDetailResponse } from "@/types/airport";
import type { WaypointResponse } from "@/types/flightPlan";
import { isMapFeatureType, lookupFeature } from "./featureLookup";

function makeAirport(): AirportDetailResponse {
  return {
    id: "airport-1",
    icao_code: "TEST",
    name: "Test Airport",
    city: null,
    country: null,
    elevation: 100,
    location: { type: "Point", coordinates: [10, 50, 100] },
    default_drone_profile_id: null,
    terrain_source: "FLAT",
    has_dem: false,
    surfaces: [
      {
        id: "rwy-1",
        airport_id: "airport-1",
        identifier: "01",
        surface_type: "RUNWAY",
        geometry: { type: "LineString", coordinates: [[10, 50, 100], [10.01, 50, 100]] },
        boundary: null,
        buffer_distance: 0,
        heading: null,
        length: null,
        width: 45,
        threshold_position: null,
        end_position: null,
        touchpoint_latitude: null,
        touchpoint_longitude: null,
        touchpoint_altitude: null,
        paired_surface_id: null,
        agls: [
          {
            id: "agl-1",
            surface_id: "rwy-1",
            name: "PAPI A",
            agl_type: "PAPI",
            position: { type: "Point", coordinates: [10, 50, 100] },
            papi_side: null,
            lhas: [
              {
                id: "lha-1",
                agl_id: "agl-1",
                unit_designator: "A",
                position: { type: "Point", coordinates: [10.001, 50, 100] },
                setting_angle: 3.0,
                lamp_type: "PAPI",
              },
            ],
          },
        ],
      },
    ],
    obstacles: [
      {
        id: "obs-1",
        airport_id: "airport-1",
        name: "Tower",
        type: "TOWER",
        position: { type: "Point", coordinates: [10.005, 50, 50] },
        height: 30,
        buffer_distance: 0,
        boundary: null,
      },
    ],
    safety_zones: [
      {
        id: "zone-1",
        airport_id: "airport-1",
        type: "CTR",
        name: "CTR",
        geometry: null,
        is_active: true,
        altitude_floor: 0,
        altitude_ceiling: 500,
      },
    ],
  } as unknown as AirportDetailResponse;
}

function makeWaypoint(id: string): WaypointResponse {
  return {
    id,
    flight_plan_id: "fp-1",
    inspection_id: null,
    sequence_order: 1,
    position: { type: "Point", coordinates: [10, 50, 120] },
    heading: 90,
    speed: 5,
    hover_duration: null,
    camera_action: null,
    waypoint_type: "TRANSIT",
    camera_target: null,
    gimbal_pitch: 0,
  };
}

describe("isMapFeatureType", () => {
  it("accepts every valid type", () => {
    for (const type of ["surface", "obstacle", "safety_zone", "agl", "lha", "waypoint"]) {
      expect(isMapFeatureType(type)).toBe(true);
    }
  });

  it("rejects unknown strings and non-strings", () => {
    expect(isMapFeatureType("bogus")).toBe(false);
    expect(isMapFeatureType(null)).toBe(false);
    expect(isMapFeatureType(undefined)).toBe(false);
    expect(isMapFeatureType(42)).toBe(false);
  });
});

describe("lookupFeature", () => {
  it("resolves surface, obstacle and safety_zone hits", () => {
    const a = makeAirport();
    expect(lookupFeature(a, "surface", "rwy-1")?.type).toBe("surface");
    expect(lookupFeature(a, "obstacle", "obs-1")?.type).toBe("obstacle");
    expect(lookupFeature(a, "safety_zone", "zone-1")?.type).toBe("safety_zone");
  });

  it("walks surfaces to find AGL and LHA nested children", () => {
    const a = makeAirport();
    expect(lookupFeature(a, "agl", "agl-1")?.type).toBe("agl");
    expect(lookupFeature(a, "lha", "lha-1")?.type).toBe("lha");
  });

  it("resolves a waypoint by id from the supplied waypoints array", () => {
    const a = makeAirport();
    const wp = makeWaypoint("wp-1");
    const result = lookupFeature(a, "waypoint", "wp-1", [wp]);
    expect(result?.type).toBe("waypoint");
    if (result?.type === "waypoint") {
      expect(result.data.id).toBe("wp-1");
      expect(result.data.stack_count).toBe(1);
    }
  });

  it("synthesises a TAKEOFF waypoint from the takeoff coordinate", () => {
    const a = makeAirport();
    const coord = { type: "Point" as const, coordinates: [10.1, 50.1, 100] as [number, number, number] };
    const result = lookupFeature(a, "waypoint", "takeoff", [], coord, null);
    expect(result?.type).toBe("waypoint");
    if (result?.type === "waypoint") {
      expect(result.data.waypoint_type).toBe("TAKEOFF");
    }
  });

  it("synthesises a LANDING waypoint from the landing coordinate", () => {
    const a = makeAirport();
    const coord = { type: "Point" as const, coordinates: [10.2, 50.2, 100] as [number, number, number] };
    const result = lookupFeature(a, "waypoint", "landing", [], null, coord);
    expect(result?.type).toBe("waypoint");
    if (result?.type === "waypoint") {
      expect(result.data.waypoint_type).toBe("LANDING");
    }
  });

  it("returns null when the id is unknown", () => {
    const a = makeAirport();
    expect(lookupFeature(a, "surface", "ghost")).toBeNull();
    expect(lookupFeature(a, "waypoint", "ghost", [], null, null)).toBeNull();
  });
});
