import { useEffect } from "react";
import type { MutableRefObject } from "react";
import {
  Cartesian3,
  Terrain,
  CesiumTerrainProvider,
  ScreenSpaceEventType,
  ScreenSpaceEventHandler,
  defined,
  Cartesian2,
  Math as CesiumMath,
  Viewer as CesiumViewerType,
  Entity as CesiumEntity,
} from "cesium";
import type { AirportDetailResponse } from "@/types/airport";
import type { WaypointResponse } from "@/types/flightPlan";
import type { PointZ } from "@/types/common";
import type { MapFeature, MapFeatureType } from "@/types/map";
import { flyCesiumToFeature } from "@/hooks/useFocusFeature";
import { pickTerrainConfig } from "../cesiumProviderSelection";
import { isMapFeatureType, lookupFeature } from "./featureLookup";

interface UseCesiumViewerSetupParams {
  viewerRef: MutableRefObject<CesiumViewerType | null>;
  handlerRef: MutableRefObject<ScreenSpaceEventHandler | null>;
  initialized: boolean;
  airport: AirportDetailResponse;
  airportRef: MutableRefObject<AirportDetailResponse>;
  waypointsRef: MutableRefObject<WaypointResponse[]>;
  takeoffCoordRef: MutableRefObject<PointZ | null | undefined>;
  landingCoordRef: MutableRefObject<PointZ | null | undefined>;
  onFeatureClickRef: MutableRefObject<((feature: MapFeature | null) => void) | undefined>;
  onWaypointClickRef: MutableRefObject<((id: string | null) => void) | undefined>;
  onBearingChangeRef: MutableRefObject<((bearing: number) => void) | undefined>;
  onViewerReady?: (viewer: CesiumViewerType) => void;
  selectEntity: (entity: CesiumEntity) => void;
  clearSelection: () => void;
}

/** one-shot viewer setup: depth test, click handlers, terrain, initial fly,
 * bearing listener. mirrors the original CesiumMapViewer init useEffect verbatim
 * - dep array stays [initialized, selectEntity, clearSelection]. */
export function useCesiumViewerSetup({
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
}: UseCesiumViewerSetupParams): void {
  useEffect(() => {
    const viewerMaybe = viewerRef.current;
    if (!initialized || !viewerMaybe || viewerMaybe.isDestroyed()) return;
    // rebind as non-nullable - tsc loses the null guard across nested closures below
    const viewer: CesiumViewerType = viewerMaybe;

    // enable depth test against terrain
    viewer.scene.globe.depthTestAgainstTerrain = true;

    // render at native resolution on retina displays
    viewer.resolutionScale = window.devicePixelRatio;

    // disable viewer's built-in click handler to prevent interference with custom pick
    viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
      ScreenSpaceEventType.LEFT_CLICK,
    );
    viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
      ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
    );

    // load terrain - per-waypoint sampling in CesiumTrajectory uses this provider.
    // closed-network deployments override via VITE_CESIUM_TERRAIN_URL.
    const terrainConfig = pickTerrainConfig(import.meta.env.VITE_CESIUM_TERRAIN_URL);
    if (terrainConfig.kind === "url") {
      viewer.scene.setTerrain(
        new Terrain(CesiumTerrainProvider.fromUrl(terrainConfig.url)),
      );
    } else {
      viewer.scene.setTerrain(Terrain.fromWorldTerrain());
    }

    // fly to airport
    const [lng, lat] = airport.location.coordinates;
    const elevation = airport.elevation ?? 0;
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(lng, lat, elevation + 2000),
      orientation: {
        heading: 0,
        pitch: -0.7854, // -45 degrees
        roll: 0,
      },
    });

    // shared pick + select body for single + double click
    function pickAndSelect(event: { position: Cartesian2 }): MapFeature | null {
      // drillPick penetrates terrain so waypoints rendered via
      // disableDepthTestDistance are clickable even when underground
      const picks = viewer.scene.drillPick(event.position, 5);
      const picked = picks.find((p: { id?: unknown }) => defined(p.id) && (p.id as CesiumEntity).properties);
      if (!picked || !picked.id) {
        clearSelection();
        onWaypointClickRef.current?.(null);
        onFeatureClickRef.current?.(null);
        return null;
      }
      const entity = picked.id as CesiumEntity;
      const props = entity.properties;
      if (!props) {
        selectEntity(entity);
        return null;
      }
      const rawType = props.featureType?.getValue();
      const rawId = props.featureId?.getValue();
      const featureId = typeof rawId === "string" ? rawId : undefined;
      const featureType: MapFeatureType | undefined = isMapFeatureType(rawType) ? rawType : undefined;
      let feature: MapFeature | null = null;
      if (featureType && featureId) {
        feature = lookupFeature(
          airportRef.current,
          featureType,
          featureId,
          waypointsRef.current,
          takeoffCoordRef.current,
          landingCoordRef.current,
        );
        if (featureType === "waypoint") {
          onWaypointClickRef.current?.(featureId);
        }
        if (feature) onFeatureClickRef.current?.(feature);
      }
      selectEntity(entity);
      return feature;
    }

    handlerRef.current = new ScreenSpaceEventHandler(viewer.scene.canvas);
    // single-click: select only, never fly
    handlerRef.current.setInputAction(
      (event: { position: Cartesian2 }) => {
        pickAndSelect(event);
      },
      ScreenSpaceEventType.LEFT_CLICK,
    );

    // double-click: select AND fly to the picked entity
    handlerRef.current.setInputAction(
      (event: { position: Cartesian2 }) => {
        const feature = pickAndSelect(event);
        if (feature) {
          void flyCesiumToFeature(viewer, feature);
        }
      },
      ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
    );

    onViewerReady?.(viewer);

    // track camera heading for compass. cesium's camera.heading is already
    // compass convention (0 = north, pi/2 = east), so a straight rad-to-deg
    // matches maplibre's map.getBearing() semantics used in the 2d path.
    let lastBearing = -999;
    const bearingListener = () => {
      if (viewer.isDestroyed()) return;
      const headingRad = viewer.camera.heading;
      const bearingDeg = (CesiumMath.toDegrees(headingRad) + 360) % 360;
      const rounded = Math.round(bearingDeg * 10) / 10;
      if (rounded !== lastBearing) {
        lastBearing = rounded;
        onBearingChangeRef.current?.(bearingDeg);
      }
    };
    viewer.scene.postRender.addEventListener(bearingListener);

    // propagate initial heading so the compass dial hydrates on 3d entry
    bearingListener();

    return () => {
      clearSelection();
      if (!viewer.isDestroyed()) {
        viewer.scene.postRender.removeEventListener(bearingListener);
      }
      if (handlerRef.current && !handlerRef.current.isDestroyed()) {
        handlerRef.current.destroy();
        handlerRef.current = null;
      }
    };
    // one-shot init - airport/callbacks intentionally excluded via stable refs
  }, [initialized, selectEntity, clearSelection]);
}
