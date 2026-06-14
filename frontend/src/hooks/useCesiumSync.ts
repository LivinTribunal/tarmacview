import { useCallback, useRef } from "react";
import type maplibregl from "maplibre-gl";
import {
  maplibreToCesiumCamera,
  cesiumToMaplibreCamera,
} from "@/components/map/cesium/cesiumUtils";
import type { Viewer as CesiumViewer } from "cesium";

// minimum gap between consecutive camera syncs - debounces the rapid
// 2d<->3d toggle so the two viewers don't fight each other mid-animation
const SYNC_THROTTLE_MS = 100;

// fallback container height when the map element hasn't been measured yet
const DEFAULT_VIEWPORT_HEIGHT_PX = 800;

interface UseCesiumSyncReturn {
  /** sync camera from maplibre to cesium when switching to 3d. */
  syncToCesium: (viewer: CesiumViewer) => void;
  /** sync camera from cesium to maplibre when switching to 2d. */
  syncToMaplibre: (viewer: CesiumViewer) => void;
}

/** hook for synchronizing camera state between maplibre and cesium viewers. */
export default function useCesiumSync(
  mapRef: React.RefObject<maplibregl.Map | null>,
): UseCesiumSyncReturn {
  const lastSyncToCesiumRef = useRef<number>(0);
  const lastSyncToMaplibreRef = useRef<number>(0);

  const syncToCesium = useCallback(
    (viewer: CesiumViewer) => {
      const map = mapRef.current;
      if (!map) return;
      const now = Date.now();
      if (now - lastSyncToCesiumRef.current < SYNC_THROTTLE_MS) return;
      lastSyncToCesiumRef.current = now;

      const center = map.getCenter();
      const zoom = map.getZoom();
      const bearing = map.getBearing();
      const pitch = map.getPitch();
      const viewportHeight =
        map.getContainer().clientHeight || DEFAULT_VIEWPORT_HEIGHT_PX;

      const { destination, orientation } = maplibreToCesiumCamera(
        center,
        zoom,
        bearing,
        pitch,
        viewportHeight,
      );

      viewer.camera.setView({ destination, orientation });
    },
    [mapRef],
  );

  const syncToMaplibre = useCallback(
    (viewer: CesiumViewer) => {
      const map = mapRef.current;
      if (!map) return;
      const now = Date.now();
      if (now - lastSyncToMaplibreRef.current < SYNC_THROTTLE_MS) return;
      lastSyncToMaplibreRef.current = now;

      const camera = viewer.camera;
      const viewportHeight =
        map.getContainer().clientHeight || DEFAULT_VIEWPORT_HEIGHT_PX;
      const result = cesiumToMaplibreCamera(
        camera.position,
        camera.heading,
        camera.pitch,
        viewportHeight,
      );

      map.jumpTo({
        center: [result.center.lng, result.center.lat],
        zoom: result.zoom,
        bearing: result.bearing,
        pitch: result.pitch,
      });
    },
    [mapRef],
  );

  return { syncToCesium, syncToMaplibre };
}
