import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getSavedViewport, saveViewport, getSavedLayers, saveLayers, buildInitialLayerConfig } from "@/hooks/useMapViewport";
import type { MapViewportState } from "@/hooks/useMapViewport";
import type { AirportMapProps, MapFeature, MapLayerConfig } from "@/types/map";
import useCesiumSync from "@/hooks/useCesiumSync";
import { flyMapLibreToFeature, flyCesiumToFeature } from "@/hooks/useFocusFeature";
import { MapTool } from "@/hooks/useMapTools";
import Cesium3DOverlay from "./Cesium3DOverlay";
import LegendPanel from "./overlays/LegendPanel";
import MapHelpPanel from "./overlays/MapHelpPanel";
import MapLeftPanelCluster from "./overlays/MapLeftPanelCluster";
import MapViewportControls from "./MapViewportControls";
import {
  MAP_PITCH_2D,
  MAP_PITCH_3D,
  MAP_PITCH_TOGGLE_DURATION_MS,
  MAP_BEARING_RESET_DURATION_MS,
  MAP_PAN_DURATION_MS,
  MAP_ZOOM_INITIAL_DEFAULT,
} from "@/constants/mapAnimations";
import { makeSatelliteStyle } from "./mapStyles";
import { useMeasureTool } from "./hooks/useMeasureTool";
import { useHeadingTool } from "./hooks/useHeadingTool";
import { useWaypointDragTool } from "./hooks/useWaypointDragTool";
import { useInfraDragTool } from "./hooks/useInfraDragTool";
import { useZoomTool } from "./hooks/useZoomTool";
import { useMapHighlightLayers } from "./hooks/useMapHighlightLayers";
import { usePickAndSelect } from "./hooks/usePickAndSelect";
import { useMapLayerSync } from "./hooks/useMapLayerSync";
import { useMapBootstrap, PENDING_PREVIEW_SOURCE } from "./hooks/useMapBootstrap";
import { layerGroupMap, INTERACTIVE_LAYERS, POINTER_LAYERS, TOOL_CURSORS } from "./mapLayerGroups";

export interface AirportMapHandle {
  /** get the underlying maplibre-gl map instance. */
  getMap: () => maplibregl.Map | null;
  /** imperatively recenter on a feature using the shared intent router. */
  locateFeature: (feature: MapFeature) => void;
}

/** interactive 2D MapLibre / 3D Cesium airport map with layer, tool, and trajectory rendering. */
const AirportMap = forwardRef<AirportMapHandle, AirportMapProps & {
  activeTool?: MapTool;
  vertexEditTool?: MapTool;
  pendingGeometry?: GeoJSON.Polygon | null;
  pendingPointPosition?: [number, number] | null;
}>(function AirportMap({
  airport,
  layers: layersProp,
  interactive = true,
  showLayerPanel = true,
  showLegend = true,
  showPoiInfo = true,
  showWaypointList = true,
  simplifiedTrajectory = false,
  onFeatureClick,
  children,
  waypoints,
  selectedWaypointId,
  onWaypointClick,
  terrainMode: terrainModeProp,
  onTerrainChange: onTerrainChangeProp,
  missionStatus,
  onMapClick,
  takeoffCoordinate,
  landingCoordinate,
  inspectionIndexMap,
  visibleInspectionIds,
  onLayerChange,
  leftPanelChildren,
  useTakeoffAsLanding,
  activeTool,
  vertexEditTool,
  onPlaceTakeoff,
  onPlaceLanding,
  measureData,
  onMeasureClear,
  onMeasureFinish,
  onMeasureMouseMove,
  isMeasureDrawing,
  headingData,
  onHeadingClear,
  headingOrigin,
  isHeadingDrawing,
  onWaypointDrag,
  onTransitInsert,
  onTransitDelete,
  onInfraPointDrag,
  zoomPercent,
  onZoomChange,
  focusFeature,
  focusLhaIds,
  showZoomControls = true,
  showCompass = true,
  showHelpPanel = true,
  helpVariant = "full",
  is3D: is3DProp,
  onBearingChange,
  bearingResetKey,
  highlightedWaypointIds,
  highlightSeverity,
  highlightedInspectionId,
  selectedWarning,
  onWarningClose,
  pendingGeometry,
  pendingPointPosition,
  flightPlanScope,
  flyAlongState,
  flyAlongModelUrl,
  flyAlongSegmentDurations,
  flyAlongSetProgress,
  flyAlongOnComplete,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const suppressZoomEndRef = useRef(false);
  const waypointsRef = useRef(waypoints);
  const takeoffRef = useRef(takeoffCoordinate);
  takeoffRef.current = takeoffCoordinate;
  const landingRef = useRef(landingCoordinate);
  landingRef.current = landingCoordinate;
  const useTakeoffAsLandingRef = useRef(useTakeoffAsLanding);
  useTakeoffAsLandingRef.current = useTakeoffAsLanding;
  const indexMapRef = useRef(inspectionIndexMap);
  indexMapRef.current = inspectionIndexMap;
  const highlightedIdsRef = useRef(highlightedWaypointIds);
  highlightedIdsRef.current = highlightedWaypointIds;
  const highlightSeverityRef = useRef(highlightSeverity);
  highlightSeverityRef.current = highlightSeverity;
  const highlightedInspectionIdRef = useRef(highlightedInspectionId);
  highlightedInspectionIdRef.current = highlightedInspectionId;

  // cesium viewer ref (declared early so imperative handle can route 3d locates)
  const cesiumViewerRef = useRef<import("cesium").Viewer | null>(null);
  // tracks active 2d/3d mode for the imperative handle, since the cesium viewer
  // is kept alive (display:none) when toggling back to 2d and isDestroyed()
  // alone would still route locates to the hidden 3d camera.
  const is3DRef = useRef(false);

  useImperativeHandle(ref, () => ({
    getMap: () => mapRef.current,
    locateFeature: (feature: MapFeature) => {
      const viewer = cesiumViewerRef.current;
      if (is3DRef.current && viewer && !viewer.isDestroyed()) {
        void flyCesiumToFeature(viewer, feature);
        return;
      }
      const map = mapRef.current;
      if (map) flyMapLibreToFeature(map, feature);
    },
  }), []);

  const [layerConfig, setLayerConfig] = useState<MapLayerConfig>(() =>
    buildInitialLayerConfig(getSavedLayers(airport.id), layersProp, simplifiedTrajectory),
  );
  const layerConfigRef = useRef(layerConfig);
  layerConfigRef.current = layerConfig;

  useEffect(() => {
    onLayerChange?.(layerConfig);
    saveLayers(airport.id, layerConfig);
  }, [layerConfig, onLayerChange, airport.id]);
  const visibleInspectionIdsRef = useRef(visibleInspectionIds);
  visibleInspectionIdsRef.current = visibleInspectionIds;
  const [internalTerrainMode, setInternalTerrainMode] = useState<"map" | "satellite">(
    "satellite",
  );
  const terrainMode = terrainModeProp ?? internalTerrainMode;
  const setTerrainMode = onTerrainChangeProp ?? setInternalTerrainMode;

  const [selectedFeature, setSelectedFeature] = useState<MapFeature | null>(
    null,
  );

  const [bearing, setBearing] = useState(() => getSavedViewport(airport.id)?.bearing ?? 0);
  const [internalIs3D] = useState(false);
  const is3D = is3DProp ?? internalIs3D;
  is3DRef.current = is3D;

  // cesium 3d viewer state (ref declared above alongside imperative handle)
  const [cesiumLoaded, setCesiumLoaded] = useState(false);
  const { syncToCesium, syncToMaplibre } = useCesiumSync(mapRef);

  const prevIs3DRef = useRef(is3D);

  // load cesium on first 3d toggle, sync cameras on switch
  useEffect(() => {
    if (is3D && !cesiumLoaded) {
      setCesiumLoaded(true);
    }
    if (is3D && cesiumViewerRef.current) {
      syncToCesium(cesiumViewerRef.current);
    }
    if (!is3D && prevIs3DRef.current && cesiumViewerRef.current) {
      syncToMaplibre(cesiumViewerRef.current);
    }
    prevIs3DRef.current = is3D;
  }, [is3D, cesiumLoaded, syncToCesium, syncToMaplibre]);

  // track map bearing for compass
  const onBearingChangeRef = useRef(onBearingChange);
  onBearingChangeRef.current = onBearingChange;

  // build a MapFeature for a waypoint id (including standalone takeoff/landing)
  const buildWaypointFeatureFromId = useCallback(
    (wpId: string): MapFeature | null => {
      if (wpId === "takeoff" && takeoffCoordinate) {
        const [lon, lat, alt] = takeoffCoordinate.coordinates;
        return {
          type: "waypoint",
          data: {
            id: "takeoff",
            waypoint_type: "TAKEOFF",
            sequence_order: 0,
            position: { type: "Point", coordinates: [lon, lat, alt] },
            stack_count: 1,
          },
        };
      }
      if (wpId === "landing" && landingCoordinate) {
        const [lon, lat, alt] = landingCoordinate.coordinates;
        return {
          type: "waypoint",
          data: {
            id: "landing",
            waypoint_type: "LANDING",
            sequence_order: 0,
            position: { type: "Point", coordinates: [lon, lat, alt] },
            stack_count: 1,
          },
        };
      }
      const wp = waypoints?.find((w) => w.id === wpId);
      if (!wp) return null;
      const [lon, lat, alt] = wp.position.coordinates;
      return {
        type: "waypoint",
        data: {
          id: wp.id,
          waypoint_type: wp.waypoint_type,
          sequence_order: wp.sequence_order,
          position: { type: "Point", coordinates: [lon, lat, alt] },
          stack_count: 1,
          heading: wp.heading ?? null,
          speed: wp.speed ?? null,
          camera_action: wp.camera_action ?? null,
          camera_target: wp.camera_target ?? null,
          gimbal_pitch: wp.gimbal_pitch ?? null,
          hover_duration: wp.hover_duration ?? null,
          agl: wp.agl ?? null,
          camera_target_agl: wp.camera_target_agl ?? null,
        },
      };
    },
    [waypoints, takeoffCoordinate, landingCoordinate],
  );

  // single-click on a waypoint list row: select only, no fly.
  const handleWaypointListSelect = useCallback(
    (wpId: string | null) => {
      onWaypointClick?.(wpId);
      if (!wpId) {
        setSelectedFeature(null);
        return;
      }
      const feature = buildWaypointFeatureFromId(wpId);
      if (feature) setSelectedFeature(feature);
    },
    [onWaypointClick, buildWaypointFeatureFromId],
  );

  // double-click on a waypoint list row: select + recenter. routes to cesium
  // when 3d is live, otherwise to the maplibre map. gate on is3DRef so we don't
  // route to a hidden cesium viewer that's still alive after a 3d->2d toggle.
  const handleWaypointListLocate = useCallback(
    (wpId: string) => {
      onWaypointClick?.(wpId);
      const feature = buildWaypointFeatureFromId(wpId);
      if (!feature) return;
      setSelectedFeature(feature);
      const viewer = cesiumViewerRef.current;
      if (is3DRef.current && viewer && !viewer.isDestroyed()) {
        void flyCesiumToFeature(viewer, feature);
        return;
      }
      const map = mapRef.current;
      if (map) flyMapLibreToFeature(map, feature);
    },
    [onWaypointClick, buildWaypointFeatureFromId],
  );

  // apply 3D pitch toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      pitch: is3D ? MAP_PITCH_3D : MAP_PITCH_2D,
      duration: MAP_PITCH_TOGGLE_DURATION_MS,
    });
  }, [is3D]);

  // highlight the focused feature on the map. fly is a separate intent
  // dispatched via the imperative locateFeature() handle, which routes to the
  // active map (cesium when 3d is live, maplibre otherwise).
  // refs let addAllLayers re-sync after layers exist (the effect alone fires
  // before highlight layers are added on first render and silently no-ops).
  const focusFeatureRef = useRef(focusFeature ?? null);
  focusFeatureRef.current = focusFeature ?? null;
  const focusLhaIdsRef = useRef(focusLhaIds ?? null);
  focusLhaIdsRef.current = focusLhaIds ?? null;

  useMapHighlightLayers({
    mapRef,
    focusFeature,
    focusLhaIds,
    selectedWaypointId,
    highlightedInspectionId,
    highlightedWaypointIds,
    highlightSeverity,
    simplifiedTrajectory: layerConfig.simplifiedTrajectory,
    setSelectedFeature,
    waypointsRef,
  });

  // sync pending creation preview geometry
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource(PENDING_PREVIEW_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const features: GeoJSON.Feature[] = [];
    if (pendingGeometry) {
      features.push({ type: "Feature", properties: {}, geometry: pendingGeometry });
    }
    if (pendingPointPosition) {
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: pendingPointPosition },
      });
    }
    src.setData({ type: "FeatureCollection", features });
  }, [pendingGeometry, pendingPointPosition]);

  // apply cursor based on active tool
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cursor = TOOL_CURSORS[activeTool ?? MapTool.SELECT] ?? "";
    map.getCanvas().style.cursor = cursor;
  }, [activeTool]);

  // dragPan invariant:
  // - always enabled by default for every tool, so empty-canvas drag pans the map
  //   even when MOVE_WAYPOINT / MOVE_FEATURE is active (this effect)
  // - disabled on mousedown over a draggable feature, re-enabled on mouseup -
  //   waypoint drag in useWaypointDragTool, infra-point drag in useInfraDragTool
  // regression guard: browser-verify (no jsdom unit test - maplibre dragPan
  // behavior is not exercisable without a real GL canvas).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !interactive) return;
    map.dragPan.enable();
    return () => {
      if (map.dragPan) map.dragPan.enable();
    };
  }, [activeTool, interactive]);

  useMeasureTool({
    mapRef,
    activeTool,
    isMeasureDrawing,
    onMeasureClear,
    onMeasureFinish,
    onMeasureMouseMove,
    measureData,
  });

  // refs for tool clear callbacks (used in terrain change without adding to deps)
  const onMeasureClearRef = useRef(onMeasureClear);
  onMeasureClearRef.current = onMeasureClear;
  const onHeadingClearRef = useRef(onHeadingClear);
  onHeadingClearRef.current = onHeadingClear;

  useHeadingTool({
    mapRef,
    activeTool,
    onHeadingClear,
    headingOrigin,
    isHeadingDrawing,
    headingData,
  });

  useWaypointDragTool({
    mapRef,
    activeTool,
    interactive,
    onWaypointDrag,
    waypointsRef,
    takeoffRef,
    landingRef,
    useTakeoffAsLandingRef,
    indexMapRef,
    toolCursors: TOOL_CURSORS,
  });

  useZoomTool({
    mapRef,
    activeTool,
    interactive,
    zoomPercent,
    suppressZoomEndRef,
  });

  // report map zoom changes back to parent
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  // initialize map - no navigation control (removed old zoom/compass)
  useEffect(() => {
    if (!containerRef.current) return;

    const [lon, lat] = airport.location.coordinates;
    const saved = getSavedViewport(airport.id);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: makeSatelliteStyle(),
      center: saved?.center ?? [lon, lat],
      zoom: saved?.zoom ?? MAP_ZOOM_INITIAL_DEFAULT,
      bearing: saved?.bearing ?? 0,
      pitch: saved?.pitch ?? MAP_PITCH_2D,
      interactive,
      attributionControl: false,
    });

    mapRef.current = map;

    // propagate initial bearing so parent-owned compasses hydrate on first paint
    onBearingChangeRef.current?.(map.getBearing());

    // track bearing for compass
    function handleRotate() {
      const b = map.getBearing();
      setBearing(b);
      onBearingChangeRef.current?.(b);
    }
    map.on("rotate", handleRotate);

    // report zoom changes back to parent
    function handleZoom() {
      if (suppressZoomEndRef.current) return;
      const currentZoom = map.getZoom();
      const percent = Math.round((currentZoom / 14.5) * 100);
      onZoomChangeRef.current?.(percent);
    }
    function handleZoomEnd() {
      suppressZoomEndRef.current = false;
    }
    map.on("zoom", handleZoom);
    map.on("zoomend", handleZoomEnd);

    // persist viewport on move
    let viewportTimer: ReturnType<typeof setTimeout> | null = null;
    function handleMoveEnd() {
      if (viewportTimer) clearTimeout(viewportTimer);
      viewportTimer = setTimeout(() => {
        const center = map.getCenter();
        const state: MapViewportState = {
          center: [center.lng, center.lat],
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        };
        saveViewport(airport.id, state);
      }, 300);
    }
    map.on("moveend", handleMoveEnd);

    return () => {
      map.off("rotate", handleRotate);
      map.off("zoom", handleZoom);
      map.off("zoomend", handleZoomEnd);
      map.off("moveend", handleMoveEnd);
      if (viewportTimer) clearTimeout(viewportTimer);
      map.remove();
      mapRef.current = null;
    };
  }, [airport.id, interactive]);

  // reset bearing when bearingResetKey changes (covers both 2D maplibre and 3D cesium)
  useEffect(() => {
    if (bearingResetKey === undefined || bearingResetKey === 0) return;
    if (is3D && cesiumViewerRef.current && !cesiumViewerRef.current.isDestroyed()) {
      // Camera.flyTo cancels when destination equals current position, so the
      // orientation-only reset never fires - setView is instant and reliable.
      const cam = cesiumViewerRef.current.camera;
      cam.setView({
        destination: cam.positionWC,
        orientation: { heading: 0, pitch: cam.pitch, roll: 0 },
      });
      return;
    }
    const map = mapRef.current;
    if (map) map.easeTo({ bearing: 0, duration: MAP_BEARING_RESET_DURATION_MS });
  }, [bearingResetKey, is3D]);

  const { syncInspectionFilters, syncLayerVisibility, handleLayerToggle } = useMapLayerSync({
    mapRef,
    airport,
    layerConfig,
    layerConfigRef,
    visibleInspectionIds,
    visibleInspectionIdsRef,
    setLayerConfig,
    layerGroupMap,
  });

  useMapBootstrap({
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
  });

  useInfraDragTool({
    mapRef,
    activeTool,
    vertexEditTool,
    interactive,
    onInfraPointDrag,
  });

  usePickAndSelect({
    mapRef,
    interactive,
    activeTool,
    airport,
    onFeatureClick,
    onWaypointClick,
    selectedWaypointId,
    onMapClick,
    onTransitInsert,
    onTransitDelete,
    setSelectedFeature,
    waypointsRef,
    interactiveLayers: INTERACTIVE_LAYERS,
    pointerLayers: POINTER_LAYERS,
    toolCursors: TOOL_CURSORS,
  });

  // wasd / arrow key navigation
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !interactive) return;

    const PAN_STEP = 80;
    const keyMap: Record<string, [number, number]> = {
      ArrowUp: [0, -PAN_STEP],
      ArrowLeft: [-PAN_STEP, 0],
      ArrowDown: [0, PAN_STEP],
      ArrowRight: [PAN_STEP, 0],
    };

    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const delta = keyMap[e.key];
      if (delta && map) {
        e.preventDefault();
        map.panBy(delta, { duration: MAP_PAN_DURATION_MS });
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [interactive]);

  return (
    <div
      className="relative h-full w-full rounded-2xl overflow-hidden"
      style={{ backgroundColor: "var(--tv-map-bg)" }}
      data-testid="airport-map"
    >
      <div ref={containerRef} className="h-full w-full" style={{ display: is3D ? "none" : "block" }} />

      {/* cesium 3d viewer - lazy loaded on first 3d toggle */}
      <Cesium3DOverlay
        cesiumLoaded={cesiumLoaded}
        is3D={is3D}
        airport={airport}
        layers={layerConfig}
        waypoints={waypoints}
        selectedWaypointId={selectedWaypointId}
        takeoffCoordinate={takeoffCoordinate}
        landingCoordinate={landingCoordinate}
        flightPlanScope={flightPlanScope}
        visibleInspectionIds={visibleInspectionIds}
        inspectionIndexMap={inspectionIndexMap}
        terrainMode={terrainMode}
        onFeatureClick={setSelectedFeature}
        onWaypointClick={onWaypointClick}
        onBearingChange={(b) => {
          setBearing(b);
          onBearingChangeRef.current?.(b);
        }}
        onViewerReady={(viewer) => {
          cesiumViewerRef.current = viewer;
          syncToCesium(viewer);
        }}
        focusFeature={focusFeature}
        highlightedWaypointIds={highlightedWaypointIds}
        flyAlongState={flyAlongState}
        flyAlongModelUrl={flyAlongModelUrl}
        flyAlongSegmentDurations={flyAlongSegmentDurations}
        flyAlongSetProgress={flyAlongSetProgress}
        flyAlongOnComplete={flyAlongOnComplete}
      />

      {/* top-left: layers, waypoints, poi info */}
      <MapLeftPanelCluster
        airport={airport}
        layerConfig={layerConfig}
        onLayerToggle={handleLayerToggle}
        waypoints={waypoints}
        selectedWaypointId={selectedWaypointId}
        onWaypointSelect={handleWaypointListSelect}
        onWaypointLocate={handleWaypointListLocate}
        visibleInspectionIds={visibleInspectionIds}
        inspectionIndexMap={inspectionIndexMap}
        takeoffCoordinate={takeoffCoordinate}
        landingCoordinate={landingCoordinate}
        selectedFeature={selectedFeature}
        onCloseSelectedFeature={() => setSelectedFeature(null)}
        selectedWarning={selectedWarning}
        onWarningClose={onWarningClose}
        showLayerPanel={showLayerPanel}
        showWaypointList={showWaypointList}
        showPoiInfo={showPoiInfo}
        onPlaceTakeoff={onPlaceTakeoff}
        onPlaceLanding={onPlaceLanding}
        leftPanelChildren={leftPanelChildren}
      />

      {/* top-right: legend */}
      {showLegend && (
        <LegendPanel
          missionStatus={missionStatus}
          hasTakeoff={!!takeoffCoordinate}
          hasLanding={!!landingCoordinate}
          layers={layerConfig}
        />
      )}

      {/* bottom-left: map help */}
      {showHelpPanel && (
        <div className="absolute bottom-3 left-3 z-10">
          <MapHelpPanel variant={helpVariant} />
        </div>
      )}

      {/* right side: compass + zoom controls */}
      <MapViewportControls
        mapRef={mapRef}
        cesiumViewerRef={cesiumViewerRef}
        is3D={is3D}
        bearing={bearing}
        showCompass={showCompass}
        showZoomControls={showZoomControls}
      />

      {children}
    </div>
  );
});

export default AirportMap;
