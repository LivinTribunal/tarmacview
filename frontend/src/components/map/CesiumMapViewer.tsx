import { useEffect, useRef, useState, useCallback } from "react";
import { Viewer } from "resium";
import {
  Ion,
  IonImageryProvider,
  UrlTemplateImageryProvider,
  ScreenSpaceEventHandler,
  Viewer as CesiumViewerType,
  Entity as CesiumEntity,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { AirportDetailResponse } from "@/types/airport";
import type { WaypointResponse } from "@/types/flightPlan";
import type { PointZ } from "@/types/common";
import type { MapLayerConfig, MapFeature, FlyAlongState } from "@/types/map";
import type { FlightPlanScope } from "@/types/enums";
import { OSM_TILES } from "@/constants/mapTiles";
import CesiumInfrastructure from "./cesium/CesiumInfrastructure";
import CesiumTrajectory from "./cesium/CesiumTrajectory";
import CesiumFlyAlong from "./cesium/CesiumFlyAlong";
import { pickImageryConfig } from "./cesiumProviderSelection";
import { runDeclutterPass } from "./cesium/runDeclutterPass";
import { useCesiumViewerSetup } from "./cesium/useCesiumViewerSetup";


const EMPTY_WAYPOINTS: WaypointResponse[] = [];

// set ion token from env
const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
if (ionToken) {
  Ion.defaultAccessToken = ionToken;
}

interface CesiumMapViewerProps {
  airport: AirportDetailResponse;
  layers: MapLayerConfig;
  waypoints?: WaypointResponse[];
  selectedWaypointId?: string | null;
  takeoffCoordinate?: PointZ | null;
  landingCoordinate?: PointZ | null;
  flightPlanScope?: FlightPlanScope | null;
  visibleInspectionIds?: Set<string>;
  inspectionIndexMap?: Record<string, number>;
  terrainMode: "map" | "satellite";
  onFeatureClick?: (feature: MapFeature | null) => void;
  onWaypointClick?: (id: string | null) => void;
  onBearingChange?: (bearing: number) => void;
  onViewerReady?: (viewer: CesiumViewerType) => void;
  focusFeature?: MapFeature | null;
  highlightedWaypointIds?: string[] | null;
  flyAlongState?: FlyAlongState | null;
  flyAlongModelUrl?: string;
  flyAlongSegmentDurations?: number[];
  flyAlongSetProgress?: (progress: number) => void;
  flyAlongOnComplete?: () => void;
}

/** 3d globe visualization using cesiumjs with terrain, infrastructure, and trajectory rendering. */
export default function CesiumMapViewer({
  airport,
  layers,
  waypoints = EMPTY_WAYPOINTS,
  selectedWaypointId,
  takeoffCoordinate,
  landingCoordinate,
  flightPlanScope,
  visibleInspectionIds,
  inspectionIndexMap,
  terrainMode,
  onFeatureClick,
  onWaypointClick,
  onBearingChange,
  onViewerReady,
  focusFeature,
  highlightedWaypointIds,
  flyAlongState,
  flyAlongModelUrl,
  flyAlongSegmentDurations,
  flyAlongSetProgress,
  flyAlongOnComplete,
}: CesiumMapViewerProps) {
  const viewerRef = useRef<CesiumViewerType | null>(null);
  const handlerRef = useRef<ScreenSpaceEventHandler | null>(null);
  const [initialized, setInitialized] = useState(false);
  // selected feature id for declarative highlight overlay
  const [selectedFeatureKey, setSelectedFeatureKey] = useState<string | null>(null);

  // keep callbacks in refs to avoid stale closures in the click handler
  const onFeatureClickRef = useRef(onFeatureClick);
  onFeatureClickRef.current = onFeatureClick;
  const onWaypointClickRef = useRef(onWaypointClick);
  onWaypointClickRef.current = onWaypointClick;
  const onBearingChangeRef = useRef(onBearingChange);
  onBearingChangeRef.current = onBearingChange;
  const airportRef = useRef(airport);
  airportRef.current = airport;
  const waypointsRef = useRef(waypoints);
  waypointsRef.current = waypoints;
  const takeoffCoordRef = useRef(takeoffCoordinate);
  takeoffCoordRef.current = takeoffCoordinate;
  const landingCoordRef = useRef(landingCoordinate);
  landingCoordRef.current = landingCoordinate;

  // stable ref callback - only initializes once
  const viewerRefCallback = useCallback(
    (ref: { cesiumElement?: CesiumViewerType } | null) => {
      const viewer = ref?.cesiumElement;
      if (!viewer || viewerRef.current === viewer) return;
      viewerRef.current = viewer;
      setInitialized(true);
    },
    [],
  );

  /** clear selection state. */
  const clearSelection = useCallback(() => {
    setSelectedFeatureKey(null);
  }, []);

  /** select a feature by building a key from its entity properties. */
  const selectEntity = useCallback((entity: CesiumEntity) => {
    const props = entity.properties;
    if (!props) {
      setSelectedFeatureKey(null);
      return;
    }
    const fType = props.featureType?.getValue();
    const fId = props.featureId?.getValue();
    if (fType && fId) {
      setSelectedFeatureKey(`${fType}:${fId}`);
    }
  }, []);

  useCesiumViewerSetup({
    viewerRef,
    handlerRef,
    initialized,
    airport,
    airportRef,
    waypointsRef,
    takeoffCoordRef,
    landingCoordRef,
    onFeatureClickRef,
    onWaypointClickRef,
    onBearingChangeRef,
    onViewerReady,
    selectEntity,
    clearSelection,
  });

  // run a screen-space label declutter pass on postRender. cesium has no built-in
  // symbol collision (unlike maplibre's text-allow-overlap), so without this,
  // clustered obstacles, overlapping safety zones, and stacked waypoints render
  // as illegible glyph stacks. throttled to ~10 hz and gated on actual camera
  // movement so idle frames skip the o(n^2) projection.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!initialized || !viewer || viewer.isDestroyed()) return;

    let lastRunMs = 0;
    const MIN_INTERVAL_MS = 100;
    let lastHeading = NaN;
    let lastPitch = NaN;
    let lastX = NaN;
    let lastY = NaN;
    let lastZ = NaN;
    let lastEntityCount = -1;

    const declutterListener = () => {
      if (viewer.isDestroyed()) return;
      const now = performance.now();
      if (now - lastRunMs < MIN_INTERVAL_MS) return;

      const cam = viewer.camera;
      const pos = cam.positionWC;
      // re-run when camera moved/rotated, when entity counts changed, or when a
      // forced pass is needed (initial mount, selection change).
      let entityCount = viewer.entities.values.length;
      for (let i = 0; i < viewer.dataSources.length; i++) {
        entityCount += viewer.dataSources.get(i).entities.values.length;
      }
      const moved =
        cam.heading !== lastHeading ||
        cam.pitch !== lastPitch ||
        pos.x !== lastX ||
        pos.y !== lastY ||
        pos.z !== lastZ ||
        entityCount !== lastEntityCount;
      if (!moved) return;

      lastHeading = cam.heading;
      lastPitch = cam.pitch;
      lastX = pos.x;
      lastY = pos.y;
      lastZ = pos.z;
      lastEntityCount = entityCount;
      lastRunMs = now;
      runDeclutterPass(viewer, selectedFeatureKey);
    };
    viewer.scene.postRender.addEventListener(declutterListener);

    return () => {
      if (!viewer.isDestroyed()) {
        viewer.scene.postRender.removeEventListener(declutterListener);
      }
    };
  }, [initialized, selectedFeatureKey]);

  // switch imagery based on terrain mode
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    let cancelled = false;
    const imageryLayers = viewer.imageryLayers;
    imageryLayers.removeAll();

    if (terrainMode === "satellite") {
      // closed-network deployments override via VITE_CESIUM_IMAGERY_URL.
      const imageryConfig = pickImageryConfig(import.meta.env.VITE_CESIUM_IMAGERY_URL);
      if (imageryConfig.kind === "url") {
        imageryLayers.addImageryProvider(
          new UrlTemplateImageryProvider({ url: imageryConfig.url }),
        );
      } else {
        IonImageryProvider.fromAssetId(2)
          .then((provider) => {
            if (cancelled || viewer.isDestroyed()) return;
            imageryLayers.addImageryProvider(provider);
          })
          .catch((e) =>
            console.error("ion imagery failed:", e instanceof Error ? e.message : String(e)),
          );
      }
    } else {
      const osmProvider = new UrlTemplateImageryProvider({
        url: OSM_TILES,
        maximumLevel: 19,
      });
      imageryLayers.addImageryProvider(osmProvider);
    }

    return () => {
      cancelled = true;
    };
  }, [terrainMode]);

  // highlight the focused feature. fly is a separate intent dispatched
  // by the parent's imperative locateFeature() handle.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!initialized || !viewer || viewer.isDestroyed()) return;
    if (!focusFeature) {
      setSelectedFeatureKey(null);
      return;
    }
    setSelectedFeatureKey(`${focusFeature.type}:${focusFeature.data.id}`);
  }, [focusFeature, initialized]);

  return (
    <Viewer
      ref={viewerRefCallback}
      full
      timeline={false}
      animation={false}
      homeButton={false}
      geocoder={false}
      baseLayerPicker={false}
      fullscreenButton={false}
      navigationHelpButton={false}
      sceneModePicker={false}
      selectionIndicator={false}
      infoBox={false}
      vrButton={false}
    >
      <CesiumInfrastructure
        airport={airport}
        layers={layers}
        selectedFeatureKey={selectedFeatureKey}
      />
      {waypoints.length > 0 && (
        <CesiumTrajectory
          waypoints={waypoints}
          layers={layers}
          selectedWaypointId={selectedWaypointId}
          takeoffCoordinate={takeoffCoordinate}
          landingCoordinate={landingCoordinate}
          flightPlanScope={flightPlanScope}
          visibleInspectionIds={visibleInspectionIds}
          inspectionIndexMap={inspectionIndexMap}
          showSimplified={layers.simplifiedTrajectory}
          highlightedWaypointIds={highlightedWaypointIds}
        />
      )}
      {flyAlongState &&
        flyAlongState.status !== "idle" &&
        flyAlongModelUrl &&
        flyAlongSegmentDurations &&
        flyAlongSetProgress &&
        flyAlongOnComplete &&
        waypoints.length >= 2 && (
          <CesiumFlyAlong
            viewer={viewerRef.current}
            waypoints={waypoints}
            segmentDurations={flyAlongSegmentDurations}
            flyAlongState={flyAlongState}
            modelUrl={flyAlongModelUrl}
            setProgress={flyAlongSetProgress}
            onComplete={flyAlongOnComplete}
          />
        )}
    </Viewer>
  );
}
