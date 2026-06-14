import { useCallback } from "react";
import type { RefObject } from "react";
import type maplibregl from "maplibre-gl";
import type { Viewer as CesiumViewerType } from "cesium";
import type { MapFeature } from "@/types/map";
import { MAP_QUICK_DURATION_MS } from "@/constants/mapAnimations";

/** compute a lon/lat center and target maplibre zoom for a feature. */
export function computeMapLibreFocus(
  feature: MapFeature,
): { lon: number; lat: number; minZoom: number } | null {
  let lon: number | undefined;
  let lat: number | undefined;
  let minZoom = 16;

  if (feature.type === "waypoint") {
    const coords = feature.data.position?.coordinates;
    if (coords) {
      [lon, lat] = coords;
    }
    minZoom = 17;
  } else if (feature.type === "obstacle") {
    const ring = feature.data.boundary?.coordinates?.[0];
    if (ring && ring.length > 0) {
      lon = ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length;
      lat = ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length;
    }
  } else if (feature.type === "agl") {
    [lon, lat] = feature.data.position.coordinates;
  } else if (feature.type === "lha") {
    [lon, lat] = feature.data.position.coordinates;
    minZoom = 18;
  } else if (feature.type === "surface") {
    const coords = feature.data.geometry.coordinates;
    if (coords.length > 0) {
      lon = coords.reduce((s: number, c: number[]) => s + c[0], 0) / coords.length;
      lat = coords.reduce((s: number, c: number[]) => s + c[1], 0) / coords.length;
    }
  } else if (feature.type === "safety_zone") {
    const ring = feature.data.geometry?.coordinates?.[0];
    if (ring && ring.length > 0) {
      lon = ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length;
      lat = ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length;
    }
  }

  if (lon === undefined || lat === undefined) return null;
  return { lon, lat, minZoom };
}

/** fly a maplibre map to the center of a feature. */
export function flyMapLibreToFeature(map: maplibregl.Map, feature: MapFeature): void {
  const focus = computeMapLibreFocus(feature);
  if (!focus) return;
  // defer to the next microtask so we run after maplibre's HandlerManager
  // finishes processing the current input event. otherwise, when called from
  // inside a map event listener (e.g. dblclick), HandlerManager calls
  // map._stop(true) at the end of the event loop and cancels our animation
  // before the first frame.
  queueMicrotask(() => {
    map.flyTo({
      center: [focus.lon, focus.lat],
      zoom: Math.max(map.getZoom(), focus.minZoom),
      duration: MAP_QUICK_DURATION_MS,
      essential: true,
    });
  });
}

/** cesium camera range (meters) for a feature type. */
export function cesiumRangeForFeature(feature: MapFeature): number {
  if (feature.type === "obstacle") return 350;
  if (feature.type === "agl" || feature.type === "lha") return 250;
  if (feature.type === "surface") return 1000;
  return 600;
}

/** extract a representative altitude (meters MSL) from a feature, or 0 if none. */
export function computeFeatureAltitude(feature: MapFeature): number {
  if (feature.type === "waypoint") {
    return feature.data.position?.coordinates?.[2] ?? 0;
  }
  if (feature.type === "agl" || feature.type === "lha") {
    return feature.data.position?.coordinates?.[2] ?? 0;
  }
  if (feature.type === "obstacle") {
    const ring = feature.data.boundary?.coordinates?.[0];
    if (ring && ring.length > 0) {
      return ring.reduce((s: number, c: number[]) => s + (c[2] ?? 0), 0) / ring.length;
    }
  }
  if (feature.type === "surface") {
    const coords = feature.data.geometry?.coordinates;
    if (coords && coords.length > 0) {
      return coords.reduce((s: number, c: number[]) => s + (c[2] ?? 0), 0) / coords.length;
    }
  }
  if (feature.type === "safety_zone") {
    const ring = feature.data.geometry?.coordinates?.[0];
    if (ring && ring.length > 0) {
      return ring.reduce((s: number, c: number[]) => s + (c[2] ?? 0), 0) / ring.length;
    }
  }
  return 0;
}

/** fly a cesium viewer to a feature. prefers matching entity, falls back to coords. */
export async function flyCesiumToFeature(
  viewer: CesiumViewerType,
  feature: MapFeature,
): Promise<void> {
  const cesium = await import("cesium");
  const { Cartesian3, HeadingPitchRange, BoundingSphere, Math: CesiumMath } = cesium;
  if (viewer.isDestroyed()) return;

  const targetType = feature.type;
  const targetId = feature.data.id;
  const matches = (entity: { properties?: unknown }): boolean => {
    const props = entity.properties as
      | { featureType?: { getValue(): unknown }; featureId?: { getValue(): unknown } }
      | undefined;
    if (!props) return false;
    return (
      props.featureType?.getValue() === targetType &&
      props.featureId?.getValue() === targetId
    );
  };

  // trajectory entities (waypoint dots, arrows) live in CustomDataSources, not
  // viewer.entities. scan both so dblclick-to-recenter works for waypoints too.
  let match = viewer.entities.values.find(matches);
  for (let i = 0; !match && i < viewer.dataSources.length; i++) {
    match = viewer.dataSources.get(i).entities.values.find(matches);
  }

  const range = cesiumRangeForFeature(feature);
  const offset = new HeadingPitchRange(
    CesiumMath.toRadians(0),
    CesiumMath.toRadians(-45),
    range,
  );

  if (match) {
    // flyTo returns a Promise<boolean>; swallow rejections that occur if the
    // viewer is destroyed mid-flight to avoid an unhandled rejection
    viewer.flyTo(match, { duration: 1.5, offset }).catch(() => {});
    return;
  }

  // fallback: derive a center coord from the feature's geometry and frame it
  // with the same orbit offset as the entity path so the camera doesn't park
  // directly on the point.
  const focus = computeMapLibreFocus(feature);
  if (!focus) return;
  const altitude = computeFeatureAltitude(feature);
  viewer.camera.flyToBoundingSphere(
    new BoundingSphere(Cartesian3.fromDegrees(focus.lon, focus.lat, altitude), 1),
    { duration: 1.5, offset },
  );
}

interface UseFocusFeatureOpts {
  mapRef?: RefObject<maplibregl.Map | null>;
  cesiumViewerRef?: RefObject<CesiumViewerType | null>;
}

/**
 * shared intent router for "locate" (recenter) requests across 2d/3d maps.
 * callers give it refs; it returns a single locateFeature(feature) function
 * that dispatches to whichever map is currently live.
 */
export function useFocusFeature({
  mapRef,
  cesiumViewerRef,
}: UseFocusFeatureOpts) {
  const locateFeature = useCallback(
    (feature: MapFeature | null) => {
      if (!feature) return;
      const viewer = cesiumViewerRef?.current;
      if (viewer && !viewer.isDestroyed()) {
        void flyCesiumToFeature(viewer, feature);
        return;
      }
      const map = mapRef?.current;
      if (map) {
        flyMapLibreToFeature(map, feature);
      }
    },
    [mapRef, cesiumViewerRef],
  );

  return { locateFeature };
}
