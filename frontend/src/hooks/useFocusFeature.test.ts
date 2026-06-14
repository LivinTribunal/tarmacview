import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import type maplibregl from "maplibre-gl";
import type { Viewer as CesiumViewerType } from "cesium";
import {
  computeMapLibreFocus,
  computeFeatureAltitude,
  flyMapLibreToFeature,
  cesiumRangeForFeature,
  flyCesiumToFeature,
  useFocusFeature,
} from "./useFocusFeature";
import type { MapFeature } from "@/types/map";
import { MAP_QUICK_DURATION_MS } from "@/constants/mapAnimations";

function waypointFeature(): MapFeature {
  return {
    type: "waypoint",
    data: {
      id: "wp1",
      waypoint_type: "MEASUREMENT",
      sequence_order: 3,
      position: { type: "Point", coordinates: [14.5, 50.1, 120] },
      stack_count: 1,
    },
  };
}

function obstacleFeature(): MapFeature {
  return {
    type: "obstacle",
    data: {
      id: "o1",
      airport_id: "a1",
      name: "Tower",
      type: "TOWER",
      boundary: {
        type: "Polygon",
        coordinates: [[[14.5, 50.1], [14.6, 50.1], [14.55, 50.2], [14.5, 50.1]]],
      },
      height: 50,
    },
  } as unknown as MapFeature;
}

/** an entity tagged the way CesiumTrajectory tags its waypoint dots. */
function taggedEntity(featureType: string, featureId: string) {
  return {
    properties: {
      featureType: { getValue: () => featureType },
      featureId: { getValue: () => featureId },
    },
  };
}

/** build a minimal cesium viewer mock. dataSourceEntities is a list of
 * per-datasource entity arrays so we can place a match in viewer.dataSources. */
function makeViewer(
  opts: { entities?: unknown[]; dataSourceEntities?: unknown[][] } = {},
) {
  const flyTo = vi.fn().mockResolvedValue(true);
  const cameraFlyTo = vi.fn();
  const flyToBoundingSphere = vi.fn();
  const dsList = (opts.dataSourceEntities ?? []).map((values) => ({
    entities: { values },
  }));
  const viewer = {
    isDestroyed: () => false,
    entities: { values: opts.entities ?? [] },
    dataSources: {
      length: dsList.length,
      get: (i: number) => dsList[i],
    },
    flyTo,
    camera: { flyTo: cameraFlyTo, flyToBoundingSphere },
  } as unknown as CesiumViewerType;
  return { viewer, flyTo, cameraFlyTo, flyToBoundingSphere };
}

describe("computeMapLibreFocus", () => {
  it("returns coords and minZoom 17 for a waypoint", () => {
    const focus = computeMapLibreFocus(waypointFeature());
    expect(focus).not.toBeNull();
    expect(focus?.lon).toBe(14.5);
    expect(focus?.lat).toBe(50.1);
    expect(focus?.minZoom).toBe(17);
  });

  it("computes polygon centroid for obstacles", () => {
    const focus = computeMapLibreFocus(obstacleFeature());
    expect(focus).not.toBeNull();
    // ring has 4 points (first == last); average of all 4
    const expLon = (14.5 + 14.6 + 14.55 + 14.5) / 4;
    const expLat = (50.1 + 50.1 + 50.2 + 50.1) / 4;
    expect(focus?.lon).toBeCloseTo(expLon, 5);
    expect(focus?.lat).toBeCloseTo(expLat, 5);
  });
});

describe("flyMapLibreToFeature", () => {
  it("calls map.flyTo with feature center and >= minZoom", async () => {
    const flyTo = vi.fn();
    const getZoom = vi.fn(() => 10);
    const map = { flyTo, getZoom } as unknown as maplibregl.Map;

    flyMapLibreToFeature(map, waypointFeature());
    await Promise.resolve();

    expect(flyTo).toHaveBeenCalledTimes(1);
    const call = flyTo.mock.calls[0][0];
    expect(call.center).toEqual([14.5, 50.1]);
    expect(call.zoom).toBeGreaterThanOrEqual(17);
    expect(call.duration).toBe(MAP_QUICK_DURATION_MS);
    expect(call.essential).toBe(true);
  });

  it("preserves current zoom when it already exceeds minZoom", async () => {
    const flyTo = vi.fn();
    const map = { flyTo, getZoom: () => 19 } as unknown as maplibregl.Map;

    flyMapLibreToFeature(map, waypointFeature());
    await Promise.resolve();

    const call = flyTo.mock.calls[0][0];
    expect(call.zoom).toBe(19);
  });
});

describe("computeFeatureAltitude", () => {
  it("returns the waypoint altitude from its position", () => {
    expect(computeFeatureAltitude(waypointFeature())).toBe(120);
  });

  it("returns 0 when the obstacle ring has no z values", () => {
    expect(computeFeatureAltitude(obstacleFeature())).toBe(0);
  });
});

describe("cesiumRangeForFeature", () => {
  it("returns tighter range for point-like features", () => {
    expect(cesiumRangeForFeature({ type: "agl" } as MapFeature)).toBe(250);
    expect(cesiumRangeForFeature({ type: "lha" } as MapFeature)).toBe(250);
    expect(cesiumRangeForFeature({ type: "obstacle" } as MapFeature)).toBe(350);
  });

  it("returns a wider range for surfaces and waypoints", () => {
    expect(cesiumRangeForFeature({ type: "surface" } as MapFeature)).toBe(1000);
    expect(cesiumRangeForFeature({ type: "waypoint" } as MapFeature)).toBe(600);
  });
});

describe("useFocusFeature", () => {
  it("does nothing when called with null feature", () => {
    const flyTo = vi.fn();
    const mapRef = { current: { flyTo, getZoom: () => 10 } } as unknown as RefObject<maplibregl.Map | null>;

    const { result } = renderHook(() => useFocusFeature({ mapRef }));
    result.current.locateFeature(null);

    expect(flyTo).not.toHaveBeenCalled();
  });

  it("dispatches to the maplibre map when no cesium viewer is live", async () => {
    const flyTo = vi.fn();
    const mapRef = { current: { flyTo, getZoom: () => 10 } } as unknown as RefObject<maplibregl.Map | null>;

    const { result } = renderHook(() => useFocusFeature({ mapRef }));
    result.current.locateFeature(waypointFeature());
    await Promise.resolve();

    expect(flyTo).toHaveBeenCalledTimes(1);
  });

  it("prefers cesium when both refs are live", async () => {
    const flyTo = vi.fn();
    const { viewer } = makeViewer();
    const cesiumViewerRef = { current: viewer } as RefObject<CesiumViewerType | null>;
    const mapRef = { current: { flyTo, getZoom: () => 10 } } as unknown as RefObject<maplibregl.Map | null>;

    const { result } = renderHook(() => useFocusFeature({ mapRef, cesiumViewerRef }));
    result.current.locateFeature(waypointFeature());
    await Promise.resolve();

    // maplibre must not receive the call when cesium is live
    expect(flyTo).not.toHaveBeenCalled();
  });

  it("skips cesium viewer if destroyed, falls through to maplibre", async () => {
    const flyTo = vi.fn();
    const viewer = { isDestroyed: () => true } as unknown as CesiumViewerType;
    const cesiumViewerRef = { current: viewer } as RefObject<CesiumViewerType | null>;
    const mapRef = { current: { flyTo, getZoom: () => 10 } } as unknown as RefObject<maplibregl.Map | null>;

    const { result } = renderHook(() => useFocusFeature({ mapRef, cesiumViewerRef }));
    result.current.locateFeature(waypointFeature());
    await Promise.resolve();

    expect(flyTo).toHaveBeenCalledTimes(1);
  });
});

describe("flyCesiumToFeature", () => {
  it("matches a waypoint entity held in viewer.dataSources, not just viewer.entities", async () => {
    const entity = taggedEntity("waypoint", "wp1");
    const { viewer, flyTo, cameraFlyTo, flyToBoundingSphere } = makeViewer({
      entities: [],
      dataSourceEntities: [[], [entity, taggedEntity("waypoint", "other")]],
    });

    await flyCesiumToFeature(viewer, waypointFeature());

    expect(flyTo).toHaveBeenCalledTimes(1);
    expect(flyTo.mock.calls[0][0]).toBe(entity);
    const offset = flyTo.mock.calls[0][1].offset;
    expect(offset.range).toBe(600);
    expect(offset.pitch).toBeCloseTo(-Math.PI / 4, 6);
    // the coord fallback must NOT run when an entity matched
    expect(cameraFlyTo).not.toHaveBeenCalled();
    expect(flyToBoundingSphere).not.toHaveBeenCalled();
  });

  it("still matches an entity held directly in viewer.entities", async () => {
    const entity = taggedEntity("waypoint", "wp1");
    const { viewer, flyTo } = makeViewer({ entities: [entity] });

    await flyCesiumToFeature(viewer, waypointFeature());

    expect(flyTo).toHaveBeenCalledTimes(1);
    expect(flyTo.mock.calls[0][0]).toBe(entity);
  });

  it("frames the coord fallback with an orbit offset instead of parking on the point", async () => {
    const { viewer, flyTo, cameraFlyTo, flyToBoundingSphere } = makeViewer({
      entities: [],
      dataSourceEntities: [[taggedEntity("waypoint", "different")]],
    });

    await flyCesiumToFeature(viewer, waypointFeature());

    expect(flyTo).not.toHaveBeenCalled();
    // old buggy path used camera.flyTo({ destination: <the point> })
    expect(cameraFlyTo).not.toHaveBeenCalled();
    expect(flyToBoundingSphere).toHaveBeenCalledTimes(1);
    const [sphere, options] = flyToBoundingSphere.mock.calls[0];
    expect(sphere.radius).toBe(1);
    expect(options.offset.range).toBe(600);
    expect(options.offset.pitch).toBeCloseTo(-Math.PI / 4, 6);
  });
});

describe("useFocusFeature stability", () => {
  it("returns a stable locateFeature reference across renders when refs don't change", () => {
    const mapRef = { current: null } as RefObject<maplibregl.Map | null>;
    const { result, rerender } = renderHook(() => useFocusFeature({ mapRef }));
    const first = result.current.locateFeature;
    rerender();
    const second = result.current.locateFeature;
    expect(first).toBe(second);
  });
});
