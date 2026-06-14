import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type maplibregl from "maplibre-gl";
import { MapTool } from "@/hooks/useMapTools";
import { AGL_SOURCE, AGL_POINT_LAYER, LHA_SOURCE, LHA_POINT_LAYER } from "../layers/aglLayers";

interface UseInfraDragToolParams {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  activeTool?: MapTool;
  vertexEditTool?: MapTool;
  interactive: boolean;
  onInfraPointDrag?: (
    featureType: "agl" | "lha",
    featureId: string,
    newPosition: [number, number, number],
  ) => void;
}

/** drag agl/lha points only when the vertex-edit tool is active, dragPan disable/enable. */
export function useInfraDragTool({
  mapRef,
  activeTool,
  vertexEditTool,
  interactive,
  onInfraPointDrag,
}: UseInfraDragToolParams) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !interactive || !onInfraPointDrag) return;
    const tool = activeTool ?? MapTool.SELECT;
    const dragTool = vertexEditTool ?? MapTool.SELECT;
    if (tool !== dragTool) return;

    const dragState = {
      featureId: "", featureType: "" as "agl" | "lha", originalAlt: 0, dragging: false,
      snapshot: null as GeoJSON.Feature[] | null,
    };
    let rafId = 0;

    const infraQueryLayers = [AGL_POINT_LAYER, LHA_POINT_LAYER];

    function snapshotSource(sourceName: string): GeoJSON.Feature[] {
      /** deduplicated snapshot of source features - querySourceFeatures can return tile-boundary dupes. */
      const raw = map!.querySourceFeatures(sourceName);
      const seen = new Set<string>();
      const out: GeoJSON.Feature[] = [];
      for (const f of raw) {
        const id = String(f.properties?.id ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({ type: "Feature", properties: f.properties, geometry: f.geometry });
      }
      return out;
    }

    function handleMouseDown(e: maplibregl.MapMouseEvent) {
      if (!map) return;
      const layers = infraQueryLayers.filter((id) => {
        try { return map.getLayer(id); } catch { return false; }
      });
      if (!layers.length) return;
      const features = map.queryRenderedFeatures(e.point, { layers });
      if (!features.length) return;
      const fId = String(features[0].properties?.id ?? "");
      if (!fId) return;
      const entityType = String(features[0].properties?.entityType ?? "") as "agl" | "lha";
      if (entityType !== "agl" && entityType !== "lha") return;
      const coords = features[0].geometry && "coordinates" in features[0].geometry
        ? (features[0].geometry as GeoJSON.Point).coordinates
        : [0, 0, 0];
      dragState.featureId = fId;
      dragState.featureType = entityType;
      dragState.originalAlt = coords[2] ?? 0;
      dragState.dragging = true;
      dragState.snapshot = snapshotSource(entityType === "agl" ? AGL_SOURCE : LHA_SOURCE);
      map.getCanvas().style.cursor = "grabbing";
      map.dragPan.disable();
      e.preventDefault();
    }

    function handleMouseMove(e: maplibregl.MapMouseEvent) {
      if (!dragState.dragging || !map || !dragState.snapshot) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!map || !dragState.snapshot) return;
        const newCoords: [number, number, number] = [e.lngLat.lng, e.lngLat.lat, dragState.originalAlt];
        const sourceName = dragState.featureType === "agl" ? AGL_SOURCE : LHA_SOURCE;
        const src = map.getSource(sourceName) as maplibregl.GeoJSONSource | undefined;
        if (src) {
          const features = dragState.snapshot.map((f) => ({
            type: "Feature" as const,
            properties: f.properties,
            geometry: f.properties?.id === dragState.featureId
              ? { type: "Point" as const, coordinates: newCoords }
              : f.geometry,
          }));
          src.setData({ type: "FeatureCollection", features });
        }
      });
    }

    function handleMouseUp(e: maplibregl.MapMouseEvent) {
      if (!dragState.dragging || !map) return;
      cancelAnimationFrame(rafId);
      dragState.dragging = false;
      dragState.snapshot = null;
      map.getCanvas().style.cursor = "";
      map.dragPan.enable();
      onInfraPointDrag?.(
        dragState.featureType,
        dragState.featureId,
        [e.lngLat.lng, e.lngLat.lat, dragState.originalAlt],
      );
      dragState.featureId = "";
    }

    map.on("mousedown", handleMouseDown);
    map.on("mousemove", handleMouseMove);
    map.on("mouseup", handleMouseUp);
    return () => {
      cancelAnimationFrame(rafId);
      map.off("mousedown", handleMouseDown);
      map.off("mousemove", handleMouseMove);
      map.off("mouseup", handleMouseUp);
    };
  }, [mapRef, activeTool, vertexEditTool, interactive, onInfraPointDrag]);
}
