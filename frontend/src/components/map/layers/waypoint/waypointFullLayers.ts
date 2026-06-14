import type maplibregl from "maplibre-gl";
import type { Map as MaplibreMap } from "maplibre-gl";
import type { WaypointResponse } from "@/types/flightPlan";
import type { PointZ } from "@/types/common";
import { INSPECTION_HIGHLIGHT_COLOR } from "@/constants/palette";
import { TRANSIT_PATH_COLOR } from "./waypointShared";
import {
  waypointsToGeoJSON,
  waypointsToLineGeoJSON,
  waypointsToCameraLineGeoJSON,
  waypointsToCameraTargetGeoJSON,
} from "./waypointFullGeoJSON";
import { SIMPLIFIED_WARNING_HIGHLIGHT_LAYER } from "./waypointSimplifiedLayers";

export const WAYPOINT_SOURCE = "waypoints-source";
export const WAYPOINT_LINE_SOURCE = "waypoints-line-source";
export const WAYPOINT_TRANSIT_CIRCLE_LAYER = "waypoints-transit-circles";
export const WAYPOINT_MEASUREMENT_CIRCLE_LAYER = "waypoints-measurement-circles";
export const WAYPOINT_LABEL_LAYER = "waypoints-labels";
export const WAYPOINT_LINE_LAYER = "waypoints-line";
export const WAYPOINT_SELECTED_LAYER = "waypoints-selected";
export const WAYPOINT_TAKEOFF_LAYER = "waypoints-takeoff";
export const WAYPOINT_LANDING_LAYER = "waypoints-landing";
export const WAYPOINT_HOVER_LAYER = "waypoints-hover";
export const WAYPOINT_RECORDING_BOOKEND_LAYER = "waypoints-recording-bookend";
export const WAYPOINT_CAMERA_LINE_LAYER = "waypoints-camera-lines";
export const WAYPOINT_ARROW_LAYER = "waypoints-arrows";
export const WAYPOINT_CAMERA_TARGET_LAYER = "waypoints-camera-targets";
export const WAYPOINT_TRANSIT_HIT_LAYER = "waypoints-transit-hit";
export const WAYPOINT_GHOST_TRANSIT_SOURCE = "waypoints-ghost-transit";
export const WAYPOINT_GHOST_TRANSIT_LAYER = "waypoints-ghost-transit-layer";
export const WAYPOINT_WARNING_HIGHLIGHT_LAYER = "waypoints-warning-highlight";
export const WAYPOINT_INSPECTION_HIGHLIGHT_LAYER = "waypoints-inspection-highlight";

/** adds all waypoint layers to the map. */
export function addWaypointLayers(
  map: MaplibreMap,
  waypoints: WaypointResponse[],
  takeoff?: PointZ | null,
  landing?: PointZ | null,
  selectedWaypointId?: string | null,
  inspectionIndexMap?: Record<string, number>,
): void {
  const hasAny = waypoints.length > 0 || takeoff || landing;

  if (!hasAny) {
    removeWaypointLayers(map);
    return;
  }

  const pointData = waypointsToGeoJSON(waypoints, takeoff, landing, inspectionIndexMap);
  const lineData = waypointsToLineGeoJSON(waypoints);
  const cameraData = waypointsToCameraLineGeoJSON(waypoints);
  const cameraTargetData = waypointsToCameraTargetGeoJSON(waypoints);

  // update existing sources if present, otherwise clean up and recreate
  const existingSource = map.getSource(WAYPOINT_SOURCE) as
    | maplibregl.GeoJSONSource
    | undefined;
  if (existingSource) {
    existingSource.setData(pointData);
    const lineSrc = map.getSource(WAYPOINT_LINE_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (lineSrc) lineSrc.setData(lineData);
    const cameraSrc = map.getSource("waypoints-camera-source") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (cameraSrc) cameraSrc.setData(cameraData);
    const cameraTargetSrc = map.getSource("waypoints-camera-target-source") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (cameraTargetSrc) cameraTargetSrc.setData(cameraTargetData);

    // update selected waypoint filter
    updateSelectedFilter(map, selectedWaypointId);
    return;
  }

  // ensure clean slate before creating - remove any stale partial state
  removeWaypointLayers(map);

  // add sources
  map.addSource(WAYPOINT_SOURCE, { type: "geojson", data: pointData });
  map.addSource(WAYPOINT_LINE_SOURCE, { type: "geojson", data: lineData });
  map.addSource("waypoints-camera-source", { type: "geojson", data: cameraData });

  // connecting lines - colored by segment type and phase
  map.addLayer({
    id: WAYPOINT_LINE_LAYER,
    type: "line",
    source: WAYPOINT_LINE_SOURCE,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 3,
      "line-opacity": 0.9,
    },
  });

  // transparent hit area for transit path insertion
  map.addLayer({
    id: WAYPOINT_TRANSIT_HIT_LAYER,
    type: "line",
    source: WAYPOINT_LINE_SOURCE,
    filter: ["==", ["get", "color"], TRANSIT_PATH_COLOR],
    paint: {
      "line-color": TRANSIT_PATH_COLOR,
      "line-width": 14,
      "line-opacity": 0,
    },
  });

  // ghost transit waypoint preview
  if (!map.getSource(WAYPOINT_GHOST_TRANSIT_SOURCE)) {
    map.addSource(WAYPOINT_GHOST_TRANSIT_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: WAYPOINT_GHOST_TRANSIT_LAYER,
      type: "circle",
      source: WAYPOINT_GHOST_TRANSIT_SOURCE,
      paint: {
        "circle-radius": 6,
        "circle-color": TRANSIT_PATH_COLOR,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
        "circle-opacity": 0.6,
        "circle-stroke-opacity": 0.6,
      },
    });
  }

  // direction arrows along path segments
  map.addLayer({
    id: WAYPOINT_ARROW_LAYER,
    type: "symbol",
    source: WAYPOINT_LINE_SOURCE,
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 80,
      "icon-image": "path-arrow",
      "icon-size": 0.6,
      "icon-allow-overlap": true,
      "icon-rotation-alignment": "map",
    },
    paint: {
      "icon-opacity": 0.85,
    },
  });

  // camera direction lines
  map.addLayer({
    id: WAYPOINT_CAMERA_LINE_LAYER,
    type: "line",
    source: "waypoints-camera-source",
    paint: {
      "line-color": "#ffffff",
      "line-width": 1,
      "line-opacity": 0.4,
      "line-dasharray": [3, 3],
    },
  });

  // camera target points
  map.addSource("waypoints-camera-target-source", { type: "geojson", data: cameraTargetData });
  map.addLayer({
    id: WAYPOINT_CAMERA_TARGET_LAYER,
    type: "circle",
    source: "waypoints-camera-target-source",
    paint: {
      "circle-radius": 5,
      "circle-color": "#ffffff",
      "circle-stroke-color": "#e5a545",
      "circle-stroke-width": 2,
      "circle-opacity": 0.8,
    },
  });

  // transit waypoint circles
  map.addLayer({
    id: WAYPOINT_TRANSIT_CIRCLE_LAYER,
    type: "circle",
    source: WAYPOINT_SOURCE,
    filter: ["==", ["get", "waypoint_type"], "TRANSIT"],
    paint: {
      "circle-radius": ["case", [">", ["get", "stack_count"], 1], 13, 8],
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#6b6b6b",
      "circle-stroke-width": ["case", [">", ["get", "stack_count"], 1], 2, 1.5],
    },
  });

  // measurement waypoint circles
  map.addLayer({
    id: WAYPOINT_MEASUREMENT_CIRCLE_LAYER,
    type: "circle",
    source: WAYPOINT_SOURCE,
    filter: ["==", ["get", "waypoint_type"], "MEASUREMENT"],
    paint: {
      "circle-radius": ["case", [">", ["get", "stack_count"], 1], 13, 10],
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": ["case", [">", ["get", "stack_count"], 1], 2, 1.5],
    },
  });

  // recording-bookend measurements - first/last MEASUREMENT of a video pass
  // carries the recording start/stop dwell. paint an orange ring (matching the
  // 3D bookend color) around the measurement circle so the inspection-number
  // label stays unobstructed but the operator can still spot the seam. skipped
  // for stacks (vertical profile) - the collapsed dot would inherit the ring
  // and falsely flag every stacked column as a bookend.
  map.addLayer({
    id: WAYPOINT_RECORDING_BOOKEND_LAYER,
    type: "circle",
    source: WAYPOINT_SOURCE,
    filter: [
      "all",
      ["==", ["get", "waypoint_type"], "MEASUREMENT"],
      ["match", ["get", "camera_action"], ["RECORDING_START", "RECORDING_STOP"], true, false],
      ["<=", ["get", "stack_count"], 1],
    ],
    paint: {
      "circle-radius": 13,
      "circle-color": "transparent",
      "circle-stroke-color": "#e5a545",
      "circle-stroke-width": 2.5,
      "circle-stroke-opacity": 0.95,
    },
  });

  // hover waypoints - icon varies by camera action
  map.addLayer({
    id: WAYPOINT_HOVER_LAYER,
    type: "symbol",
    source: WAYPOINT_SOURCE,
    filter: ["==", ["get", "waypoint_type"], "HOVER"],
    layout: {
      "icon-image": [
        "match",
        ["get", "camera_action"],
        "RECORDING_START", "recording-start-icon",
        "RECORDING_STOP", "recording-stop-icon",
        "hover-icon",
      ],
      "icon-size": 1,
      "icon-allow-overlap": true,
    },
  });

  // takeoff marker
  map.addLayer({
    id: WAYPOINT_TAKEOFF_LAYER,
    type: "symbol",
    source: WAYPOINT_SOURCE,
    filter: ["==", ["get", "waypoint_type"], "TAKEOFF"],
    layout: {
      "icon-image": "takeoff-square",
      "icon-size": 1.5,
      "icon-allow-overlap": true,
    },
  });

  // landing marker
  map.addLayer({
    id: WAYPOINT_LANDING_LAYER,
    type: "symbol",
    source: WAYPOINT_SOURCE,
    filter: ["==", ["get", "waypoint_type"], "LANDING"],
    layout: {
      "icon-image": "landing-square",
      "icon-size": 1.5,
      "icon-allow-overlap": true,
    },
  });

  // inspection number labels - measurement waypoints only
  map.addLayer({
    id: WAYPOINT_LABEL_LAYER,
    type: "symbol",
    source: WAYPOINT_SOURCE,
    filter: ["==", ["get", "waypoint_type"], "MEASUREMENT"],
    layout: {
      "text-field": ["get", "label"],
      "text-size": 10,
      "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": "#ffffff",
    },
  });

  // inspection highlight ring - blue ring around the selected inspection's measurement waypoints
  map.addLayer({
    id: WAYPOINT_INSPECTION_HIGHLIGHT_LAYER,
    type: "circle",
    source: WAYPOINT_SOURCE,
    filter: [
      "all",
      ["==", ["get", "waypoint_type"], "MEASUREMENT"],
      ["==", ["get", "inspection_id"], ""],
    ],
    paint: {
      "circle-radius": 18,
      "circle-color": "transparent",
      "circle-stroke-color": INSPECTION_HIGHLIGHT_COLOR,
      "circle-stroke-width": 2.5,
      "circle-stroke-opacity": 0.85,
    },
  });

  // warning highlight ring - between base layers and selected
  map.addLayer({
    id: WAYPOINT_WARNING_HIGHLIGHT_LAYER,
    type: "circle",
    source: WAYPOINT_SOURCE,
    filter: ["==", ["get", "id"], ""],
    paint: {
      "circle-radius": 16,
      "circle-color": "transparent",
      "circle-stroke-color": "#e54545",
      "circle-stroke-width": 3,
      "circle-stroke-opacity": 0.9,
    },
  });

  // selected waypoint highlight ring
  // uses "in" operator so a single UUID matches comma-joined stacked IDs
  map.addLayer({
    id: WAYPOINT_SELECTED_LAYER,
    type: "circle",
    source: WAYPOINT_SOURCE,
    filter: selectedWaypointId
      ? ["in", selectedWaypointId, ["get", "id"]]
      : ["==", ["get", "id"], ""],
    paint: {
      "circle-radius": 16,
      "circle-color": "transparent",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 3.5,
      "circle-stroke-opacity": 0.9,
    },
  });
}

/** updates the selected waypoint filter. */
export function updateSelectedFilter(
  map: MaplibreMap,
  selectedWaypointId?: string | null,
): void {
  try {
    if (map.getLayer(WAYPOINT_SELECTED_LAYER)) {
      map.setFilter(
        WAYPOINT_SELECTED_LAYER,
        selectedWaypointId
          ? ["in", selectedWaypointId, ["get", "id"]]
          : ["==", ["get", "id"], ""],
      );
    }
  } catch {
    // layer may not exist
  }
}

/** severity color map for warning highlights. */
const SEVERITY_COLORS: Record<string, string> = {
  violation: "#e54545",
  warning: "#e5a545",
  suggestion: "#9ca3af",
};

/** highlights the selected inspection's measurement waypoints with a blue ring; pass null to clear. */
export function updateInspectionHighlightFilter(
  map: MaplibreMap,
  inspectionId?: string | null,
): void {
  try {
    if (map.getLayer(WAYPOINT_INSPECTION_HIGHLIGHT_LAYER)) {
      map.setFilter(WAYPOINT_INSPECTION_HIGHLIGHT_LAYER, [
        "all",
        ["==", ["get", "waypoint_type"], "MEASUREMENT"],
        ["==", ["get", "inspection_id"], inspectionId ?? ""],
      ]);
    }
  } catch {
    // layer may not exist
  }
}

/** updates the warning highlight filter and color for both full and simplified layers. */
export function updateWarningHighlightFilter(
  map: MaplibreMap,
  waypointIds?: string[],
  severity?: string,
  simplified?: boolean,
): void {
  const color = SEVERITY_COLORS[severity ?? "warning"] ?? SEVERITY_COLORS.warning;

  try {
    // circle highlights - hidden entirely in simplified mode
    if (map.getLayer(WAYPOINT_WARNING_HIGHLIGHT_LAYER)) {
      if (simplified) {
        map.setLayoutProperty(WAYPOINT_WARNING_HIGHLIGHT_LAYER, "visibility", "none");
      } else if (!waypointIds || waypointIds.length === 0) {
        map.setLayoutProperty(WAYPOINT_WARNING_HIGHLIGHT_LAYER, "visibility", "visible");
        map.setFilter(WAYPOINT_WARNING_HIGHLIGHT_LAYER, ["==", ["get", "id"], ""]);
      } else {
        map.setLayoutProperty(WAYPOINT_WARNING_HIGHLIGHT_LAYER, "visibility", "visible");
        map.setFilter(WAYPOINT_WARNING_HIGHLIGHT_LAYER, [
          "in",
          ["get", "id"],
          ["literal", waypointIds],
        ]);
        map.setPaintProperty(WAYPOINT_WARNING_HIGHLIGHT_LAYER, "circle-stroke-color", color);
      }
    }
  } catch {
    // layer may not exist
  }

  try {
    // simplified trajectory line highlight
    if (map.getLayer(SIMPLIFIED_WARNING_HIGHLIGHT_LAYER)) {
      if (!waypointIds || waypointIds.length === 0) {
        map.setFilter(SIMPLIFIED_WARNING_HIGHLIGHT_LAYER, ["==", ["get", "fromId"], ""]);
      } else {
        // both endpoints must be affected to highlight the segment
        map.setFilter(SIMPLIFIED_WARNING_HIGHLIGHT_LAYER, [
          "all",
          ["in", ["get", "fromId"], ["literal", waypointIds]],
          ["in", ["get", "toId"], ["literal", waypointIds]],
        ]);
        map.setPaintProperty(SIMPLIFIED_WARNING_HIGHLIGHT_LAYER, "line-color", color);
      }
    }
  } catch {
    // layer may not exist
  }
}

/** removes all waypoint layers and sources. */
export function removeWaypointLayers(map: MaplibreMap): void {
  const layers = [
    WAYPOINT_GHOST_TRANSIT_LAYER,
    WAYPOINT_SELECTED_LAYER,
    WAYPOINT_WARNING_HIGHLIGHT_LAYER,
    WAYPOINT_INSPECTION_HIGHLIGHT_LAYER,
    WAYPOINT_LABEL_LAYER,
    WAYPOINT_LANDING_LAYER,
    WAYPOINT_TAKEOFF_LAYER,
    WAYPOINT_HOVER_LAYER,
    WAYPOINT_RECORDING_BOOKEND_LAYER,
    WAYPOINT_TRANSIT_CIRCLE_LAYER,
    WAYPOINT_MEASUREMENT_CIRCLE_LAYER,
    WAYPOINT_CAMERA_TARGET_LAYER,
    WAYPOINT_CAMERA_LINE_LAYER,
    WAYPOINT_ARROW_LAYER,
    WAYPOINT_TRANSIT_HIT_LAYER,
    WAYPOINT_LINE_LAYER,
  ];
  const sources = [WAYPOINT_GHOST_TRANSIT_SOURCE, WAYPOINT_SOURCE, WAYPOINT_LINE_SOURCE, "waypoints-camera-source", "waypoints-camera-target-source"];

  try {
    for (const id of layers) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of sources) {
      if (map.getSource(id)) map.removeSource(id);
    }
  } catch {
    // layers may not exist
  }
}

/** returns all waypoint layer ids for layer group mapping. */
export function getWaypointLayerIds(): string[] {
  return [
    WAYPOINT_LINE_LAYER,
    WAYPOINT_ARROW_LAYER,
    WAYPOINT_CAMERA_LINE_LAYER,
    WAYPOINT_TRANSIT_CIRCLE_LAYER,
    WAYPOINT_MEASUREMENT_CIRCLE_LAYER,
    WAYPOINT_RECORDING_BOOKEND_LAYER,
    WAYPOINT_HOVER_LAYER,
    WAYPOINT_TAKEOFF_LAYER,
    WAYPOINT_LANDING_LAYER,
    WAYPOINT_LABEL_LAYER,
    WAYPOINT_WARNING_HIGHLIGHT_LAYER,
    WAYPOINT_SELECTED_LAYER,
  ];
}
