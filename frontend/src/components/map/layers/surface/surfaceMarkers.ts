import type { Map as MaplibreMap } from "maplibre-gl";
import type { SurfaceResponse } from "@/types/airport";

export const TOUCHPOINT_SOURCE = "runway-touchpoints";
export const TOUCHPOINT_MARKER_LAYER = "runway-touchpoints-marker";
export const TOUCHPOINT_LABEL_LAYER = "runway-touchpoints-label";
export const THRESHOLD_SOURCE = "runway-thresholds";
export const THRESHOLD_MARKER_LAYER = "runway-thresholds-marker";
export const THRESHOLD_LABEL_LAYER = "runway-thresholds-label";
export const END_POSITION_SOURCE = "runway-end-positions";
export const END_POSITION_MARKER_LAYER = "runway-end-positions-marker";
export const END_POSITION_LABEL_LAYER = "runway-end-positions-label";

/** adds runway touchpoint markers - yellow diamond labelled "TDP". returns the
 * added layer ids in render order (empty if no runway has a touchpoint). */
export function addTouchpointLayers(
  map: MaplibreMap,
  runways: SurfaceResponse[],
): string[] {
  const touchpoints = runways.filter(
    (r) => r.touchpoint_latitude != null && r.touchpoint_longitude != null,
  );
  if (touchpoints.length === 0) return [];

  map.addSource(TOUCHPOINT_SOURCE, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: touchpoints.map((r) => ({
        type: "Feature" as const,
        properties: {
          id: r.id,
          identifier: r.identifier,
          entityType: "touchpoint",
        },
        geometry: {
          type: "Point" as const,
          coordinates: [
            r.touchpoint_longitude as number,
            r.touchpoint_latitude as number,
            r.touchpoint_altitude ?? 0,
          ],
        },
      })),
    },
  });

  map.addLayer({
    id: TOUCHPOINT_MARKER_LAYER,
    type: "circle",
    source: TOUCHPOINT_SOURCE,
    paint: {
      "circle-radius": 8,
      "circle-color": "#ffd700",
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 1,
      "circle-opacity": 0.9,
    },
  });

  map.addLayer({
    id: TOUCHPOINT_LABEL_LAYER,
    type: "symbol",
    source: TOUCHPOINT_SOURCE,
    layout: {
      "text-field": "TDP",
      "text-size": 10,
      "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
      "text-offset": [0, 1.2],
      "text-anchor": "top",
    },
    paint: {
      "text-color": "#ffd700",
      "text-halo-color": "#000000",
      "text-halo-width": 1.5,
    },
  });

  return [TOUCHPOINT_MARKER_LAYER, TOUCHPOINT_LABEL_LAYER];
}

/** adds runway threshold markers. returns the added layer ids (empty if none). */
export function addThresholdLayers(
  map: MaplibreMap,
  runways: SurfaceResponse[],
): string[] {
  const thresholds = runways.filter((r) => r.threshold_position != null);
  if (thresholds.length === 0) return [];

  map.addSource(THRESHOLD_SOURCE, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: thresholds.map((r) => ({
        type: "Feature" as const,
        properties: {
          id: r.id,
          identifier: r.identifier,
          entityType: "threshold",
        },
        geometry: r.threshold_position!,
      })),
    },
  });

  map.addLayer({
    id: THRESHOLD_MARKER_LAYER,
    type: "symbol",
    source: THRESHOLD_SOURCE,
    layout: {
      "icon-image": "threshold-marker",
      "icon-size": 0.9,
      "icon-allow-overlap": true,
    },
  });

  map.addLayer({
    id: THRESHOLD_LABEL_LAYER,
    type: "symbol",
    source: THRESHOLD_SOURCE,
    layout: {
      "text-field": "THR",
      "text-size": 10,
      "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
      "text-offset": [0, 1.2],
      "text-anchor": "top",
    },
    paint: {
      "text-color": "#4595e5",
      "text-halo-color": "#000000",
      "text-halo-width": 1.5,
    },
  });

  return [THRESHOLD_MARKER_LAYER, THRESHOLD_LABEL_LAYER];
}

/** adds runway end position markers. returns the added layer ids (empty if none). */
export function addEndPositionLayers(
  map: MaplibreMap,
  runways: SurfaceResponse[],
): string[] {
  const endPositions = runways.filter((r) => r.end_position != null);
  if (endPositions.length === 0) return [];

  map.addSource(END_POSITION_SOURCE, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: endPositions.map((r) => ({
        type: "Feature" as const,
        properties: {
          id: r.id,
          identifier: r.identifier,
          entityType: "end_position",
        },
        geometry: r.end_position!,
      })),
    },
  });

  map.addLayer({
    id: END_POSITION_MARKER_LAYER,
    type: "symbol",
    source: END_POSITION_SOURCE,
    layout: {
      "icon-image": "end-position-marker",
      "icon-size": 0.9,
      "icon-allow-overlap": true,
    },
  });

  map.addLayer({
    id: END_POSITION_LABEL_LAYER,
    type: "symbol",
    source: END_POSITION_SOURCE,
    layout: {
      "text-field": "END",
      "text-size": 10,
      "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
      "text-offset": [0, 1.2],
      "text-anchor": "top",
    },
    paint: {
      "text-color": "#e54545",
      "text-halo-color": "#000000",
      "text-halo-width": 1.5,
    },
  });

  return [END_POSITION_MARKER_LAYER, END_POSITION_LABEL_LAYER];
}
