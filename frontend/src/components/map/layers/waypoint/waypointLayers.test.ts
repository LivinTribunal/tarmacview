import { describe, it, expect } from "vitest";
import type { Map as MaplibreMap } from "maplibre-gl";
import type { WaypointResponse } from "@/types/flightPlan";
import type { WaypointType, CameraAction } from "@/types/enums";

import * as barrel from "../waypointLayers";
import * as full from "./waypointFullLayers";
import * as gj from "./waypointFullGeoJSON";
import * as simplified from "./waypointSimplifiedLayers";
import * as shared from "./waypointShared";
import {
  addWaypointLayers,
  removeWaypointLayers,
  WAYPOINT_SOURCE,
} from "./waypointFullLayers";
import {
  waypointsToGeoJSON,
  waypointsToLineGeoJSON,
} from "./waypointFullGeoJSON";
import {
  addSimplifiedTrajectoryLayers,
  removeSimplifiedTrajectoryLayers,
  waypointsToSimplifiedLineGeoJSON,
  waypointsToSimplifiedCornersGeoJSON,
  waypointsToSimplifiedMeasurementGeoJSON,
  waypointsToSimplifiedBookendGeoJSON,
} from "./waypointSimplifiedLayers";
import { TRANSIT_PATH_COLOR, DEFAULT_MEASUREMENT_COLOR } from "./waypointShared";

// minimal waypoint factory
interface WpExtra {
  id?: string;
  sequence_order?: number;
  camera_action?: CameraAction | null;
  camera_target?: WaypointResponse["camera_target"];
}
let seq = 0;
function wp(
  type: WaypointType,
  coords: [number, number, number],
  extra: WpExtra = {},
): WaypointResponse {
  seq += 1;
  return {
    id: extra.id ?? `wp-${seq}`,
    flight_plan_id: "fp-1",
    inspection_id: null,
    sequence_order: extra.sequence_order ?? seq,
    position: { type: "Point", coordinates: coords },
    heading: null,
    speed: null,
    hover_duration: null,
    camera_action: extra.camera_action ?? null,
    waypoint_type: type,
    camera_target: extra.camera_target ?? null,
    gimbal_pitch: null,
  };
}

// fake maplibre map that records source/layer mutations in call order
interface Op {
  op: string;
  id: string;
}
interface LayerSpec {
  id: string;
  type?: string;
  filter?: unknown;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
}
function makeFakeMap() {
  const sources = new Map<string, { setData: (d: unknown) => void }>();
  const layers = new Set<string>();
  const layerSpecs = new Map<string, LayerSpec>();
  const ops: Op[] = [];
  const setDataCalls: string[] = [];

  const map = {
    getSource(id: string) {
      return sources.get(id);
    },
    getLayer(id: string) {
      return layers.has(id) ? { id } : undefined;
    },
    addSource(id: string) {
      sources.set(id, {
        setData: () => {
          setDataCalls.push(id);
        },
      });
      ops.push({ op: "addSource", id });
    },
    addLayer(layer: LayerSpec) {
      layers.add(layer.id);
      layerSpecs.set(layer.id, layer);
      ops.push({ op: "addLayer", id: layer.id });
    },
    removeLayer(id: string) {
      layers.delete(id);
      layerSpecs.delete(id);
      ops.push({ op: "removeLayer", id });
    },
    removeSource(id: string) {
      sources.delete(id);
      ops.push({ op: "removeSource", id });
    },
    setFilter() {},
    setLayoutProperty() {},
    setPaintProperty() {},
  };

  return {
    map: map as unknown as MaplibreMap,
    ops,
    setDataCalls,
    layerSpecs,
    seed(layerIds: string[], sourceIds: string[]) {
      for (const id of layerIds) layers.add(id);
      for (const id of sourceIds)
        sources.set(id, { setData: () => setDataCalls.push(id) });
    },
  };
}

describe("waypointLayers barrel re-export identity", () => {
  it("re-exports every full + geojson + simplified public symbol with referential identity", () => {
    for (const key of Object.keys(full)) {
      expect((barrel as Record<string, unknown>)[key]).toBe(
        (full as Record<string, unknown>)[key],
      );
    }
    for (const key of Object.keys(gj)) {
      expect((barrel as Record<string, unknown>)[key]).toBe(
        (gj as Record<string, unknown>)[key],
      );
    }
    for (const key of Object.keys(simplified)) {
      expect((barrel as Record<string, unknown>)[key]).toBe(
        (simplified as Record<string, unknown>)[key],
      );
    }
  });

  it("keeps the shared colour/key/label helpers private (not on the barrel)", () => {
    for (const key of Object.keys(shared)) {
      expect(barrel).not.toHaveProperty(key);
    }
  });

  it("exports every symbol the 5 importers consume", () => {
    const required = [
      // AirportMap.tsx + hooks
      "addWaypointLayers",
      "removeWaypointLayers",
      "addSimplifiedTrajectoryLayers",
      "removeSimplifiedTrajectoryLayers",
      "updateInspectionHighlightFilter",
      "updateWarningHighlightFilter",
      "updateSelectedFilter",
      "getSimplifiedTrajectoryLayerIds",
      "waypointsToGeoJSON",
      "waypointsToLineGeoJSON",
      "waypointsToSimplifiedLineGeoJSON",
      "waypointsToSimplifiedCornersGeoJSON",
      "WAYPOINT_SOURCE",
      "WAYPOINT_LINE_SOURCE",
      "WAYPOINT_TRANSIT_CIRCLE_LAYER",
      "WAYPOINT_MEASUREMENT_CIRCLE_LAYER",
      "WAYPOINT_LABEL_LAYER",
      "WAYPOINT_LINE_LAYER",
      "WAYPOINT_SELECTED_LAYER",
      "WAYPOINT_TAKEOFF_LAYER",
      "WAYPOINT_LANDING_LAYER",
      "WAYPOINT_HOVER_LAYER",
      "WAYPOINT_RECORDING_BOOKEND_LAYER",
      "WAYPOINT_CAMERA_LINE_LAYER",
      "WAYPOINT_ARROW_LAYER",
      "WAYPOINT_CAMERA_TARGET_LAYER",
      "WAYPOINT_TRANSIT_HIT_LAYER",
      "WAYPOINT_GHOST_TRANSIT_SOURCE",
      "WAYPOINT_WARNING_HIGHLIGHT_LAYER",
      "WAYPOINT_INSPECTION_HIGHLIGHT_LAYER",
      "SIMPLIFIED_LINE_SOURCE",
      "SIMPLIFIED_CORNERS_SOURCE",
      "SIMPLIFIED_TAKEOFF_LAYER",
      "SIMPLIFIED_LANDING_LAYER",
    ];
    for (const name of required) {
      expect((barrel as Record<string, unknown>)[name]).toBeDefined();
    }
  });
});

describe("waypointsToGeoJSON", () => {
  it("collapses a vertical stack of measurements into one feature", () => {
    const fc = waypointsToGeoJSON([
      wp("MEASUREMENT", [14.0, 50.0, 10], { id: "a", sequence_order: 1 }),
      wp("MEASUREMENT", [14.0, 50.0, 20], { id: "b", sequence_order: 2 }),
    ]);
    expect(fc.features).toHaveLength(1);
    const p = fc.features[0].properties!;
    expect(p.stack_count).toBe(2);
    expect(p.id).toBe("a,b");
    expect(p.waypoint_type).toBe("MEASUREMENT");
  });

  it("overrides a flight-plan TAKEOFF position with the mission takeoff coordinate", () => {
    const fc = waypointsToGeoJSON(
      [wp("TAKEOFF", [14.0, 50.0, 0], { id: "t", sequence_order: 1 })],
      { type: "Point", coordinates: [15.0, 51.0, 7] },
    );
    const t = fc.features.find((f) => f.properties?.waypoint_type === "TAKEOFF")!;
    expect((t.geometry as GeoJSON.Point).coordinates).toEqual([15.0, 51.0, 7]);
    expect(t.properties!.altitude).toBe(7);
  });

  it("adds a standalone takeoff feature when no TAKEOFF waypoint exists", () => {
    const fc = waypointsToGeoJSON(
      [wp("MEASUREMENT", [14.0, 50.0, 10], { id: "m", sequence_order: 1 })],
      { type: "Point", coordinates: [15.0, 51.0, 7] },
    );
    expect(fc.features.some((f) => f.properties?.id === "takeoff")).toBe(true);
  });

  it("clears a stale flight-plan TAKEOFF when the mission coordinate is removed", () => {
    const fc = waypointsToGeoJSON([
      wp("TAKEOFF", [14.0, 50.0, 0], { id: "t", sequence_order: 1 }),
      wp("MEASUREMENT", [14.001, 50.001, 10], { id: "m", sequence_order: 2 }),
    ]);
    expect(fc.features.some((f) => f.properties?.waypoint_type === "TAKEOFF")).toBe(
      false,
    );
  });
});

describe("waypointsToLineGeoJSON", () => {
  it("offsets overlapping segments into a 5-point arc", () => {
    const fc = waypointsToLineGeoJSON([
      wp("MEASUREMENT", [14.0, 50.0, 10], { id: "a", sequence_order: 1 }),
      wp("MEASUREMENT", [14.001, 50.001, 10], { id: "b", sequence_order: 2 }),
      wp("MEASUREMENT", [14.0, 50.0, 10], { id: "c", sequence_order: 3 }),
    ]);
    expect(fc.features).toHaveLength(2);
    for (const f of fc.features) {
      expect((f.geometry as GeoJSON.LineString).coordinates).toHaveLength(5);
    }
  });

  it("colors a transit-bound segment with the shared transit color", () => {
    const fc = waypointsToLineGeoJSON([
      wp("MEASUREMENT", [14.0, 50.0, 10], { id: "a", sequence_order: 1 }),
      wp("TRANSIT", [14.002, 50.002, 10], { id: "b", sequence_order: 2 }),
    ]);
    expect(fc.features[0].properties!.color).toBe(TRANSIT_PATH_COLOR);
  });
});

describe("simplified builders", () => {
  it("colors line segments by destination type", () => {
    const fc = waypointsToSimplifiedLineGeoJSON([
      wp("MEASUREMENT", [14.0, 50.0, 10], { id: "a", sequence_order: 1 }),
      wp("MEASUREMENT", [14.001, 50.0, 10], { id: "b", sequence_order: 2 }),
      wp("TRANSIT", [14.002, 50.0, 10], { id: "c", sequence_order: 3 }),
    ]);
    expect(fc.features[0].properties!.color).toBe(DEFAULT_MEASUREMENT_COLOR);
    expect(fc.features[1].properties!.color).toBe(TRANSIT_PATH_COLOR);
    expect(fc.features[0].properties!.fromId).toBe("a");
    expect(fc.features[0].properties!.toId).toBe("b");
  });

  it("emits a corner dot only for transit waypoints", () => {
    const fc = waypointsToSimplifiedCornersGeoJSON([
      wp("MEASUREMENT", [14.0, 50.0, 10], { sequence_order: 1 }),
      wp("TRANSIT", [14.001, 50.0, 10], { sequence_order: 2 }),
    ]);
    expect(fc.features).toHaveLength(1);
  });

  it("emits measurement dots only for vertical stacks", () => {
    const stacked = waypointsToSimplifiedMeasurementGeoJSON([
      wp("MEASUREMENT", [14.0, 50.0, 10], { id: "a", sequence_order: 1 }),
      wp("MEASUREMENT", [14.0, 50.0, 20], { id: "b", sequence_order: 2 }),
    ]);
    expect(stacked.features).toHaveLength(1);
    expect(stacked.features[0].properties!.stack_count).toBe(2);

    const single = waypointsToSimplifiedMeasurementGeoJSON([
      wp("MEASUREMENT", [14.0, 50.0, 10], { sequence_order: 1 }),
    ]);
    expect(single.features).toHaveLength(0);
  });

  it("emits bookend dots for every recording start/stop MEASUREMENT and skips plain ones", () => {
    const fc = waypointsToSimplifiedBookendGeoJSON([
      wp("MEASUREMENT", [14.0, 50.0, 10], {
        id: "start",
        sequence_order: 1,
        camera_action: "RECORDING_START",
      }),
      wp("MEASUREMENT", [14.001, 50.0, 10], { id: "mid", sequence_order: 2 }),
      wp("MEASUREMENT", [14.002, 50.0, 10], {
        id: "stop",
        sequence_order: 3,
        camera_action: "RECORDING_STOP",
      }),
      wp("TRANSIT", [14.003, 50.0, 10], {
        id: "tr",
        sequence_order: 4,
        camera_action: "RECORDING_START",
      }),
    ]);
    expect(fc.features.map((f) => f.properties!.id)).toEqual(["start", "stop"]);
  });
});

describe("addWaypointLayers source/layer ordering", () => {
  it("adds sources then layers in the exact declared order on a fresh map", () => {
    const fake = makeFakeMap();
    addWaypointLayers(fake.map, [
      wp("MEASUREMENT", [14.0, 50.0, 10], { sequence_order: 1 }),
      wp("TRANSIT", [14.001, 50.0, 10], { sequence_order: 2 }),
    ]);
    const trace = fake.ops.map((o) => `${o.op}:${o.id}`);
    expect(trace).toEqual([
      "addSource:waypoints-source",
      "addSource:waypoints-line-source",
      "addSource:waypoints-camera-source",
      "addLayer:waypoints-line",
      "addLayer:waypoints-transit-hit",
      "addSource:waypoints-ghost-transit",
      "addLayer:waypoints-ghost-transit-layer",
      "addLayer:waypoints-arrows",
      "addLayer:waypoints-camera-lines",
      "addSource:waypoints-camera-target-source",
      "addLayer:waypoints-camera-targets",
      "addLayer:waypoints-transit-circles",
      "addLayer:waypoints-measurement-circles",
      "addLayer:waypoints-recording-bookend",
      "addLayer:waypoints-hover",
      "addLayer:waypoints-takeoff",
      "addLayer:waypoints-landing",
      "addLayer:waypoints-labels",
      "addLayer:waypoints-inspection-highlight",
      "addLayer:waypoints-warning-highlight",
      "addLayer:waypoints-selected",
    ]);
  });

  it("takes the update branch (setData, no new layers) when the source exists", () => {
    const fake = makeFakeMap();
    fake.seed(
      [],
      [
        "waypoints-source",
        "waypoints-line-source",
        "waypoints-camera-source",
        "waypoints-camera-target-source",
      ],
    );
    addWaypointLayers(fake.map, [
      wp("MEASUREMENT", [14.0, 50.0, 10], { sequence_order: 1 }),
    ]);
    expect(fake.ops.some((o) => o.op === "addLayer")).toBe(false);
    expect(fake.setDataCalls).toContain("waypoints-source");
  });
});

describe("recording-bookend MEASUREMENT layer", () => {
  it("registers a circle layer with an orange ring filtered to MEASUREMENT + RECORDING_START/STOP camera_action, skipped on stacks", () => {
    const fake = makeFakeMap();
    addWaypointLayers(fake.map, [
      wp("MEASUREMENT", [14.0, 50.0, 10], { sequence_order: 1 }),
    ]);
    const spec = fake.layerSpecs.get("waypoints-recording-bookend");
    expect(spec).toBeDefined();
    expect(spec?.type).toBe("circle");
    // filter must match only non-stacked MEASUREMENT bookends so plain
    // measurements stay visually unchanged and stacked columns don't paint
    // the seam ring on the collapsed representative.
    expect(spec?.filter).toEqual([
      "all",
      ["==", ["get", "waypoint_type"], "MEASUREMENT"],
      ["match", ["get", "camera_action"], ["RECORDING_START", "RECORDING_STOP"], true, false],
      ["<=", ["get", "stack_count"], 1],
    ]);
    // paint matches the 3D HOVER orange so 2D and 3D agree on the bookend hue
    expect(spec?.paint?.["circle-stroke-color"]).toBe("#e5a545");
    expect(spec?.paint?.["circle-color"]).toBe("transparent");
  });
});

describe("waypointsToGeoJSON recording-bookend stack representative", () => {
  it("prefers a recording-bookend MEASUREMENT over a plain MEASUREMENT in a stack so camera_action survives", () => {
    const fc = waypointsToGeoJSON([
      wp("MEASUREMENT", [14.0, 50.0, 10], { id: "plain", sequence_order: 1 }),
      wp("MEASUREMENT", [14.0, 50.0, 20], {
        id: "bookend",
        sequence_order: 2,
        camera_action: "RECORDING_START",
      }),
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties!.camera_action).toBe("RECORDING_START");
  });

  it("emits camera_action on a single recording-bookend MEASUREMENT", () => {
    const fc = waypointsToGeoJSON([
      wp("MEASUREMENT", [14.0, 50.0, 10], {
        id: "bookend",
        sequence_order: 1,
        camera_action: "RECORDING_STOP",
      }),
    ]);
    expect(fc.features[0].properties!.camera_action).toBe("RECORDING_STOP");
  });

  it("preserves the camera_action=NONE default for plain measurements", () => {
    const fc = waypointsToGeoJSON([
      wp("MEASUREMENT", [14.0, 50.0, 10], { id: "plain", sequence_order: 1 }),
    ]);
    expect(fc.features[0].properties!.camera_action).toBe("NONE");
  });
});

describe("removal ordering", () => {
  it("removes full waypoint layers then sources in declared order", () => {
    const fake = makeFakeMap();
    fake.seed(
      [
        "waypoints-ghost-transit-layer",
        "waypoints-selected",
        "waypoints-warning-highlight",
        "waypoints-inspection-highlight",
        "waypoints-labels",
        "waypoints-landing",
        "waypoints-takeoff",
        "waypoints-hover",
        "waypoints-recording-bookend",
        "waypoints-transit-circles",
        "waypoints-measurement-circles",
        "waypoints-camera-targets",
        "waypoints-camera-lines",
        "waypoints-arrows",
        "waypoints-transit-hit",
        "waypoints-line",
      ],
      [
        "waypoints-ghost-transit",
        "waypoints-source",
        "waypoints-line-source",
        "waypoints-camera-source",
        "waypoints-camera-target-source",
      ],
    );
    removeWaypointLayers(fake.map);
    expect(fake.ops.map((o) => `${o.op}:${o.id}`)).toEqual([
      "removeLayer:waypoints-ghost-transit-layer",
      "removeLayer:waypoints-selected",
      "removeLayer:waypoints-warning-highlight",
      "removeLayer:waypoints-inspection-highlight",
      "removeLayer:waypoints-labels",
      "removeLayer:waypoints-landing",
      "removeLayer:waypoints-takeoff",
      "removeLayer:waypoints-hover",
      "removeLayer:waypoints-recording-bookend",
      "removeLayer:waypoints-transit-circles",
      "removeLayer:waypoints-measurement-circles",
      "removeLayer:waypoints-camera-targets",
      "removeLayer:waypoints-camera-lines",
      "removeLayer:waypoints-arrows",
      "removeLayer:waypoints-transit-hit",
      "removeLayer:waypoints-line",
      "removeSource:waypoints-ghost-transit",
      "removeSource:waypoints-source",
      "removeSource:waypoints-line-source",
      "removeSource:waypoints-camera-source",
      "removeSource:waypoints-camera-target-source",
    ]);
  });

  it("adds then removes simplified layers in declared order", () => {
    const fake = makeFakeMap();
    addSimplifiedTrajectoryLayers(fake.map, [
      wp("MEASUREMENT", [14.0, 50.0, 10], { sequence_order: 1 }),
      wp("TRANSIT", [14.001, 50.0, 10], { sequence_order: 2 }),
    ]);
    expect(fake.ops.map((o) => `${o.op}:${o.id}`)).toEqual([
      "addSource:simplified-trajectory-source",
      "addSource:simplified-corners-source",
      "addSource:simplified-measurement-source",
      "addSource:simplified-bookend-source",
      "addSource:simplified-takeoff-source",
      "addSource:simplified-landing-source",
      "addLayer:simplified-trajectory-line",
      "addLayer:simplified-warning-highlight",
      "addLayer:simplified-corners",
      "addLayer:simplified-measurement-dots",
      "addLayer:simplified-bookend-dots",
      "addLayer:simplified-takeoff",
      "addLayer:simplified-landing",
    ]);

    fake.ops.length = 0;
    removeSimplifiedTrajectoryLayers(fake.map);
    expect(fake.ops.map((o) => `${o.op}:${o.id}`)).toEqual([
      "removeLayer:simplified-landing",
      "removeLayer:simplified-takeoff",
      "removeLayer:simplified-bookend-dots",
      "removeLayer:simplified-measurement-dots",
      "removeLayer:simplified-corners",
      "removeLayer:simplified-warning-highlight",
      "removeLayer:simplified-trajectory-line",
      "removeSource:simplified-landing-source",
      "removeSource:simplified-takeoff-source",
      "removeSource:simplified-bookend-source",
      "removeSource:simplified-measurement-source",
      "removeSource:simplified-corners-source",
      "removeSource:simplified-trajectory-source",
    ]);
  });
});

// referenced so the WAYPOINT_SOURCE import stays meaningful in the suite
describe("constant identity", () => {
  it("WAYPOINT_SOURCE is stable through the barrel", () => {
    expect(barrel.WAYPOINT_SOURCE).toBe(WAYPOINT_SOURCE);
  });
});
