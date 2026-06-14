import { useEffect, useRef, useCallback, useState } from "react";
import type maplibregl from "maplibre-gl";
import type { MapFeature } from "@/types/map";
import { polygonCentroid, haversineDistance } from "@/utils/geo";
import {
  SRC_NODES,
  SRC_MIDPOINTS,
  LYR_CORNERS,
  LYR_CENTER,
  EMPTY_FC,
  ensureSources,
  clearSources,
  removeSources,
  waitForStyleLoaded,
} from "@/hooks/vertexEditorSources";
import {
  type EditState,
  type VertexGeometryUpdate,
  extractEditState,
  radiusEdgePoint,
  buildVertexGeometryUpdate,
} from "@/hooks/vertexEditorGeometry";

export type { VertexGeometryUpdate } from "@/hooks/vertexEditorGeometry";

const EDGE_SNAP_PX = 10;

/** find nearest point on a polygon edge to cursor, returns insert index and position. */
function nearestEdgePoint(
  map: maplibregl.Map,
  cursor: [number, number],
  corners: [number, number][],
): { insertIdx: number; point: [number, number]; pixelDist: number } | null {
  if (corners.length < 3) return null;
  const cursorPx = map.project(cursor);
  let bestDist = Infinity;
  let bestPoint: [number, number] | null = null;
  let bestIdx = -1;

  for (let i = 0; i < corners.length; i++) {
    const j = (i + 1) % corners.length;
    const aPx = map.project(corners[i]);
    const bPx = map.project(corners[j]);
    const dx = bPx.x - aPx.x;
    const dy = bPx.y - aPx.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) continue;
    const t = Math.max(0, Math.min(1, ((cursorPx.x - aPx.x) * dx + (cursorPx.y - aPx.y) * dy) / lenSq));
    const px = aPx.x + t * dx;
    const py = aPx.y + t * dy;
    const dist = Math.sqrt((cursorPx.x - px) ** 2 + (cursorPx.y - py) ** 2);
    if (dist < bestDist) {
      bestDist = dist;
      const projected = map.unproject([px, py]);
      bestPoint = [projected.lng, projected.lat];
      bestIdx = j;
    }
  }

  if (bestPoint && bestDist <= EDGE_SNAP_PX) {
    return { insertIdx: bestIdx, point: bestPoint, pixelDist: bestDist };
  }
  return null;
}

interface VertexEditorReturn {
  isEditing: boolean;
}

/** overlay draggable vertex nodes on the selected feature. */
export default function useVertexEditor(
  map: maplibregl.Map | null,
  feature: MapFeature | null,
  isSelectTool: boolean,
  onGeometryUpdate: (featureType: string, featureId: string, update: VertexGeometryUpdate) => void,
): VertexEditorReturn {
  const stateRef = useRef<EditState | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const onUpdateRef = useRef(onGeometryUpdate);
  onUpdateRef.current = onGeometryUpdate;
  const dragRef = useRef<{ kind: "corner" | "center" | "radius"; idx: number } | null>(null);
  const dragStartRef = useRef<[number, number] | null>(null);
  const ghostRef = useRef<{ insertIdx: number; point: [number, number] } | null>(null);
  const featureRef = useRef(feature);
  featureRef.current = feature;

  // stable identity key - only re-init when the actual feature changes
  const featureKey = feature ? `${feature.type}:${feature.data.id}` : null;

  const updateOverlay = useCallback(() => {
    /** sync vertex overlay to map source. */
    if (!map) return;
    if (map.isStyleLoaded()) ensureSources(map);

    const st = stateRef.current;
    if (!st) return;

    const features: GeoJSON.Feature[] = [];

    // corner vertices (polygon mode)
    for (let i = 0; i < st.corners.length; i++) {
      features.push({
        type: "Feature",
        properties: { kind: "corner", idx: i },
        geometry: { type: "Point", coordinates: st.corners[i] },
      });
    }

    // radius edge handle (circle mode)
    if (st.mode === "circle") {
      features.push({
        type: "Feature",
        properties: { kind: "radius", idx: 0 },
        geometry: { type: "Point", coordinates: radiusEdgePoint(st.center, st.radius) },
      });
    }

    // center mover (always)
    features.push({
      type: "Feature",
      properties: { kind: "center", idx: 0 },
      geometry: { type: "Point", coordinates: st.center },
    });

    const src = map.getSource(SRC_NODES) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData({ type: "FeatureCollection", features });
  }, [map]);

  const emitUpdate = useCallback(() => {
    /** emit updated geometry back to parent. */
    const feat = featureRef.current;
    const st = stateRef.current;
    if (!feat || !st) return;

    const update = buildVertexGeometryUpdate(feat, st);
    if (!update) return;
    onUpdateRef.current(feat.type, feat.data.id, update);
  }, []);

  useEffect(() => {
    const feature = featureRef.current;
    if (!map || !feature || !isSelectTool) {
      if (map) clearSources(map);
      setIsEditing(false);
      stateRef.current = null;
      return;
    }

    const st = extractEditState(feature);
    if (!st) {
      clearSources(map);
      setIsEditing(false);
      stateRef.current = null;
      return;
    }

    // add overlay sources - poll if style not ready yet
    let cancelPoll: (() => void) | null = null;
    if (map.isStyleLoaded()) {
      ensureSources(map);
    } else {
      cancelPoll = waitForStyleLoaded(map, () => { ensureSources(map); updateOverlay(); });
    }

    stateRef.current = st;
    setIsEditing(true);
    updateOverlay();

    function handleMouseDown(e: maplibregl.MapMouseEvent) {
      if (!map) return;

      const hits = map.queryRenderedFeatures(e.point, { layers: [LYR_CORNERS, LYR_CENTER] });
      if (hits.length > 0) {
        const raw = hits[0].properties?.kind;
        if (raw !== "corner" && raw !== "center" && raw !== "radius") return;
        const kind = raw;
        const idx = hits[0].properties?.idx ?? 0;
        dragRef.current = { kind, idx };
        dragStartRef.current = [e.lngLat.lng, e.lngLat.lat];
        map.dragPan.disable();
        map.getCanvas().style.cursor = kind === "center" ? "move" : "grabbing";
        e.preventDefault();
        return;
      }

      // insert vertex at ghost midpoint position
      const ghost = ghostRef.current;
      const st = stateRef.current;
      if (ghost && st && st.mode === "polygon") {
        st.corners.splice(ghost.insertIdx, 0, ghost.point);
        st.center = polygonCentroid(st.corners);
        ghostRef.current = null;
        const midSrc = map.getSource(SRC_MIDPOINTS) as maplibregl.GeoJSONSource | undefined;
        if (midSrc) midSrc.setData(EMPTY_FC);
        updateOverlay();
        emitUpdate();
        e.preventDefault();
      }
    }

    function handleMouseMove(e: maplibregl.MapMouseEvent) {
      if (!map) return;
      const drag = dragRef.current;
      const st = stateRef.current;

      if (drag && st) {
        const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];

        if (drag.kind === "corner") {
          st.corners[drag.idx] = lngLat;
          st.center = polygonCentroid(st.corners);
        } else if (drag.kind === "center") {
          const start = dragStartRef.current!;
          const dLng = lngLat[0] - start[0];
          const dLat = lngLat[1] - start[1];
          st.corners = st.corners.map(([lng, lat]) => [lng + dLng, lat + dLat] as [number, number]);
          st.center = [st.center[0] + dLng, st.center[1] + dLat];
          dragStartRef.current = lngLat;
        } else if (drag.kind === "radius") {
          st.radius = haversineDistance(st.center[0], st.center[1], lngLat[0], lngLat[1]);
        }

        updateOverlay();
        emitUpdate();
        return;
      }

      // hover cursor + ghost midpoint for edge insertion
      const hits = map.queryRenderedFeatures(e.point, { layers: [LYR_CORNERS, LYR_CENTER] });
      if (hits.length > 0) {
        const kind = hits[0].properties?.kind;
        map.getCanvas().style.cursor = kind === "center" ? "move" : "grab";
        // clear ghost when hovering a node
        ghostRef.current = null;
        const midSrc = map.getSource(SRC_MIDPOINTS) as maplibregl.GeoJSONSource | undefined;
        if (midSrc) midSrc.setData(EMPTY_FC);
      } else if (st && st.mode === "polygon" && st.corners.length >= 3) {
        const cursor: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        const edge = nearestEdgePoint(map, cursor, st.corners);
        const midSrc = map.getSource(SRC_MIDPOINTS) as maplibregl.GeoJSONSource | undefined;
        if (edge && midSrc) {
          ghostRef.current = { insertIdx: edge.insertIdx, point: edge.point };
          midSrc.setData({
            type: "FeatureCollection",
            features: [{
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: edge.point },
            }],
          });
          map.getCanvas().style.cursor = "copy";
        } else {
          ghostRef.current = null;
          if (midSrc) midSrc.setData(EMPTY_FC);
          map.getCanvas().style.cursor = "";
        }
      } else {
        map.getCanvas().style.cursor = "";
      }
    }

    function handleMouseUp() {
      if (!map) return;
      if (dragRef.current) {
        dragRef.current = null;
        dragStartRef.current = null;
        map.dragPan.enable();
        map.getCanvas().style.cursor = "";
      }
    }

    function handleDblClick(e: maplibregl.MapMouseEvent) {
      /** delete vertex on double-click (minimum 3 for polygons). */
      if (!map) return;
      const st = stateRef.current;
      if (!st || st.mode !== "polygon") return;

      const hits = map.queryRenderedFeatures(e.point, { layers: [LYR_CORNERS] });
      if (hits.length === 0) return;

      const idx = hits[0].properties?.idx;
      if (idx == null) return;

      if (st.corners.length <= 3) return;

      st.corners.splice(idx, 1);
      st.center = polygonCentroid(st.corners);
      updateOverlay();
      emitUpdate();
      e.preventDefault();
    }

    map.on("mousedown", handleMouseDown);
    map.on("mousemove", handleMouseMove);
    map.on("mouseup", handleMouseUp);
    map.on("dblclick", handleDblClick);

    // fallback: release drag if mouse leaves canvas
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      cancelPoll?.();
      if (dragRef.current) {
        map.dragPan.enable();
        dragRef.current = null;
      }
      map.off("mousedown", handleMouseDown);
      map.off("mousemove", handleMouseMove);
      map.off("mouseup", handleMouseUp);
      map.off("dblclick", handleDblClick);
      document.removeEventListener("mouseup", handleMouseUp);
      clearSources(map);
      ghostRef.current = null;
    };
  }, [map, featureKey, isSelectTool, updateOverlay, emitUpdate]);

  useEffect(() => {
    return () => { if (map) removeSources(map); };
  }, [map]);

  return { isEditing };
}
