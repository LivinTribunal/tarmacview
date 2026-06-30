import type { Map as MaplibreMap } from "maplibre-gl";
import { DEFAULT_RUNWAY_WIDTH_M, DEFAULT_TAXIWAY_WIDTH_M } from "@/constants/surface";
import type { SurfaceResponse } from "@/types/airport";
import {
  bufferLineString,
  dedupPairedRunways,
  pairedRunwayLabel,
} from "./surface/surfaceGeometry";
import {
  addEndPositionLayers,
  addThresholdLayers,
  addTouchpointLayers,
  END_POSITION_LABEL_LAYER,
  END_POSITION_MARKER_LAYER,
  END_POSITION_SOURCE,
  THRESHOLD_LABEL_LAYER,
  THRESHOLD_MARKER_LAYER,
  THRESHOLD_SOURCE,
  TOUCHPOINT_LABEL_LAYER,
  TOUCHPOINT_MARKER_LAYER,
  TOUCHPOINT_SOURCE,
} from "./surface/surfaceMarkers";

export { bufferLineString, dedupPairedRunways, pairedRunwayLabel };
export {
  END_POSITION_LABEL_LAYER,
  END_POSITION_MARKER_LAYER,
  END_POSITION_SOURCE,
  THRESHOLD_LABEL_LAYER,
  THRESHOLD_MARKER_LAYER,
  THRESHOLD_SOURCE,
  TOUCHPOINT_LABEL_LAYER,
  TOUCHPOINT_MARKER_LAYER,
  TOUCHPOINT_SOURCE,
};

export const RUNWAY_SOURCE = "runways";
export const RUNWAY_POLYGON_SOURCE = "runways-polygon";
export const RUNWAY_FILL_LAYER = "runways-fill";
export const RUNWAY_STROKE_LAYER = "runways-stroke";
export const RUNWAY_CENTERLINE_LAYER = "runways-centerline";
export const RUNWAY_LABEL_LAYER = "runways-label";
export const TAXIWAY_SOURCE = "taxiways";
export const TAXIWAY_POLYGON_SOURCE = "taxiways-polygon";
export const TAXIWAY_FILL_LAYER = "taxiways-fill";
export const TAXIWAY_STROKE_LAYER = "taxiways-stroke";
export const TAXIWAY_CENTERLINE_LAYER = "taxiways-centerline";
export const TAXIWAY_LABEL_LAYER = "taxiways-label";

/** adds runway and taxiway layers with geographic polygon fills.
 *
 *  paired RUNWAY surfaces are deduplicated so each physical runway renders as
 *  one shape; the lower-id direction is the survivor for click-to-select.
 */
export function addSurfaceLayers(
  map: MaplibreMap,
  surfaces: SurfaceResponse[],
): string[] {
  const visible = dedupPairedRunways(surfaces);
  const runways = visible.filter((s) => s.surface_type === "RUNWAY");
  const taxiways = visible.filter((s) => s.surface_type === "TAXIWAY");
  // partner lookup uses the original surfaces so the dropped side is still resolvable
  const surfaceById = new Map(surfaces.map((s) => [s.id, s]));

  // centerline source for labels and centerline dashes
  map.addSource(RUNWAY_SOURCE, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: runways.map((r) => ({
        type: "Feature" as const,
        properties: {
          id: r.id,
          identifier: r.identifier,
          identifier_label: pairedRunwayLabel(r, surfaceById),
          width: r.width ?? DEFAULT_RUNWAY_WIDTH_M,
          entityType: "surface",
        },
        geometry: r.geometry,
      })),
    },
  });

  // polygon source for geographic fill - use stored boundary when available
  map.addSource(RUNWAY_POLYGON_SOURCE, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: runways.flatMap((r) =>
        r.boundary || r.geometry.coordinates.length >= 2
          ? [
              {
                type: "Feature" as const,
                properties: {
                  id: r.id,
                  identifier: r.identifier,
                  entityType: "surface",
                },
                geometry: r.boundary ?? {
                  type: "Polygon" as const,
                  coordinates: [bufferLineString(r.geometry.coordinates, r.width ?? DEFAULT_RUNWAY_WIDTH_M)],
                },
              },
            ]
          : [],
      ),
    },
  });

  // runway stroke - geographic polygon outline
  map.addLayer({
    id: RUNWAY_STROKE_LAYER,
    type: "line",
    source: RUNWAY_POLYGON_SOURCE,
    paint: {
      "line-color": "#6a6a6a",
      "line-width": 1.5,
      "line-opacity": 0.6,
    },
  });

  // runway fill - geographic polygon
  map.addLayer({
    id: RUNWAY_FILL_LAYER,
    type: "fill",
    source: RUNWAY_POLYGON_SOURCE,
    paint: {
      "fill-color": "#4a4a4a",
      "fill-opacity": 0.5,
    },
  });

  // runway centerline dashes
  map.addLayer({
    id: RUNWAY_CENTERLINE_LAYER,
    type: "line",
    source: RUNWAY_SOURCE,
    paint: {
      "line-color": "#ffffff",
      "line-width": 1.5,
      "line-dasharray": [8, 8],
      "line-opacity": 0.7,
    },
  });

  // runway labels
  map.addLayer({
    id: RUNWAY_LABEL_LAYER,
    type: "symbol",
    source: RUNWAY_SOURCE,
    layout: {
      "text-field": [
        "concat",
        "RWY ",
        ["coalesce", ["get", "identifier_label"], ["get", "identifier"]],
      ],
      "text-size": 13,
      "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
      "symbol-placement": "line-center",
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "#000000",
      "text-halo-width": 1.5,
    },
  });

  // taxiway centerline source for labels
  map.addSource(TAXIWAY_SOURCE, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: taxiways.map((t) => ({
        type: "Feature" as const,
        properties: {
          id: t.id,
          identifier: t.identifier,
          width: DEFAULT_TAXIWAY_WIDTH_M,
          entityType: "surface",
        },
        geometry: t.geometry,
      })),
    },
  });

  // taxiway polygon source for geographic fill - use stored boundary when available
  map.addSource(TAXIWAY_POLYGON_SOURCE, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: taxiways.flatMap((t) =>
        t.boundary || t.geometry.coordinates.length >= 2
          ? [
              {
                type: "Feature" as const,
                properties: {
                  id: t.id,
                  identifier: t.identifier,
                  entityType: "surface",
                },
                geometry: t.boundary ?? {
                  type: "Polygon" as const,
                  coordinates: [bufferLineString(t.geometry.coordinates, DEFAULT_TAXIWAY_WIDTH_M)],
                },
              },
            ]
          : [],
      ),
    },
  });

  // taxiway stroke - geographic polygon outline
  map.addLayer({
    id: TAXIWAY_STROKE_LAYER,
    type: "line",
    source: TAXIWAY_POLYGON_SOURCE,
    paint: {
      "line-color": "#b8a038",
      "line-width": 1,
      "line-opacity": 0.5,
    },
  });

  // taxiway fill - geographic polygon
  map.addLayer({
    id: TAXIWAY_FILL_LAYER,
    type: "fill",
    source: TAXIWAY_POLYGON_SOURCE,
    paint: {
      "fill-color": "#c8a83c",
      "fill-opacity": 0.35,
    },
  });

  // taxiway centerline dashes
  map.addLayer({
    id: TAXIWAY_CENTERLINE_LAYER,
    type: "line",
    source: TAXIWAY_SOURCE,
    paint: {
      "line-color": "#1a1a1a",
      "line-width": 1,
      "line-dasharray": [6, 6],
      "line-opacity": 0.6,
    },
  });

  // taxiway labels
  map.addLayer({
    id: TAXIWAY_LABEL_LAYER,
    type: "symbol",
    source: TAXIWAY_SOURCE,
    layout: {
      "text-field": ["concat", "TWY ", ["get", "identifier"]],
      "text-size": 11,
      "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
      "symbol-placement": "line-center",
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#d4b84a",
      "text-halo-color": "#000000",
      "text-halo-width": 1,
    },
  });

  const touchpointLayers = addTouchpointLayers(map, runways);
  const thresholdLayers = addThresholdLayers(map, runways);
  const endPositionLayers = addEndPositionLayers(map, runways);

  return [
    RUNWAY_STROKE_LAYER,
    RUNWAY_FILL_LAYER,
    RUNWAY_CENTERLINE_LAYER,
    RUNWAY_LABEL_LAYER,
    TAXIWAY_STROKE_LAYER,
    TAXIWAY_FILL_LAYER,
    TAXIWAY_CENTERLINE_LAYER,
    TAXIWAY_LABEL_LAYER,
    ...touchpointLayers,
    ...thresholdLayers,
    ...endPositionLayers,
  ];
}
