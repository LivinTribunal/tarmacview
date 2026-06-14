import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject, Dispatch, SetStateAction } from "react";
import type maplibregl from "maplibre-gl";
import type { AirportDetailResponse } from "@/types/airport";
import type { MapLayerConfig } from "@/types/map";
import type { FlightPlanScope } from "@/types/enums";
import type { WaypointResponse } from "@/types/flightPlan";
import type { PointZ } from "@/types/common";
import { WAYPOINT_HIGHLIGHT_COLORS } from "@/constants/palette";
import { registerAllMapImages } from "../layers/mapImages";
import {
  addSurfaceLayers,
  RUNWAY_SOURCE,
  RUNWAY_POLYGON_SOURCE,
  TAXIWAY_SOURCE,
  TAXIWAY_POLYGON_SOURCE,
  TOUCHPOINT_SOURCE,
  THRESHOLD_SOURCE,
  END_POSITION_SOURCE,
} from "../layers/surfaceLayers";
import {
  addObstacleLayers,
  addBufferZoneLayers,
  OBSTACLE_SOURCE,
  OBSTACLE_BOUNDARY_SOURCE,
  OBSTACLE_BUFFER_SOURCE,
  SURFACE_BUFFER_SOURCE,
} from "../layers/obstacleLayers";
import {
  addSafetyZoneLayers,
  SAFETY_ZONE_SOURCE,
  AIRPORT_BOUNDARY_SOURCE,
} from "../layers/safetyZoneLayers";
import {
  addAglLayers,
  AGL_SOURCE,
  LHA_SOURCE,
  EDGE_LIGHTS_LINE_SOURCE,
} from "../layers/aglLayers";
import {
  addWaypointLayers as addWaypointLayersFn,
  removeWaypointLayers as removeWaypointLayersFn,
  addSimplifiedTrajectoryLayers,
  removeSimplifiedTrajectoryLayers,
  updateInspectionHighlightFilter,
  updateWarningHighlightFilter,
  WAYPOINT_TAKEOFF_LAYER,
  WAYPOINT_LANDING_LAYER,
} from "../layers/waypointLayers";
import { makeSatelliteStyle, makeMapStyle, waitForStyleLoaded } from "../mapStyles";
import { addMeasureLayersToMap } from "./useMeasureTool";
import { addHeadingLayersToMap } from "./useHeadingTool";
import { addHighlightLayers, syncHighlight, HIGHLIGHT_LAYERS } from "./useMapHighlightLayers";
import type { MapFeature } from "@/types/map";
import { layerGroupMap } from "../mapLayerGroups";

export const PENDING_PREVIEW_SOURCE = "pending-preview";
export const PENDING_PREVIEW_FILL_LAYER = "pending-preview-fill";
export const PENDING_PREVIEW_BORDER_LAYER = "pending-preview-border";
export const PENDING_PREVIEW_POINT_LAYER = "pending-preview-point";

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function addPendingPreviewLayers(map: maplibregl.Map) {
  /** add source and layers for pending creation preview. */
  if (map.getSource(PENDING_PREVIEW_SOURCE)) return;
  map.addSource(PENDING_PREVIEW_SOURCE, { type: "geojson", data: EMPTY_FC });
  map.addLayer({
    id: PENDING_PREVIEW_FILL_LAYER,
    type: "fill",
    source: PENDING_PREVIEW_SOURCE,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": WAYPOINT_HIGHLIGHT_COLORS.HIGHLIGHT, "fill-opacity": 0.2 },
  });
  map.addLayer({
    id: PENDING_PREVIEW_BORDER_LAYER,
    type: "line",
    source: PENDING_PREVIEW_SOURCE,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "line-color": WAYPOINT_HIGHLIGHT_COLORS.HIGHLIGHT,
      "line-width": 2,
      "line-dasharray": [4, 3],
    },
  });
  map.addLayer({
    id: PENDING_PREVIEW_POINT_LAYER,
    type: "circle",
    source: PENDING_PREVIEW_SOURCE,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 7,
      "circle-color": WAYPOINT_HIGHLIGHT_COLORS.HIGHLIGHT,
      "circle-stroke-color": WAYPOINT_HIGHLIGHT_COLORS.HALO,
      "circle-stroke-width": 2,
    },
  });
}

// infrastructure source/layer names for cleanup
const INFRA_SOURCES = [
  SAFETY_ZONE_SOURCE, AIRPORT_BOUNDARY_SOURCE, RUNWAY_SOURCE, RUNWAY_POLYGON_SOURCE,
  TAXIWAY_SOURCE, TAXIWAY_POLYGON_SOURCE, OBSTACLE_SOURCE,
  OBSTACLE_BOUNDARY_SOURCE, OBSTACLE_BUFFER_SOURCE, SURFACE_BUFFER_SOURCE,
  AGL_SOURCE, LHA_SOURCE,
  // edge-light connector line + runway touchpoints - conditionally added by their
  // layer modules, but still must be torn down so the next addSource() doesn't collide
  EDGE_LIGHTS_LINE_SOURCE, TOUCHPOINT_SOURCE, THRESHOLD_SOURCE, END_POSITION_SOURCE,
];

function removeInfraLayers(map: maplibregl.Map) {
  /** remove infrastructure layers and sources so they can be re-added with fresh data. */
  const style = map.getStyle();
  if (!style?.layers) return;
  // remove layers that reference infra sources
  for (const layer of [...style.layers]) {
    if (INFRA_SOURCES.includes((layer as { source?: string }).source ?? "")) {
      try { map.removeLayer(layer.id); } catch { /* noop */ }
    }
  }
  // remove highlight layers too
  for (const lyr of HIGHLIGHT_LAYERS) {
    try { if (map.getLayer(lyr)) map.removeLayer(lyr); } catch { /* noop */ }
  }
  // remove sources
  for (const src of INFRA_SOURCES) {
    try { if (map.getSource(src)) map.removeSource(src); } catch { /* noop */ }
  }
}

interface UseMapBootstrapParams {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  airport: AirportDetailResponse;
  waypoints: WaypointResponse[] | null | undefined;
  takeoffCoordinate: PointZ | null | undefined;
  landingCoordinate: PointZ | null | undefined;
  inspectionIndexMap: Record<string, number> | undefined;
  selectedWaypointId: string | null | undefined;
  flightPlanScope: FlightPlanScope | null | undefined;
  terrainMode: "map" | "satellite";
  setTerrainMode: Dispatch<SetStateAction<"map" | "satellite">> | ((mode: "map" | "satellite") => void);
  layerConfig: MapLayerConfig;
  layerConfigRef: MutableRefObject<MapLayerConfig>;
  focusFeatureRef: MutableRefObject<MapFeature | null>;
  focusLhaIdsRef: MutableRefObject<string[] | null>;
  highlightedIdsRef: MutableRefObject<string[] | undefined>;
  highlightSeverityRef: MutableRefObject<string | undefined>;
  highlightedInspectionIdRef: MutableRefObject<string | null | undefined>;
  onMeasureClearRef: MutableRefObject<(() => void) | undefined>;
  onHeadingClearRef: MutableRefObject<(() => void) | undefined>;
  waypointsRef: MutableRefObject<WaypointResponse[] | null | undefined>;
  takeoffRef: MutableRefObject<PointZ | null | undefined>;
  landingRef: MutableRefObject<PointZ | null | undefined>;
  indexMapRef: MutableRefObject<Record<string, number> | undefined>;
  syncLayerVisibility: (map: maplibregl.Map) => void;
  syncInspectionFilters: (map: maplibregl.Map) => void;
}

interface UseMapBootstrapResult {
  addAllLayers: (map: maplibregl.Map) => void;
  addWaypointLayers: (
    map: maplibregl.Map,
    wpsOverride?: WaypointResponse[],
    tkOverride?: PointZ | null,
    ldOverride?: PointZ | null,
  ) => void;
  handleTerrainChange: (mode: "map" | "satellite") => void;
}

/** owns map layer bootstrap: adders, infra/waypoint sync effects, and terrain change. */
export function useMapBootstrap({
  mapRef,
  airport,
  waypoints,
  takeoffCoordinate,
  landingCoordinate,
  inspectionIndexMap,
  selectedWaypointId,
  flightPlanScope,
  terrainMode,
  setTerrainMode,
  layerConfig,
  layerConfigRef,
  focusFeatureRef,
  focusLhaIdsRef,
  highlightedIdsRef,
  highlightSeverityRef,
  highlightedInspectionIdRef,
  onMeasureClearRef,
  onHeadingClearRef,
  waypointsRef,
  takeoffRef,
  landingRef,
  indexMapRef,
  syncLayerVisibility,
  syncInspectionFilters,
}: UseMapBootstrapParams): UseMapBootstrapResult {
  const layersAddedRef = useRef(false);
  const cancelStylePollRef = useRef<(() => void) | null>(null);
  const appliedTerrainRef = useRef(terrainMode);

  // reset layersAddedRef on map teardown so the next map gets a fresh layer add
  useEffect(() => {
    return () => {
      layersAddedRef.current = false;
    };
  }, [airport.id]);

  const addAllLayers = useCallback(
    (map: maplibregl.Map) => {
      if (layersAddedRef.current) return;
      registerAllMapImages(map);
      addSafetyZoneLayers(map, airport.safety_zones);
      addSurfaceLayers(map, airport.surfaces);
      addObstacleLayers(map, airport.obstacles);
      addBufferZoneLayers(map, airport.obstacles, airport.surfaces);
      addAglLayers(map, airport.surfaces);
      addMeasureLayersToMap(map);
      addHeadingLayersToMap(map);
      addHighlightLayers(map);
      addPendingPreviewLayers(map);
      layersAddedRef.current = true;

      // paint any pending highlight now that the layers exist (the focusFeature
      // effect alone fires before layers are added on first render).
      syncHighlight(map, focusFeatureRef.current, focusLhaIdsRef.current);

      // sync layer visibility immediately so newly-added layers honor the
      // current LayerPanel toggle state instead of defaulting to "visible"
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
    },
    [airport, focusFeatureRef, focusLhaIdsRef, layerConfigRef],
  );

  // add infrastructure layers once map + airport data are ready, refresh on airport change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function addLayers() {
      if (!map) return;
      // if layers already exist, remove and re-add with fresh airport data
      if (layersAddedRef.current) {
        removeInfraLayers(map);
        layersAddedRef.current = false;
      }
      addAllLayers(map);

      // remove + re-add waypoint layers so they render on top of infrastructure
      removeWaypointLayersFn(map);
      removeSimplifiedTrajectoryLayers(map);
      registerAllMapImages(map);
      addWaypointLayersFn(map, waypointsRef.current ?? [], takeoffRef.current, landingRef.current, undefined, indexMapRef.current);
      addSimplifiedTrajectoryLayers(map, waypointsRef.current ?? [], takeoffRef.current, landingRef.current);

      // restore layer toggle visibility after rebuild
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

      // keep vertex editor overlay on top of rebuilt infra layers
      for (const lyr of ["vertex-edit-corners", "vertex-edit-center"]) {
        if (map.getLayer(lyr)) map.moveLayer(lyr);
      }
    }

    if (map.isStyleLoaded()) {
      addLayers();
    } else {
      // poll until style is ready - "load" event only fires once and may have already fired
      let cancelled = false;
      function poll() {
        if (cancelled) return;
        if (map!.isStyleLoaded()) {
          addLayers();
        } else {
          requestAnimationFrame(poll);
        }
      }
      requestAnimationFrame(poll);
      return () => { cancelled = true; };
    }
  }, [airport, addAllLayers, mapRef, indexMapRef, landingRef, layerConfigRef, takeoffRef, waypointsRef]);

  // add or update waypoint layers
  const addWaypointLayers = useCallback((
    map: maplibregl.Map,
    wpsOverride?: WaypointResponse[],
    tkOverride?: PointZ | null,
    ldOverride?: PointZ | null,
  ) => {
    const wps = wpsOverride ?? waypointsRef.current;
    // keep ref in sync so other code paths see the same data
    waypointsRef.current = wps;
    const takeoff = tkOverride !== undefined ? tkOverride : takeoffRef.current;
    const landing = ldOverride !== undefined ? ldOverride : landingRef.current;
    const idxMap = indexMapRef.current;

    registerAllMapImages(map);
    addWaypointLayersFn(map, wps ?? [], takeoff, landing, selectedWaypointId, idxMap);
    addSimplifiedTrajectoryLayers(map, wps ?? [], takeoff, landing);

    // re-sync visibility and filters after layers are added
    syncLayerVisibility(map);
    syncInspectionFilters(map);

    // re-apply warning highlight state after layer rebuild
    updateWarningHighlightFilter(
      map,
      highlightedIdsRef.current,
      highlightSeverityRef.current,
      layerConfigRef.current.simplifiedTrajectory,
    );
    updateInspectionHighlightFilter(map, highlightedInspectionIdRef.current);

    // force maplibre to render the updated source data on the next frame
    // - GeoJSONSource.setData is queued internally and may not redraw until
    //   the next user interaction; triggerRepaint guarantees immediate paint
    //   so newly-inserted transit waypoints appear without an extra click.
    map.triggerRepaint();
  }, [
    selectedWaypointId,
    syncLayerVisibility,
    syncInspectionFilters,
    waypointsRef,
    takeoffRef,
    landingRef,
    indexMapRef,
    highlightedIdsRef,
    highlightSeverityRef,
    highlightedInspectionIdRef,
    layerConfigRef,
  ]);

  // sync waypoints ref and re-render layers when waypoints or coords change
  useEffect(() => {
    waypointsRef.current = waypoints;
    const map = mapRef.current;
    if (!map) return;

    const apply = () => addWaypointLayers(map, waypoints ?? undefined, takeoffCoordinate, landingCoordinate);

    if (map.isStyleLoaded()) {
      apply();
      map.triggerRepaint();
    } else {
      // poll until style ready - load event already fired, styledata may not
      let cancelled = false;
      const poll = () => {
        if (cancelled) return;
        if (map.isStyleLoaded()) {
          apply();
          map.triggerRepaint();
        } else {
          requestAnimationFrame(poll);
        }
      };
      requestAnimationFrame(poll);
      return () => { cancelled = true; };
    }
  }, [waypoints, takeoffCoordinate, landingCoordinate, inspectionIndexMap, addWaypointLayers, mapRef, waypointsRef]);

  // hide takeoff/landing waypoint symbols when scope omits them
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    // every remaining scope is airborne-start - operator hand-launches, so the
    // wayline never carries a ground takeoff/landing waypoint to render.
    const show = false;
    const visibility = show ? "visible" : "none";
    try {
      if (map.getLayer(WAYPOINT_TAKEOFF_LAYER))
        map.setLayoutProperty(WAYPOINT_TAKEOFF_LAYER, "visibility", visibility);
      if (map.getLayer(WAYPOINT_LANDING_LAYER))
        map.setLayoutProperty(WAYPOINT_LANDING_LAYER, "visibility", visibility);
    } catch (err) {
      console.warn("failed to update takeoff/landing layer visibility:", err);
    }
  }, [flightPlanScope, waypoints, mapRef]);

  // terrain mode switch
  const handleTerrainChange = useCallback(
    (mode: "map" | "satellite") => {
      appliedTerrainRef.current = mode;
      setTerrainMode(mode);
      const map = mapRef.current;
      if (!map) return;

      const center = map.getCenter();
      const zoom = map.getZoom();
      const bearing = map.getBearing();
      const pitch = map.getPitch();

      layersAddedRef.current = false;
      cancelStylePollRef.current?.();

      // clear measurement and heading tools before style reset
      onMeasureClearRef.current?.();
      onHeadingClearRef.current?.();

      map.setStyle(mode === "satellite" ? makeSatelliteStyle() : makeMapStyle());

      cancelStylePollRef.current = waitForStyleLoaded(map, () => {
        if (!mapRef.current) return;

        map.setCenter(center);
        map.setZoom(zoom);
        map.setBearing(bearing);
        map.setPitch(pitch);

        addAllLayers(map);
        addWaypointLayers(map);

        for (const [key, layerIds] of Object.entries(layerGroupMap)) {
          const visible = layerConfig[key as keyof MapLayerConfig];
          for (const layerId of layerIds) {
            try {
              if (map.getLayer(layerId)) {
                map.setLayoutProperty(
                  layerId,
                  "visibility",
                  visible ? "visible" : "none",
                );
              }
            } catch {
              // layer may not exist yet
            }
          }
        }
      });
    },
    [
      layerConfig,
      addAllLayers,
      addWaypointLayers,
      setTerrainMode,
      mapRef,
      onMeasureClearRef,
      onHeadingClearRef,
    ],
  );

  // sync terrain mode when changed externally (e.g. from parent toggle)
  useEffect(() => {
    if (terrainMode !== appliedTerrainRef.current) {
      appliedTerrainRef.current = terrainMode;
      handleTerrainChange(terrainMode);
    }
  }, [terrainMode, handleTerrainChange]);

  return { addAllLayers, addWaypointLayers, handleTerrainChange };
}
