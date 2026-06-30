import { useCallback, useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type maplibregl from "maplibre-gl";
import type { MapLayerConfig } from "@/types/map";
import type { AirportDetailResponse } from "@/types/airport";
import {
  WAYPOINT_TRANSIT_CIRCLE_LAYER,
  WAYPOINT_MEASUREMENT_CIRCLE_LAYER,
  WAYPOINT_HOVER_LAYER,
  WAYPOINT_RECORDING_BOOKEND_LAYER,
  WAYPOINT_LABEL_LAYER,
  WAYPOINT_LINE_LAYER,
  WAYPOINT_ARROW_LAYER,
  WAYPOINT_CAMERA_LINE_LAYER,
} from "../layers/waypointLayers";

const TRAJECTORY_CHILDREN: (keyof MapLayerConfig)[] = [
  "transitWaypoints", "measurementWaypoints", "path", "takeoffLanding", "cameraHeading", "pathHeading",
];

interface UseMapLayerSyncParams {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  airport: AirportDetailResponse;
  layerConfig: MapLayerConfig;
  layerConfigRef: MutableRefObject<MapLayerConfig>;
  visibleInspectionIds?: Set<string>;
  visibleInspectionIdsRef: MutableRefObject<Set<string> | undefined>;
  setLayerConfig: Dispatch<SetStateAction<MapLayerConfig>>;
  layerGroupMap: Partial<Record<keyof MapLayerConfig, string[]>>;
}

/** layer visibility + inspection filter sync, plus the LayerPanel toggle cascade. */
export function useMapLayerSync({
  mapRef,
  airport,
  layerConfig,
  layerConfigRef,
  visibleInspectionIds,
  visibleInspectionIdsRef,
  setLayerConfig,
  layerGroupMap,
}: UseMapLayerSyncParams) {
  // apply inspection visibility filters to waypoint layers
  const syncInspectionFilters = useCallback((map: maplibregl.Map) => {
    /** apply inspection_id filters to waypoint layers. */
    const inspIds = visibleInspectionIdsRef.current;
    if (!inspIds) return;

    const ids = [...inspIds];
    const visFilter: maplibregl.ExpressionSpecification = [
      "any",
      ["!", ["has", "inspection_id"]],
      ["!", ["to-boolean", ["get", "inspection_id"]]],
      ["in", ["get", "inspection_id"], ["literal", ids]],
    ];

    const layersToFilter = [
      { id: WAYPOINT_TRANSIT_CIRCLE_LAYER, base: ["==", ["get", "waypoint_type"], "TRANSIT"] as maplibregl.ExpressionSpecification },
      { id: WAYPOINT_MEASUREMENT_CIRCLE_LAYER, base: ["==", ["get", "waypoint_type"], "MEASUREMENT"] as maplibregl.ExpressionSpecification },
      { id: WAYPOINT_HOVER_LAYER, base: ["==", ["get", "waypoint_type"], "HOVER"] as maplibregl.ExpressionSpecification },
      {
        id: WAYPOINT_RECORDING_BOOKEND_LAYER,
        base: [
          "all",
          ["==", ["get", "waypoint_type"], "MEASUREMENT"],
          ["match", ["get", "camera_action"], ["RECORDING_START", "RECORDING_STOP"], true, false],
        ] as maplibregl.ExpressionSpecification,
      },
      { id: WAYPOINT_LABEL_LAYER, base: ["==", ["get", "waypoint_type"], "MEASUREMENT"] as maplibregl.ExpressionSpecification },
      { id: WAYPOINT_LINE_LAYER, base: null },
      { id: WAYPOINT_ARROW_LAYER, base: null },
      { id: WAYPOINT_CAMERA_LINE_LAYER, base: null },
    ];

    for (const { id, base } of layersToFilter) {
      try {
        if (map.getLayer(id)) {
          const filter = base
            ? (["all", base, visFilter] as maplibregl.ExpressionSpecification)
            : visFilter;
          map.setFilter(id, filter);
        }
      } catch {
        // layer may not exist
      }
    }
  }, [visibleInspectionIdsRef]);

  // apply current layer config visibility to all map layers
  const syncLayerVisibility = useCallback((map: maplibregl.Map) => {
    /** sync layer toggle state to maplibre visibility properties. */
    const cfg = layerConfigRef.current;
    for (const [key, layerIds] of Object.entries(layerGroupMap)) {
      const visible = cfg[key as keyof MapLayerConfig];
      if (visible === undefined) continue;
      for (const layerId of layerIds) {
        try {
          if (map.getLayer(layerId)) {
            map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
          }
        } catch {
          // layer may not exist
        }
      }
    }
  }, [layerConfigRef, layerGroupMap]);

  const handleLayerToggle = useCallback((key: string) => {
    /** toggle a layer with parent-child cascade and mutual exclusion. */
    setLayerConfig((prev) => {
      const next = { ...prev };

      if (key === "simplifiedTrajectory") {
        next.simplifiedTrajectory = !prev.simplifiedTrajectory;
        if (next.simplifiedTrajectory) {
          next.trajectory = false;
          for (const k of TRAJECTORY_CHILDREN) next[k] = false;
        }
        return next;
      }

      if (key === "trajectory") {
        next.trajectory = !prev.trajectory;
        if (next.trajectory) {
          next.simplifiedTrajectory = false;
          next.transitWaypoints = true;
          next.measurementWaypoints = true;
          next.path = true;
          next.takeoffLanding = true;
          next.cameraHeading = false;
          next.pathHeading = true;
        } else {
          for (const k of TRAJECTORY_CHILDREN) next[k] = false;
        }
        return next;
      }

      // "waypoints" virtual parent
      if (key === "waypoints") {
        const newVal = !(prev.transitWaypoints && prev.measurementWaypoints);
        next.transitWaypoints = newVal;
        next.measurementWaypoints = newVal;
        if (newVal) {
          next.trajectory = true;
          next.simplifiedTrajectory = false;
        }
        return next;
      }

      // individual toggle
      const k = key as keyof MapLayerConfig;
      if (k in next) {
        next[k] = !prev[k];

        // if a trajectory child toggled on, ensure parent on + simplified off
        if (TRAJECTORY_CHILDREN.includes(key as keyof MapLayerConfig)) {
          const anyOn = TRAJECTORY_CHILDREN.some((k) => next[k]);
          next.trajectory = anyOn;
          if (anyOn) next.simplifiedTrajectory = false;
        }
      }

      return next;
    });
  }, [setLayerConfig]);

  // sync layer visibility - re-fires on layerConfig prop change (syncLayerVisibility reads the ref mirror)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    syncLayerVisibility(map);
  }, [mapRef, layerConfig, syncLayerVisibility]);

  // mount-time guard - poll until the style is loaded then sync visibility once
  // so the LayerPanel toggle state matches actual MapLibre layer visibility
  // regardless of which layer-add path created the layers first.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;
    function trySync() {
      if (cancelled || !map) return;
      if (!map.isStyleLoaded()) {
        requestAnimationFrame(trySync);
        return;
      }
      syncLayerVisibility(map);
    }
    trySync();
    return () => {
      cancelled = true;
    };
  }, [mapRef, airport, syncLayerVisibility]);

  // sync inspection visibility filters
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !visibleInspectionIds) return;
    syncInspectionFilters(map);
  }, [mapRef, visibleInspectionIds, syncInspectionFilters]);

  return { syncInspectionFilters, syncLayerVisibility, handleLayerToggle };
}
