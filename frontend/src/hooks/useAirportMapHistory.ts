import { useCallback } from "react";
import maplibregl from "maplibre-gl";
import type { AirportDetailResponse } from "@/types/airport";
import type { MapFeature } from "@/types/map";
import { AIRPORT_BOUNDARY_SOURCE } from "@/components/map/layers/safetyZoneLayers";
import {
  syncEntityGeometryToMap,
  updateSourceFeatureGeometry,
} from "@/pages/coordinator-center/syncEntityGeometryToMap";
import useDirtyHistory from "@/hooks/useDirtyHistory";
import useVertexEditor from "@/hooks/useVertexEditor";
import type { VertexGeometryUpdate } from "@/hooks/useVertexEditor";

interface UseAirportMapHistoryParams {
  id: string | undefined;
  airport: AirportDetailResponse | null;
  selectedFeature: MapFeature | null;
  vertexEditActive: boolean;
  map: maplibregl.Map | null;
  getMap: () => maplibregl.Map | null;
}

/** dirty-history machine plus vertex/feature/airport update handlers for the airport editor. */
export default function useAirportMapHistory({
  id,
  airport,
  selectedFeature,
  vertexEditActive,
  map,
  getMap,
}: UseAirportMapHistoryParams) {
  const {
    isDirty,
    markDirty,
    clearAll,
    getPendingChanges,
    getPendingChange,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useDirtyHistory();

  // vertex editor for selected features
  const handleVertexGeometryUpdate = useCallback(
    (featureType: string, featureId: string, update: VertexGeometryUpdate) => {
      /** handle geometry update from vertex editor - mark dirty and update map preview. */
      // only persist geometry + boundary from vertex drags. length/width/heading
      // are user-facing metadata and should not get silently overwritten - use
      // the "recalculate dimensions" button to sync them from geometry on demand.
      const dirtyData: Record<string, unknown> = { geometry: update.geometry };
      if (update.boundary) dirtyData.boundary = update.boundary;
      markDirty(featureType, featureId, "update", dirtyData);

      // live preview: update map source so the shape moves with the vertices
      const m = getMap();
      if (!m) return;

      if (featureType === "safety_zone") {
        const zoneData = airport?.safety_zones.find((z) => z.id === featureId);
        if (zoneData?.type === "AIRPORT_BOUNDARY") {
          // update boundary outline live
          const src = m.getSource(AIRPORT_BOUNDARY_SOURCE) as maplibregl.GeoJSONSource | undefined;
          if (src && update.geometry.type === "Polygon") {
            const poly = update.geometry as GeoJSON.Polygon;
            const outlineFeature: GeoJSON.Feature = {
              type: "Feature",
              properties: { id: featureId, name: zoneData.name, entityType: "airport_boundary", role: "outline" },
              geometry: poly,
            };
            src.setData({ type: "FeatureCollection", features: [outlineFeature] });
          }
        } else {
          updateSourceFeatureGeometry(m, "safety-zones", featureId, update.geometry);
        }
      } else if (featureType === "obstacle") {
        // update boundary polygon
        if (update.boundary) {
          updateSourceFeatureGeometry(m, "obstacles-boundary", featureId, update.boundary);
          // sync icon/label point to new centroid
          const ring = (update.boundary as GeoJSON.Polygon).coordinates[0];
          const cx = ring.reduce((s, c) => s + c[0], 0) / ring.length;
          const cy = ring.reduce((s, c) => s + c[1], 0) / ring.length;
          const cz = ring.reduce((s, c) => s + (c[2] ?? 0), 0) / ring.length;
          updateSourceFeatureGeometry(m, "obstacles", featureId, {
            type: "Point",
            coordinates: [cx, cy, cz],
          });
        }
      } else if (featureType === "surface") {
        const surfaceData = airport?.surfaces.find((s) => s.id === featureId);
        if (!surfaceData) return;
        const surfaceType = surfaceData.surface_type;
        const polySource = surfaceType === "RUNWAY" ? "runways-polygon" : "taxiways-polygon";
        const clSource = surfaceType === "RUNWAY" ? "runways" : "taxiways";

        // live preview: use the boundary polygon directly
        if (update.boundary) {
          updateSourceFeatureGeometry(m, polySource, featureId, update.boundary);
        } else if (update.polygon) {
          updateSourceFeatureGeometry(m, polySource, featureId, update.polygon);
        }

        // update centerline source so labels/dashes follow
        if (update.geometry.type === "LineString") {
          updateSourceFeatureGeometry(m, clSource, featureId, update.geometry);
        }
      }
    },
    [markDirty, getMap, airport],
  );

  useVertexEditor(map, selectedFeature, vertexEditActive, handleVertexGeometryUpdate);

  // undo/redo wrappers - push the rolled-back/replayed state into map sources
  // since the live preview during edits writes geometry directly to maplibre,
  // history changes alone don't refresh the map.
  const handleUndo = useCallback(() => {
    /** undo last change and sync the affected entity's geometry to the map. */
    const step = undo();
    if (!step) return;
    const m = getMap();
    if (!m || !airport) return;
    syncEntityGeometryToMap(m, airport, step.entityType, step.entityId, step.current?.data);
  }, [undo, getMap, airport]);

  const handleRedo = useCallback(() => {
    /** redo last undone change and sync the affected entity's geometry to the map. */
    const step = redo();
    if (!step) return;
    const m = getMap();
    if (!m || !airport) return;
    syncEntityGeometryToMap(m, airport, step.entityType, step.entityId, step.current?.data);
  }, [redo, getMap, airport]);

  const handleInfraPointDrag = useCallback(
    (featureType: "agl" | "lha", featureId: string, newPosition: [number, number, number]) => {
      /** handle agl/lha point drag - mark dirty with new position. */
      markDirty(featureType, featureId, "update", {
        position: { type: "Point", coordinates: newPosition },
      });
    },
    [markDirty],
  );

  const handleFeatureUpdate = useCallback(
    (data: Record<string, unknown>) => {
      /** handle editable feature info field change. */
      if (!selectedFeature) return;
      markDirty(selectedFeature.type, selectedFeature.data.id, "update", data);
    },
    [selectedFeature, markDirty],
  );

  const handleAirportUpdate = useCallback(
    (data: Record<string, unknown>) => {
      /** track airport-level field changes. */
      if (!id) return;
      markDirty("airport", id, "update", data);
    },
    [id, markDirty],
  );

  const handleGeoJsonApply = useCallback(
    (geometry: GeoJSON.Geometry) => {
      /** apply geojson geometry to selected feature. */
      if (!selectedFeature) return;
      markDirty(selectedFeature.type, selectedFeature.data.id, "update", { geometry });
    },
    [selectedFeature, markDirty],
  );

  return {
    isDirty,
    markDirty,
    clearAll,
    getPendingChanges,
    getPendingChange,
    undo,
    redo,
    canUndo,
    canRedo,
    handleUndo,
    handleRedo,
    handleInfraPointDrag,
    handleFeatureUpdate,
    handleAirportUpdate,
    handleGeoJsonApply,
  };
}
