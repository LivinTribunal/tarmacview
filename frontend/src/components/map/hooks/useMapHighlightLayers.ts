import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type maplibregl from "maplibre-gl";
import type { MapFeature } from "@/types/map";
import type { WaypointResponse } from "@/types/flightPlan";
import {
  updateSelectedFilter,
  updateInspectionHighlightFilter,
  updateWarningHighlightFilter,
} from "../layers/waypointLayers";
import { RUNWAY_POLYGON_SOURCE, TAXIWAY_POLYGON_SOURCE } from "../layers/surfaceLayers";
import { OBSTACLE_SOURCE } from "../layers/obstacleLayers";
import { SAFETY_ZONE_SOURCE } from "../layers/safetyZoneLayers";
import { AGL_SOURCE, LHA_SOURCE } from "../layers/aglLayers";
import { MAP_QUICK_DURATION_MS, MAP_ZOOM_FOCUS } from "@/constants/mapAnimations";
import { NEUTRAL } from "@/constants/palette";

// highlight layer ids for selected infrastructure features
export const HIGHLIGHT_RUNWAY = "highlight-runway";
export const HIGHLIGHT_TAXIWAY = "highlight-taxiway";
export const HIGHLIGHT_OBSTACLE = "highlight-obstacle";
export const HIGHLIGHT_SAFETY_ZONE = "highlight-safety-zone";
export const HIGHLIGHT_AGL = "highlight-agl";
export const HIGHLIGHT_LHA = "highlight-lha";

export const HIGHLIGHT_LAYERS = [
  HIGHLIGHT_RUNWAY,
  HIGHLIGHT_TAXIWAY,
  HIGHLIGHT_OBSTACLE,
  HIGHLIGHT_SAFETY_ZONE,
  HIGHLIGHT_AGL,
  HIGHLIGHT_LHA,
];

/** add selection highlight layers for all infrastructure types. */
export function addHighlightLayers(map: maplibregl.Map) {
  const emptyFilter: maplibregl.ExpressionSpecification = ["==", ["get", "id"], ""];

  // runway polygon outline
  if (map.getSource(RUNWAY_POLYGON_SOURCE) && !map.getLayer(HIGHLIGHT_RUNWAY)) {
    map.addLayer({
      id: HIGHLIGHT_RUNWAY,
      type: "line",
      source: RUNWAY_POLYGON_SOURCE,
      filter: emptyFilter,
      paint: { "line-color": NEUTRAL.WHITE, "line-width": 3, "line-opacity": 0.9 },
    });
  }

  // taxiway polygon outline
  if (map.getSource(TAXIWAY_POLYGON_SOURCE) && !map.getLayer(HIGHLIGHT_TAXIWAY)) {
    map.addLayer({
      id: HIGHLIGHT_TAXIWAY,
      type: "line",
      source: TAXIWAY_POLYGON_SOURCE,
      filter: emptyFilter,
      paint: { "line-color": NEUTRAL.WHITE, "line-width": 3, "line-opacity": 0.9 },
    });
  }

  // obstacle point ring
  if (map.getSource(OBSTACLE_SOURCE) && !map.getLayer(HIGHLIGHT_OBSTACLE)) {
    map.addLayer({
      id: HIGHLIGHT_OBSTACLE,
      type: "circle",
      source: OBSTACLE_SOURCE,
      filter: emptyFilter,
      paint: {
        "circle-radius": 16,
        "circle-color": "transparent",
        "circle-stroke-color": NEUTRAL.WHITE,
        "circle-stroke-width": 3,
        "circle-stroke-opacity": 0.9,
      },
    });
  }

  // safety zone polygon outline
  if (map.getSource(SAFETY_ZONE_SOURCE) && !map.getLayer(HIGHLIGHT_SAFETY_ZONE)) {
    map.addLayer({
      id: HIGHLIGHT_SAFETY_ZONE,
      type: "line",
      source: SAFETY_ZONE_SOURCE,
      filter: emptyFilter,
      paint: { "line-color": NEUTRAL.WHITE, "line-width": 3, "line-opacity": 0.9 },
    });
  }

  // agl point ring
  if (map.getSource(AGL_SOURCE) && !map.getLayer(HIGHLIGHT_AGL)) {
    map.addLayer({
      id: HIGHLIGHT_AGL,
      type: "circle",
      source: AGL_SOURCE,
      filter: emptyFilter,
      paint: {
        "circle-radius": 16,
        "circle-color": "transparent",
        "circle-stroke-color": NEUTRAL.WHITE,
        "circle-stroke-width": 3,
        "circle-stroke-opacity": 0.9,
      },
    });
  }

  // lha point ring
  if (map.getSource(LHA_SOURCE) && !map.getLayer(HIGHLIGHT_LHA)) {
    map.addLayer({
      id: HIGHLIGHT_LHA,
      type: "circle",
      source: LHA_SOURCE,
      filter: emptyFilter,
      paint: {
        "circle-radius": 12,
        "circle-color": "transparent",
        "circle-stroke-color": NEUTRAL.WHITE,
        "circle-stroke-width": 3,
        "circle-stroke-opacity": 0.9,
      },
    });
  }
}

/** update highlight layer filters to match selected feature(s). */
export function syncHighlight(
  map: maplibregl.Map,
  feature: MapFeature | null,
  lhaIds: string[] | null,
) {
  const layers = [
    { id: HIGHLIGHT_RUNWAY, type: "surface", subType: "RUNWAY" },
    { id: HIGHLIGHT_TAXIWAY, type: "surface", subType: "TAXIWAY" },
    { id: HIGHLIGHT_OBSTACLE, type: "obstacle" },
    { id: HIGHLIGHT_SAFETY_ZONE, type: "safety_zone" },
    { id: HIGHLIGHT_AGL, type: "agl" },
  ];

  for (const layer of layers) {
    try {
      if (!map.getLayer(layer.id)) continue;
      let matchId = "";
      if (feature && feature.type === layer.type) {
        if (layer.subType) {
          // surface: match only if sub-type matches
          if (feature.type === "surface" && feature.data.surface_type === layer.subType) {
            matchId = feature.data.id;
          }
        } else {
          matchId = feature.data.id;
        }
      }
      map.setFilter(layer.id, ["==", ["get", "id"], matchId]);
    } catch {
      // layer may not exist
    }
  }

  // lha layer: prefer the multi-id set when provided, otherwise fall back
  // to the single-feature path.
  try {
    if (map.getLayer(HIGHLIGHT_LHA)) {
      if (lhaIds && lhaIds.length > 0) {
        map.setFilter(HIGHLIGHT_LHA, ["in", ["get", "id"], ["literal", lhaIds]]);
      } else {
        const matchId =
          feature && feature.type === "lha" ? feature.data.id : "";
        map.setFilter(HIGHLIGHT_LHA, ["==", ["get", "id"], matchId]);
      }
    }
  } catch {
    // layer may not exist
  }
}

interface UseMapHighlightLayersParams {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  focusFeature?: MapFeature | null;
  focusLhaIds?: string[] | null;
  selectedWaypointId?: string | null;
  highlightedInspectionId?: string | null;
  highlightedWaypointIds?: string[];
  highlightSeverity?: string;
  simplifiedTrajectory: boolean;
  setSelectedFeature: (feature: MapFeature | null) => void;
  waypointsRef: MutableRefObject<WaypointResponse[] | undefined>;
}

/** drives focus/selected/inspection/warning highlight rings off declarative props. */
export function useMapHighlightLayers({
  mapRef,
  focusFeature,
  focusLhaIds,
  selectedWaypointId,
  highlightedInspectionId,
  highlightedWaypointIds,
  highlightSeverity,
  simplifiedTrajectory,
  setSelectedFeature,
  waypointsRef,
}: UseMapHighlightLayersParams) {
  // highlight the focused feature on the map. fly is a separate intent
  // dispatched via the imperative locateFeature() handle, which routes to the
  // active map (cesium when 3d is live, maplibre otherwise).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    syncHighlight(map, focusFeature ?? null, focusLhaIds ?? null);
  }, [mapRef, focusFeature, focusLhaIds]);

  // update selected waypoint highlight and feature info
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    updateSelectedFilter(map, selectedWaypointId);

    // sync feature info when selection changes (e.g. from waypoint list click)
    if (!selectedWaypointId) return;
    const wps = waypointsRef.current ?? [];
    const wp = wps.find((w) => w.id === selectedWaypointId);
    if (wp) {
      setSelectedFeature({
        type: "waypoint",
        data: {
          id: wp.id,
          waypoint_type: wp.waypoint_type,
          sequence_order: wp.sequence_order,
          position: wp.position,
          stack_count: 1,
          heading: wp.heading ?? null,
          speed: wp.speed ?? null,
          camera_action: wp.camera_action ?? null,
          camera_target: wp.camera_target ?? null,
          gimbal_pitch: wp.gimbal_pitch ?? null,
          agl: wp.agl ?? null,
          camera_target_agl: wp.camera_target_agl ?? null,
        },
      });
    }
  }, [mapRef, selectedWaypointId, waypointsRef, setSelectedFeature]);

  // update inspection highlight ring (selected inspection's measurement waypoints)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    updateInspectionHighlightFilter(map, highlightedInspectionId);
  }, [mapRef, highlightedInspectionId]);

  // update warning highlight layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    updateWarningHighlightFilter(map, highlightedWaypointIds, highlightSeverity, simplifiedTrajectory);

    // fly to highlighted waypoints
    if (!highlightedWaypointIds || highlightedWaypointIds.length === 0) return;
    const wps = waypointsRef.current ?? [];
    const highlighted = wps.filter((w) => highlightedWaypointIds.includes(w.id));
    if (highlighted.length === 0) return;

    if (highlighted.length === 1) {
      const [lon, lat] = highlighted[0].position.coordinates;
      map.flyTo({ center: [lon, lat], zoom: MAP_ZOOM_FOCUS, duration: MAP_QUICK_DURATION_MS });
    } else {
      const lngs = highlighted.map((w) => w.position.coordinates[0]);
      const lats = highlighted.map((w) => w.position.coordinates[1]);
      map.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: 100, duration: MAP_QUICK_DURATION_MS },
      );
    }
  }, [mapRef, highlightedWaypointIds, highlightSeverity, simplifiedTrajectory, waypointsRef]);
}
