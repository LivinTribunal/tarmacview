import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AirportDetailResponse } from "@/types/airport";
import { syncEntityGeometryToMap, clearSourceDataCache } from "./syncEntityGeometryToMap";

interface FakeSource {
  setData: ReturnType<typeof vi.fn>;
  features: GeoJSON.Feature[];
}

interface FakeMap {
  sources: Record<string, FakeSource>;
  getSource: (name: string) => FakeSource | undefined;
  querySourceFeatures: (name: string) => GeoJSON.Feature[];
}

function makeMap(initial: Record<string, GeoJSON.Feature[]>): FakeMap {
  /** build a stub maplibre map with geojson sources keyed by id. */
  const sources: Record<string, FakeSource> = {};
  for (const [name, features] of Object.entries(initial)) {
    sources[name] = { setData: vi.fn(), features: [...features] };
  }
  return {
    sources,
    getSource: (name) => sources[name],
    querySourceFeatures: (name) => sources[name]?.features ?? [],
  };
}

function makeAirport(overrides: Partial<AirportDetailResponse>): AirportDetailResponse {
  /** build a minimal airport detail response for the unit-under-test. */
  return {
    id: "airport-1",
    icao_code: "LZIB",
    name: "Bratislava",
    city: null,
    country: null,
    elevation: 130,
    location: { type: "Point", coordinates: [17.21, 48.17, 130] },
    default_drone_profile_id: null,
    terrain_source: "FLAT",
    has_dem: false,
    surfaces: [],
    obstacles: [],
    safety_zones: [],
    ...overrides,
  };
}

const SQUARE_RING: [number, number, number][] = [
  [17.0, 48.0, 130],
  [17.001, 48.0, 130],
  [17.001, 48.001, 130],
  [17.0, 48.001, 130],
  [17.0, 48.0, 130],
];

const SHIFTED_RING: [number, number, number][] = [
  [17.1, 48.1, 130],
  [17.101, 48.1, 130],
  [17.101, 48.101, 130],
  [17.1, 48.101, 130],
  [17.1, 48.1, 130],
];

beforeEach(() => {
  clearSourceDataCache();
});

describe("syncEntityGeometryToMap - surface", () => {
  it("writes both centerline and boundary for a runway", () => {
    const surface = {
      id: "rwy-1",
      airport_id: "airport-1",
      identifier: "09",
      surface_type: "RUNWAY" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [17.0, 48.0, 130],
          [17.001, 48.001, 130],
        ] as [number, number, number][],
      },
      boundary: { type: "Polygon" as const, coordinates: [SQUARE_RING] },
      buffer_distance: 0,
      heading: null,
      length: null,
      width: null,
      threshold_position: null,
      end_position: null,
      touchpoint_latitude: null,
      touchpoint_longitude: null,
      touchpoint_altitude: null,
      paired_surface_id: null,
      agls: [],
    };
    const airport = makeAirport({ surfaces: [surface] });
    const newGeometry = {
      type: "LineString" as const,
      coordinates: [
        [17.5, 48.5, 130],
        [17.6, 48.6, 130],
      ] as [number, number, number][],
    };
    const newBoundary = { type: "Polygon" as const, coordinates: [SHIFTED_RING] };
    const map = makeMap({
      runways: [{ type: "Feature", properties: { id: "rwy-1" }, geometry: surface.geometry }],
      "runways-polygon": [
        { type: "Feature", properties: { id: "rwy-1" }, geometry: surface.boundary! },
      ],
    });

    syncEntityGeometryToMap(map as never, airport, "surface", "rwy-1", {
      geometry: newGeometry,
      boundary: newBoundary,
    });

    expect(map.sources.runways.setData).toHaveBeenCalledTimes(1);
    expect(map.sources["runways-polygon"].setData).toHaveBeenCalledTimes(1);
    const runwayCall = map.sources.runways.setData.mock.calls[0][0] as GeoJSON.FeatureCollection;
    expect(runwayCall.features[0].geometry).toEqual(newGeometry);
    const polyCall = map.sources["runways-polygon"].setData.mock
      .calls[0][0] as GeoJSON.FeatureCollection;
    expect(polyCall.features[0].geometry).toEqual(newBoundary);
  });

  it("writes to taxiway sources for a taxiway", () => {
    const surface = {
      id: "twy-1",
      airport_id: "airport-1",
      identifier: "A",
      surface_type: "TAXIWAY" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [17.0, 48.0, 130],
          [17.001, 48.001, 130],
        ] as [number, number, number][],
      },
      boundary: { type: "Polygon" as const, coordinates: [SQUARE_RING] },
      buffer_distance: 0,
      heading: null,
      length: null,
      width: null,
      threshold_position: null,
      end_position: null,
      touchpoint_latitude: null,
      touchpoint_longitude: null,
      touchpoint_altitude: null,
      paired_surface_id: null,
      agls: [],
    };
    const airport = makeAirport({ surfaces: [surface] });
    const newBoundary = { type: "Polygon" as const, coordinates: [SHIFTED_RING] };
    const map = makeMap({
      taxiways: [{ type: "Feature", properties: { id: "twy-1" }, geometry: surface.geometry }],
      "taxiways-polygon": [
        { type: "Feature", properties: { id: "twy-1" }, geometry: surface.boundary! },
      ],
    });

    syncEntityGeometryToMap(map as never, airport, "surface", "twy-1", {
      boundary: newBoundary,
    });

    expect(map.sources["taxiways-polygon"].setData).toHaveBeenCalledTimes(1);
    // unchanged geometry on rollback - no new value passed - taxiways source still updated
    // since `geometry` falls back to the existing LineString
    expect(map.sources.taxiways.setData).toHaveBeenCalledTimes(1);
  });

  it("falls back to airport state when pendingData is undefined (rollback to clean)", () => {
    const surface = {
      id: "rwy-1",
      airport_id: "airport-1",
      identifier: "09",
      surface_type: "RUNWAY" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [17.0, 48.0, 130],
          [17.001, 48.001, 130],
        ] as [number, number, number][],
      },
      boundary: { type: "Polygon" as const, coordinates: [SQUARE_RING] },
      buffer_distance: 0,
      heading: null,
      length: null,
      width: null,
      threshold_position: null,
      end_position: null,
      touchpoint_latitude: null,
      touchpoint_longitude: null,
      touchpoint_altitude: null,
      paired_surface_id: null,
      agls: [],
    };
    const airport = makeAirport({ surfaces: [surface] });
    const map = makeMap({
      runways: [
        {
          type: "Feature",
          properties: { id: "rwy-1" },
          geometry: { type: "LineString", coordinates: [[0, 0, 0]] },
        },
      ],
      "runways-polygon": [
        {
          type: "Feature",
          properties: { id: "rwy-1" },
          geometry: { type: "Polygon", coordinates: [[[0, 0, 0]]] },
        },
      ],
    });

    syncEntityGeometryToMap(map as never, airport, "surface", "rwy-1", undefined);

    const polyCall = map.sources["runways-polygon"].setData.mock
      .calls[0][0] as GeoJSON.FeatureCollection;
    expect(polyCall.features[0].geometry).toEqual(surface.boundary);
    const runwayCall = map.sources.runways.setData.mock.calls[0][0] as GeoJSON.FeatureCollection;
    expect(runwayCall.features[0].geometry).toEqual(surface.geometry);
  });

  it("no-ops when surface id is unknown", () => {
    const airport = makeAirport({ surfaces: [] });
    const map = makeMap({
      runways: [],
      "runways-polygon": [],
    });
    syncEntityGeometryToMap(map as never, airport, "surface", "missing", { geometry: null });
    expect(map.sources.runways.setData).not.toHaveBeenCalled();
    expect(map.sources["runways-polygon"].setData).not.toHaveBeenCalled();
  });
});

describe("syncEntityGeometryToMap - obstacle", () => {
  it("updates the boundary and recomputes the centroid point", () => {
    const obstacle = {
      id: "obs-1",
      airport_id: "airport-1",
      name: "Tower",
      height: 30,
      boundary: { type: "Polygon" as const, coordinates: [SQUARE_RING] },
      buffer_distance: 0,
      type: "BUILDING" as const,
    };
    const airport = makeAirport({ obstacles: [obstacle] });
    const newBoundary = { type: "Polygon" as const, coordinates: [SHIFTED_RING] };
    const map = makeMap({
      obstacles: [
        {
          type: "Feature",
          properties: { id: "obs-1" },
          geometry: { type: "Point", coordinates: [0, 0, 0] },
        },
      ],
      "obstacles-boundary": [
        { type: "Feature", properties: { id: "obs-1" }, geometry: obstacle.boundary },
      ],
    });

    syncEntityGeometryToMap(map as never, airport, "obstacle", "obs-1", {
      boundary: newBoundary,
    });

    expect(map.sources["obstacles-boundary"].setData).toHaveBeenCalledTimes(1);
    expect(map.sources.obstacles.setData).toHaveBeenCalledTimes(1);
    const point = (
      map.sources.obstacles.setData.mock.calls[0][0] as GeoJSON.FeatureCollection
    ).features[0].geometry as GeoJSON.Point;
    // centroid of the SHIFTED_RING (5 vertices, last == first)
    const ring = SHIFTED_RING;
    const cx = ring.reduce((s, c) => s + c[0], 0) / ring.length;
    const cy = ring.reduce((s, c) => s + c[1], 0) / ring.length;
    expect(point.type).toBe("Point");
    expect(point.coordinates[0]).toBeCloseTo(cx, 6);
    expect(point.coordinates[1]).toBeCloseTo(cy, 6);
  });

  it("falls back to airport boundary when pendingData is undefined", () => {
    const obstacle = {
      id: "obs-1",
      airport_id: "airport-1",
      name: "Tower",
      height: 30,
      boundary: { type: "Polygon" as const, coordinates: [SQUARE_RING] },
      buffer_distance: 0,
      type: "BUILDING" as const,
    };
    const airport = makeAirport({ obstacles: [obstacle] });
    const map = makeMap({
      obstacles: [
        {
          type: "Feature",
          properties: { id: "obs-1" },
          geometry: { type: "Point", coordinates: [0, 0, 0] },
        },
      ],
      "obstacles-boundary": [
        { type: "Feature", properties: { id: "obs-1" }, geometry: obstacle.boundary },
      ],
    });

    syncEntityGeometryToMap(map as never, airport, "obstacle", "obs-1", undefined);

    const boundaryCall = map.sources["obstacles-boundary"].setData.mock
      .calls[0][0] as GeoJSON.FeatureCollection;
    expect(boundaryCall.features[0].geometry).toEqual(obstacle.boundary);
    // centroid is recomputed from the original ring even on rollback
    expect(map.sources.obstacles.setData).toHaveBeenCalled();
  });
});

describe("syncEntityGeometryToMap - safety_zone", () => {
  it("writes airport boundary to its dedicated source", () => {
    const zone = {
      id: "zone-1",
      airport_id: "airport-1",
      name: "Aerodrome",
      type: "AIRPORT_BOUNDARY" as const,
      geometry: { type: "Polygon" as const, coordinates: [SQUARE_RING] },
      altitude_floor: null,
      altitude_ceiling: null,
      is_active: true,
    };
    const airport = makeAirport({ safety_zones: [zone] });
    const newBoundary = { type: "Polygon" as const, coordinates: [SHIFTED_RING] };
    const map = makeMap({
      "airport-boundary": [
        { type: "Feature", properties: { id: "zone-1" }, geometry: zone.geometry },
      ],
    });

    syncEntityGeometryToMap(map as never, airport, "safety_zone", "zone-1", {
      geometry: newBoundary,
    });

    expect(map.sources["airport-boundary"].setData).toHaveBeenCalledTimes(1);
    const fc = map.sources["airport-boundary"].setData.mock
      .calls[0][0] as GeoJSON.FeatureCollection;
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry).toEqual(newBoundary);
    expect(fc.features[0].properties).toMatchObject({
      id: "zone-1",
      entityType: "airport_boundary",
      role: "outline",
    });
  });

  it("writes non-boundary zones to the safety-zones source", () => {
    const zone = {
      id: "zone-2",
      airport_id: "airport-1",
      name: "CTR",
      type: "CTR" as const,
      geometry: { type: "Polygon" as const, coordinates: [SQUARE_RING] },
      altitude_floor: 0,
      altitude_ceiling: 1000,
      is_active: true,
    };
    const airport = makeAirport({ safety_zones: [zone] });
    const newBoundary = { type: "Polygon" as const, coordinates: [SHIFTED_RING] };
    const map = makeMap({
      "safety-zones": [
        { type: "Feature", properties: { id: "zone-2" }, geometry: zone.geometry },
      ],
    });

    syncEntityGeometryToMap(map as never, airport, "safety_zone", "zone-2", {
      geometry: newBoundary,
    });

    expect(map.sources["safety-zones"].setData).toHaveBeenCalledTimes(1);
    const fc = map.sources["safety-zones"].setData.mock
      .calls[0][0] as GeoJSON.FeatureCollection;
    expect(fc.features[0].geometry).toEqual(newBoundary);
  });

  it("falls back to original zone geometry when pending data is undefined", () => {
    const zone = {
      id: "zone-2",
      airport_id: "airport-1",
      name: "CTR",
      type: "CTR" as const,
      geometry: { type: "Polygon" as const, coordinates: [SQUARE_RING] },
      altitude_floor: 0,
      altitude_ceiling: 1000,
      is_active: true,
    };
    const airport = makeAirport({ safety_zones: [zone] });
    const map = makeMap({
      "safety-zones": [
        {
          type: "Feature",
          properties: { id: "zone-2" },
          geometry: { type: "Polygon", coordinates: [[[0, 0, 0]]] },
        },
      ],
    });

    syncEntityGeometryToMap(map as never, airport, "safety_zone", "zone-2", undefined);

    const fc = map.sources["safety-zones"].setData.mock
      .calls[0][0] as GeoJSON.FeatureCollection;
    expect(fc.features[0].geometry).toEqual(zone.geometry);
  });
});

describe("syncEntityGeometryToMap - unknown entity type", () => {
  it("is a no-op for entity types it doesn't know about", () => {
    const airport = makeAirport({});
    const map = makeMap({});
    expect(() =>
      syncEntityGeometryToMap(map as never, airport, "wat", "x", { foo: "bar" }),
    ).not.toThrow();
  });
});
