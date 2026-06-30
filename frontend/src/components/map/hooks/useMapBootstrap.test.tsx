import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import type maplibregl from "maplibre-gl";

const callLog: string[] = [];

vi.mock("../layers/mapImages", () => ({
  registerAllMapImages: vi.fn(() => callLog.push("registerAllMapImages")),
}));

vi.mock("../layers/surfaceLayers", () => ({
  addSurfaceLayers: vi.fn(() => callLog.push("addSurfaceLayers")),
  RUNWAY_SOURCE: "runway-source",
  RUNWAY_POLYGON_SOURCE: "runway-polygon-source",
  TAXIWAY_SOURCE: "taxiway-source",
  TAXIWAY_POLYGON_SOURCE: "taxiway-polygon-source",
  TOUCHPOINT_SOURCE: "touchpoint-source",
  THRESHOLD_SOURCE: "threshold-source",
  END_POSITION_SOURCE: "end-position-source",
}));

vi.mock("../layers/obstacleLayers", () => ({
  addObstacleLayers: vi.fn(() => callLog.push("addObstacleLayers")),
  addBufferZoneLayers: vi.fn(() => callLog.push("addBufferZoneLayers")),
  OBSTACLE_SOURCE: "obstacle-source",
  OBSTACLE_BOUNDARY_SOURCE: "obstacle-boundary-source",
  OBSTACLE_BUFFER_SOURCE: "obstacle-buffer-source",
  SURFACE_BUFFER_SOURCE: "surface-buffer-source",
}));

vi.mock("../layers/safetyZoneLayers", () => ({
  addSafetyZoneLayers: vi.fn(() => callLog.push("addSafetyZoneLayers")),
  SAFETY_ZONE_SOURCE: "safety-zone-source",
  AIRPORT_BOUNDARY_SOURCE: "airport-boundary-source",
}));

vi.mock("../layers/aglLayers", () => ({
  addAglLayers: vi.fn(() => callLog.push("addAglLayers")),
  AGL_SOURCE: "agl-source",
  LHA_SOURCE: "lha-source",
  EDGE_LIGHTS_LINE_SOURCE: "edge-lights-line-source",
}));

vi.mock("../layers/waypointLayers", () => ({
  addWaypointLayers: vi.fn(() => callLog.push("addWaypointLayers")),
  removeWaypointLayers: vi.fn(() => callLog.push("removeWaypointLayers")),
  addSimplifiedTrajectoryLayers: vi.fn(() => callLog.push("addSimplifiedTrajectoryLayers")),
  removeSimplifiedTrajectoryLayers: vi.fn(() => callLog.push("removeSimplifiedTrajectoryLayers")),
  updateInspectionHighlightFilter: vi.fn(() => callLog.push("updateInspectionHighlightFilter")),
  updateWarningHighlightFilter: vi.fn(() => callLog.push("updateWarningHighlightFilter")),
  WAYPOINT_TAKEOFF_LAYER: "waypoint-takeoff-layer",
  WAYPOINT_LANDING_LAYER: "waypoint-landing-layer",
}));

vi.mock("../mapStyles", () => ({
  makeSatelliteStyle: vi.fn(() => ({ name: "satellite" })),
  makeMapStyle: vi.fn(() => ({ name: "map" })),
  waitForStyleLoaded: vi.fn((_map: unknown, cb: () => void) => {
    callLog.push("waitForStyleLoaded");
    cb();
    return () => {};
  }),
}));

vi.mock("./useMeasureTool", () => ({
  addMeasureLayersToMap: vi.fn(() => callLog.push("addMeasureLayersToMap")),
}));

vi.mock("./useHeadingTool", () => ({
  addHeadingLayersToMap: vi.fn(() => callLog.push("addHeadingLayersToMap")),
}));

vi.mock("./useMapHighlightLayers", () => ({
  addHighlightLayers: vi.fn(() => callLog.push("addHighlightLayers")),
  syncHighlight: vi.fn(() => callLog.push("syncHighlight")),
  HIGHLIGHT_LAYERS: ["highlight-runway", "highlight-taxiway"],
}));

vi.mock("../mapLayerGroups", () => ({
  layerGroupMap: {
    runways: ["runway-fill", "runway-stroke"],
    taxiways: ["taxiway-fill"],
  },
}));

vi.mock("@/constants/palette", () => ({
  WAYPOINT_HIGHLIGHT_COLORS: { HIGHLIGHT: "#000", HALO: "#fff" },
}));

import { useMapBootstrap } from "./useMapBootstrap";

interface FakeMap {
  isStyleLoaded: () => boolean;
  addSource: ReturnType<typeof vi.fn>;
  addLayer: ReturnType<typeof vi.fn>;
  getSource: ReturnType<typeof vi.fn>;
  getLayer: ReturnType<typeof vi.fn>;
  getStyle: ReturnType<typeof vi.fn>;
  removeLayer: ReturnType<typeof vi.fn>;
  removeSource: ReturnType<typeof vi.fn>;
  setLayoutProperty: ReturnType<typeof vi.fn>;
  triggerRepaint: ReturnType<typeof vi.fn>;
  moveLayer: ReturnType<typeof vi.fn>;
  setStyle: ReturnType<typeof vi.fn>;
  getCenter: () => { lng: number; lat: number };
  getZoom: () => number;
  getBearing: () => number;
  getPitch: () => number;
  setCenter: ReturnType<typeof vi.fn>;
  setZoom: ReturnType<typeof vi.fn>;
  setBearing: ReturnType<typeof vi.fn>;
  setPitch: ReturnType<typeof vi.fn>;
}

function makeFakeMap(): FakeMap {
  return {
    isStyleLoaded: () => true,
    addSource: vi.fn(() => callLog.push("map.addSource")),
    addLayer: vi.fn(() => callLog.push("map.addLayer")),
    getSource: vi.fn(() => undefined),
    getLayer: vi.fn((id: string) => ({ id })),
    getStyle: vi.fn(() => ({ layers: [] })),
    removeLayer: vi.fn(() => callLog.push("map.removeLayer")),
    removeSource: vi.fn(() => callLog.push("map.removeSource")),
    setLayoutProperty: vi.fn(),
    triggerRepaint: vi.fn(() => callLog.push("triggerRepaint")),
    moveLayer: vi.fn((id: string) => callLog.push(`moveLayer:${id}`)),
    setStyle: vi.fn(() => callLog.push("setStyle")),
    getCenter: () => ({ lng: 1, lat: 2 }),
    getZoom: () => 10,
    getBearing: () => 0,
    getPitch: () => 0,
    setCenter: vi.fn(() => callLog.push("setCenter")),
    setZoom: vi.fn(() => callLog.push("setZoom")),
    setBearing: vi.fn(() => callLog.push("setBearing")),
    setPitch: vi.fn(() => callLog.push("setPitch")),
  };
}

const airport = {
  id: "a1",
  surfaces: [],
  obstacles: [],
  safety_zones: [],
} as unknown as Parameters<typeof useMapBootstrap>[0]["airport"];

function makeRefs(fakeMap: FakeMap) {
  return {
    mapRef: { current: fakeMap as unknown as maplibregl.Map },
    layerConfigRef: { current: { runways: true, taxiways: true } as never },
    focusFeatureRef: { current: null },
    focusLhaIdsRef: { current: null },
    highlightedIdsRef: { current: undefined },
    highlightSeverityRef: { current: undefined },
    highlightedInspectionIdRef: { current: undefined },
    onMeasureClearRef: { current: vi.fn(() => callLog.push("onMeasureClear")) },
    onHeadingClearRef: { current: vi.fn(() => callLog.push("onHeadingClear")) },
    waypointsRef: { current: [] },
    takeoffRef: { current: null },
    landingRef: { current: null },
    indexMapRef: { current: undefined },
  };
}

function renderBootstrap(fakeMap: FakeMap, overrides: Partial<Parameters<typeof useMapBootstrap>[0]> = {}) {
  const refs = makeRefs(fakeMap);
  return renderHook(() => {
    const syncLayerVisibility = useRef(vi.fn(() => callLog.push("syncLayerVisibility"))).current;
    const syncInspectionFilters = useRef(vi.fn(() => callLog.push("syncInspectionFilters"))).current;
    return useMapBootstrap({
      mapRef: refs.mapRef,
      airport,
      waypoints: [],
      takeoffCoordinate: null,
      landingCoordinate: null,
      inspectionIndexMap: undefined,
      selectedWaypointId: null,
      flightPlanScope: "FULL",
      terrainMode: "satellite",
      setTerrainMode: vi.fn(),
      layerConfigRef: refs.layerConfigRef,
      focusFeatureRef: refs.focusFeatureRef,
      focusLhaIdsRef: refs.focusLhaIdsRef,
      highlightedIdsRef: refs.highlightedIdsRef,
      highlightSeverityRef: refs.highlightSeverityRef,
      highlightedInspectionIdRef: refs.highlightedInspectionIdRef,
      onMeasureClearRef: refs.onMeasureClearRef,
      onHeadingClearRef: refs.onHeadingClearRef,
      waypointsRef: refs.waypointsRef,
      takeoffRef: refs.takeoffRef,
      landingRef: refs.landingRef,
      indexMapRef: refs.indexMapRef,
      syncLayerVisibility,
      syncInspectionFilters,
      ...overrides,
    });
  });
}

beforeEach(() => {
  callLog.length = 0;
});

describe("useMapBootstrap", () => {
  it("addAllLayers runs adders in the canonical order then syncs highlight", () => {
    const fakeMap = makeFakeMap();
    renderBootstrap(fakeMap);

    // infra-bootstrap effect runs addAllLayers + the waypoint rebuild in order
    const addAllSlice = callLog.slice(
      callLog.indexOf("registerAllMapImages"),
      callLog.indexOf("syncHighlight") + 1,
    );
    expect(addAllSlice).toEqual([
      "registerAllMapImages",
      "addSafetyZoneLayers",
      "addSurfaceLayers",
      "addObstacleLayers",
      "addBufferZoneLayers",
      "addAglLayers",
      "addMeasureLayersToMap",
      "addHeadingLayersToMap",
      "addHighlightLayers",
      "map.addSource",
      "map.addLayer",
      "map.addLayer",
      "map.addLayer",
      "syncHighlight",
    ]);
  });

  it("infra-bootstrap rebuilds waypoint layers and moves vertex-edit overlays last", () => {
    const fakeMap = makeFakeMap();
    renderBootstrap(fakeMap);

    // after adders, the rebuild path removes + re-adds waypoint layers,
    // restores visibility, and moves the vertex-edit overlays last.
    const tail = callLog.slice(callLog.indexOf("syncHighlight"));
    expect(tail).toContain("removeWaypointLayers");
    expect(tail).toContain("removeSimplifiedTrajectoryLayers");
    expect(tail).toContain("addWaypointLayers");
    expect(tail).toContain("addSimplifiedTrajectoryLayers");
    expect(tail).toContain("moveLayer:vertex-edit-corners");
    expect(tail).toContain("moveLayer:vertex-edit-center");

    // registerAllMapImages is called a second time before the waypoint re-add
    const removeIdx = tail.indexOf("removeSimplifiedTrajectoryLayers");
    const addWpIdx = tail.indexOf("addWaypointLayers");
    expect(tail.slice(removeIdx, addWpIdx)).toContain("registerAllMapImages");

    // moveLayer entries come at the very end
    const moveCornersIdx = tail.indexOf("moveLayer:vertex-edit-corners");
    const moveCenterIdx = tail.indexOf("moveLayer:vertex-edit-center");
    expect(moveCornersIdx).toBeGreaterThan(addWpIdx);
    expect(moveCenterIdx).toBeGreaterThan(moveCornersIdx);
  });

  it("waypoint sync effect ends with triggerRepaint", () => {
    const fakeMap = makeFakeMap();
    renderBootstrap(fakeMap);
    expect(callLog).toContain("triggerRepaint");
  });

  it("handleTerrainChange snapshots viewport then restores it after waitForStyleLoaded", () => {
    const fakeMap = makeFakeMap();
    const setTerrainMode = vi.fn();
    const { result } = renderBootstrap(fakeMap, { setTerrainMode });

    callLog.length = 0;
    act(() => {
      result.current.handleTerrainChange("map");
    });

    expect(setTerrainMode).toHaveBeenCalledWith("map");
    expect(callLog).toContain("onMeasureClear");
    expect(callLog).toContain("onHeadingClear");
    expect(callLog).toContain("setStyle");
    expect(callLog).toContain("waitForStyleLoaded");

    // restore happens AFTER the style is loaded
    const styleIdx = callLog.indexOf("waitForStyleLoaded");
    const restore = callLog.slice(styleIdx);
    expect(restore).toEqual(
      expect.arrayContaining(["setCenter", "setZoom", "setBearing", "setPitch", "registerAllMapImages"]),
    );

    // adders re-run after restore (the addAllLayers path)
    expect(restore).toContain("addSafetyZoneLayers");
    expect(restore).toContain("addSurfaceLayers");
    expect(restore).toContain("addHighlightLayers");
  });

  it("flight plan scope FULL hides takeoff/landing layers", () => {
    const fakeMap = makeFakeMap();
    renderBootstrap(fakeMap, { flightPlanScope: "FULL" });
    expect(fakeMap.setLayoutProperty).toHaveBeenCalledWith(
      "waypoint-takeoff-layer",
      "visibility",
      "none",
    );
    expect(fakeMap.setLayoutProperty).toHaveBeenCalledWith(
      "waypoint-landing-layer",
      "visibility",
      "none",
    );
  });

  it("flight plan scope MEASUREMENTS_ONLY hides takeoff/landing layers", () => {
    const fakeMap = makeFakeMap();
    renderBootstrap(fakeMap, { flightPlanScope: "MEASUREMENTS_ONLY" });
    expect(fakeMap.setLayoutProperty).toHaveBeenCalledWith(
      "waypoint-takeoff-layer",
      "visibility",
      "none",
    );
  });
});
