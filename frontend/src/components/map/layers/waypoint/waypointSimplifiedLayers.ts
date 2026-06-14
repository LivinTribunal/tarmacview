import type maplibregl from "maplibre-gl";
import type { Map as MaplibreMap } from "maplibre-gl";
import type { WaypointResponse } from "@/types/flightPlan";
import type { PointZ } from "@/types/common";
import { TRANSIT_PATH_COLOR, DEFAULT_MEASUREMENT_COLOR, coordKey } from "./waypointShared";

export const SIMPLIFIED_LINE_SOURCE = "simplified-trajectory-source";
export const SIMPLIFIED_LINE_LAYER = "simplified-trajectory-line";
export const SIMPLIFIED_TAKEOFF_SOURCE = "simplified-takeoff-source";
export const SIMPLIFIED_LANDING_SOURCE = "simplified-landing-source";
export const SIMPLIFIED_TAKEOFF_LAYER = "simplified-takeoff";
export const SIMPLIFIED_LANDING_LAYER = "simplified-landing";
export const SIMPLIFIED_CORNERS_SOURCE = "simplified-corners-source";
export const SIMPLIFIED_MEASUREMENT_SOURCE = "simplified-measurement-source";
export const SIMPLIFIED_MEASUREMENT_LAYER = "simplified-measurement-dots";
export const SIMPLIFIED_CORNERS_LAYER = "simplified-corners";
export const SIMPLIFIED_BOOKEND_SOURCE = "simplified-bookend-source";
export const SIMPLIFIED_BOOKEND_LAYER = "simplified-bookend-dots";
export const SIMPLIFIED_WARNING_HIGHLIGHT_LAYER = "simplified-warning-highlight";

/** returns simplified trajectory layer ids for layer group mapping. */
export function getSimplifiedTrajectoryLayerIds(): string[] {
  return [
    SIMPLIFIED_LINE_LAYER,
    SIMPLIFIED_WARNING_HIGHLIGHT_LAYER,
    SIMPLIFIED_CORNERS_LAYER,
    SIMPLIFIED_MEASUREMENT_LAYER,
    SIMPLIFIED_BOOKEND_LAYER,
    SIMPLIFIED_TAKEOFF_LAYER,
    SIMPLIFIED_LANDING_LAYER,
  ];
}

/** builds a simplified polyline from waypoints - no dots, just colored path segments. */
export function waypointsToSimplifiedLineGeoJSON(
  waypoints: WaypointResponse[],
): GeoJSON.FeatureCollection {
  const sorted = waypoints.slice().sort(
    (a, b) => a.sequence_order - b.sequence_order,
  );
  if (sorted.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }

  const SIMPLIFIED_TRANSIT_COLOR = TRANSIT_PATH_COLOR;
  const features: GeoJSON.Feature[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    const toType = to.waypoint_type;

    const color =
      toType === "TRANSIT" || toType === "TAKEOFF" || toType === "LANDING"
        ? SIMPLIFIED_TRANSIT_COLOR
        : DEFAULT_MEASUREMENT_COLOR;

    features.push({
      type: "Feature",
      properties: { color, fromId: from.id, toId: to.id },
      geometry: {
        type: "LineString",
        coordinates: [from.position.coordinates, to.position.coordinates],
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/** builds dots for every transit waypoint in the simplified trajectory. */
export function waypointsToSimplifiedCornersGeoJSON(
  waypoints: WaypointResponse[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const wp of waypoints) {
    if (wp.waypoint_type !== "TRANSIT") continue;
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: wp.position.coordinates },
    });
  }
  return { type: "FeatureCollection", features };
}

/** builds recording-bookend dots for the simplified trajectory - first/last
 * MEASUREMENT of each video pass after #754. these aren't TRANSIT corners and
 * (usually) aren't stacked, so without this builder they fall through both the
 * corner-dot and vertical-stack layers and the recording seam disappears from
 * the simplified view. */
export function waypointsToSimplifiedBookendGeoJSON(
  waypoints: WaypointResponse[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const wp of waypoints) {
    if (wp.waypoint_type !== "MEASUREMENT") continue;
    if (wp.camera_action !== "RECORDING_START" && wp.camera_action !== "RECORDING_STOP") continue;
    features.push({
      type: "Feature",
      properties: {
        id: wp.id,
        sequence_order: wp.sequence_order,
        camera_action: wp.camera_action,
      },
      geometry: { type: "Point", coordinates: wp.position.coordinates },
    });
  }
  return { type: "FeatureCollection", features };
}

/** builds measurement position dots for simplified trajectory - only vertical stacks. */
export function waypointsToSimplifiedMeasurementGeoJSON(
  waypoints: WaypointResponse[],
): GeoJSON.FeatureCollection {
  // group measurement/hover waypoints by ground position to find vertical stacks
  const groups = new Map<string, WaypointResponse[]>();

  for (const wp of waypoints) {
    if (wp.waypoint_type !== "MEASUREMENT" && wp.waypoint_type !== "HOVER") continue;
    const key = coordKey(wp.position.coordinates[0], wp.position.coordinates[1]);
    const entry = groups.get(key);
    if (entry) entry.push(wp);
    else groups.set(key, [wp]);
  }

  // only show dots for stacked positions (vertical profiles, count > 1)
  const features: GeoJSON.Feature[] = [];
  for (const wps of groups.values()) {
    if (wps.length <= 1) continue;
    const sorted = wps.slice().sort((a, b) => a.sequence_order - b.sequence_order);
    const first = sorted[0];
    const alts = sorted.map((w) => w.position.coordinates[2] ?? 0);
    const seqs = sorted.map((w) => w.sequence_order);
    features.push({
      type: "Feature",
      properties: {
        id: sorted.map((w) => w.id).join(","),
        waypoint_type: first.waypoint_type,
        sequence_order: first.sequence_order,
        stack_count: sorted.length,
        seq_min: Math.min(...seqs),
        seq_max: Math.max(...seqs),
        alt_min: Math.min(...alts),
        alt_max: Math.max(...alts),
        altitude: first.position.coordinates[2] ?? 0,
      },
      geometry: { type: "Point", coordinates: first.position.coordinates },
    });
  }

  return { type: "FeatureCollection", features };
}

/** adds simplified trajectory layers - polyline only with takeoff/landing markers. */
export function addSimplifiedTrajectoryLayers(
  map: MaplibreMap,
  waypoints: WaypointResponse[],
  takeoff?: PointZ | null,
  landing?: PointZ | null,
): void {
  if (waypoints.length === 0 && !takeoff && !landing) {
    removeSimplifiedTrajectoryLayers(map);
    return;
  }

  const lineData = waypointsToSimplifiedLineGeoJSON(waypoints);
  const cornersData = waypointsToSimplifiedCornersGeoJSON(waypoints);
  const measurementData = waypointsToSimplifiedMeasurementGeoJSON(waypoints);
  const bookendData = waypointsToSimplifiedBookendGeoJSON(waypoints);

  // find takeoff/landing from waypoints if not provided
  const sorted = waypoints.slice().sort(
    (a, b) => a.sequence_order - b.sequence_order,
  );
  const takeoffWp = sorted.find((w) => w.waypoint_type === "TAKEOFF");
  const landingWp = [...sorted].reverse().find((w: WaypointResponse) => w.waypoint_type === "LANDING");

  const takeoffCoords = takeoff?.coordinates ?? takeoffWp?.position.coordinates;
  const landingCoords = landing?.coordinates ?? landingWp?.position.coordinates;

  const takeoffData: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: takeoffCoords
      ? [
          {
            type: "Feature",
            properties: {
              id: takeoffWp?.id ?? "takeoff",
              sequence_order: takeoffWp?.sequence_order ?? 0,
              waypoint_type: "TAKEOFF",
              camera_action: "NONE",
              color: "#4595e5",
              stack_count: 1,
              altitude: takeoffCoords[2] ?? 0,
            },
            geometry: { type: "Point", coordinates: takeoffCoords },
          },
        ]
      : [],
  };

  const landingData: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: landingCoords
      ? [
          {
            type: "Feature",
            properties: {
              id: landingWp?.id ?? "landing",
              sequence_order: landingWp?.sequence_order ?? 0,
              waypoint_type: "LANDING",
              camera_action: "NONE",
              color: "#e54545",
              stack_count: 1,
              altitude: landingCoords[2] ?? 0,
            },
            geometry: { type: "Point", coordinates: landingCoords },
          },
        ]
      : [],
  };

  // update existing sources if present
  const existingLineSrc = map.getSource(SIMPLIFIED_LINE_SOURCE) as
    | maplibregl.GeoJSONSource
    | undefined;
  if (existingLineSrc) {
    existingLineSrc.setData(lineData);
    const tkSrc = map.getSource(SIMPLIFIED_TAKEOFF_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (tkSrc) tkSrc.setData(takeoffData);
    const ldSrc = map.getSource(SIMPLIFIED_LANDING_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (ldSrc) ldSrc.setData(landingData);
    const cornerSrc = map.getSource(SIMPLIFIED_CORNERS_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (cornerSrc) cornerSrc.setData(cornersData);
    const measSrc = map.getSource(SIMPLIFIED_MEASUREMENT_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (measSrc) measSrc.setData(measurementData);
    const bookendSrc = map.getSource(SIMPLIFIED_BOOKEND_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (bookendSrc) bookendSrc.setData(bookendData);
    return;
  }

  // ensure clean slate before creating
  removeSimplifiedTrajectoryLayers(map);

  // add sources
  map.addSource(SIMPLIFIED_LINE_SOURCE, { type: "geojson", data: lineData });
  map.addSource(SIMPLIFIED_CORNERS_SOURCE, { type: "geojson", data: cornersData });
  map.addSource(SIMPLIFIED_MEASUREMENT_SOURCE, { type: "geojson", data: measurementData });
  map.addSource(SIMPLIFIED_BOOKEND_SOURCE, { type: "geojson", data: bookendData });
  map.addSource(SIMPLIFIED_TAKEOFF_SOURCE, { type: "geojson", data: takeoffData });
  map.addSource(SIMPLIFIED_LANDING_SOURCE, { type: "geojson", data: landingData });

  // polyline path
  map.addLayer({
    id: SIMPLIFIED_LINE_LAYER,
    type: "line",
    source: SIMPLIFIED_LINE_SOURCE,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 5,
      "line-opacity": 0.9,
    },
  });

  // warning highlight overlay on simplified line segments
  map.addLayer({
    id: SIMPLIFIED_WARNING_HIGHLIGHT_LAYER,
    type: "line",
    source: SIMPLIFIED_LINE_SOURCE,
    filter: ["==", ["get", "fromId"], ""],
    paint: {
      "line-color": "#e54545",
      "line-width": 7,
      "line-opacity": 0.9,
    },
  });

  // corner dots where path changes direction
  map.addLayer({
    id: SIMPLIFIED_CORNERS_LAYER,
    type: "circle",
    source: SIMPLIFIED_CORNERS_SOURCE,
    paint: {
      "circle-radius": 4,
      "circle-color": "#000000",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1,
      "circle-opacity": 0.8,
    },
  });

  // measurement position dots
  map.addLayer({
    id: SIMPLIFIED_MEASUREMENT_LAYER,
    type: "circle",
    source: SIMPLIFIED_MEASUREMENT_SOURCE,
    paint: {
      "circle-radius": 6,
      "circle-color": DEFAULT_MEASUREMENT_COLOR,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
      "circle-opacity": 0.9,
    },
  });

  // recording-bookend dots - first/last MEASUREMENT of a video pass. uses the
  // shared measurement color so the simplified view reads as "these are
  // measurement waypoints" rather than borrowing the 3D bookend orange (which
  // belongs to the full-trajectory view's seam-ring affordance).
  map.addLayer({
    id: SIMPLIFIED_BOOKEND_LAYER,
    type: "circle",
    source: SIMPLIFIED_BOOKEND_SOURCE,
    paint: {
      "circle-radius": 6,
      "circle-color": DEFAULT_MEASUREMENT_COLOR,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.5,
      "circle-opacity": 0.95,
    },
  });

  // takeoff marker
  map.addLayer({
    id: SIMPLIFIED_TAKEOFF_LAYER,
    type: "symbol",
    source: SIMPLIFIED_TAKEOFF_SOURCE,
    layout: {
      "icon-image": "takeoff-square",
      "icon-size": 1.5,
      "icon-allow-overlap": true,
    },
  });

  // landing marker
  map.addLayer({
    id: SIMPLIFIED_LANDING_LAYER,
    type: "symbol",
    source: SIMPLIFIED_LANDING_SOURCE,
    layout: {
      "icon-image": "landing-square",
      "icon-size": 1.5,
      "icon-allow-overlap": true,
    },
  });
}

/** removes simplified trajectory layers and sources. */
export function removeSimplifiedTrajectoryLayers(map: MaplibreMap): void {
  const layers = [
    SIMPLIFIED_LANDING_LAYER,
    SIMPLIFIED_TAKEOFF_LAYER,
    SIMPLIFIED_BOOKEND_LAYER,
    SIMPLIFIED_MEASUREMENT_LAYER,
    SIMPLIFIED_CORNERS_LAYER,
    SIMPLIFIED_WARNING_HIGHLIGHT_LAYER,
    SIMPLIFIED_LINE_LAYER,
  ];
  const sources = [
    SIMPLIFIED_LANDING_SOURCE,
    SIMPLIFIED_TAKEOFF_SOURCE,
    SIMPLIFIED_BOOKEND_SOURCE,
    SIMPLIFIED_MEASUREMENT_SOURCE,
    SIMPLIFIED_CORNERS_SOURCE,
    SIMPLIFIED_LINE_SOURCE,
  ];

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
