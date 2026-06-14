import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type maplibregl from "maplibre-gl";
import type { MapFeature } from "@/types/map";
import type { WaypointResponse } from "@/types/flightPlan";
import type { AirportDetailResponse } from "@/types/airport";
import { MapTool } from "@/hooks/useMapTools";
import { flyMapLibreToFeature } from "@/hooks/useFocusFeature";
import {
  WAYPOINT_TRANSIT_CIRCLE_LAYER,
  WAYPOINT_TRANSIT_HIT_LAYER,
  WAYPOINT_GHOST_TRANSIT_SOURCE,
} from "../layers/waypointLayers";
import { TRANSIT_HOVER_RING_COLOR } from "@/constants/palette";
import {
  ALL_WP_HOVER_LAYERS,
  WAYPOINT_QUERY_LAYERS,
  buildInfraFeature,
  buildWaypointFeature,
  resolveTransitInsertion,
} from "./pickFeatureBuilders";
import { useMapHoverCursor } from "./useMapHoverCursor";

export { resolveTransitInsertion };

interface UsePickAndSelectParams {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  interactive: boolean;
  activeTool?: MapTool;
  airport: AirportDetailResponse;
  onFeatureClick?: (feature: MapFeature | null) => void;
  onWaypointClick?: (id: string | null) => void;
  selectedWaypointId?: string | null;
  onMapClick?: (lngLat: { lng: number; lat: number }) => void;
  onTransitInsert?: (position: [number, number, number], afterSequence: number) => void;
  onTransitDelete?: (waypointId: string) => void;
  setSelectedFeature: (feature: MapFeature | null) => void;
  waypointsRef: MutableRefObject<WaypointResponse[] | undefined>;
  interactiveLayers: string[];
  pointerLayers: string[];
  toolCursors: Record<string, string>;
}

/** click/hover/dblclick pick + select, transit insert/delete, hover pointer cursor. */
export function usePickAndSelect({
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
  interactiveLayers,
  pointerLayers,
  toolCursors,
}: UsePickAndSelectParams) {
  // refs for transit insert/delete callbacks (read inside the pick effect
  // without re-binding listeners when the parent re-renders)
  const onTransitInsertRef = useRef(onTransitInsert);
  onTransitInsertRef.current = onTransitInsert;
  const onTransitDeleteRef = useRef(onTransitDelete);
  onTransitDeleteRef.current = onTransitDelete;

  useMapHoverCursor({ mapRef, interactive, activeTool, pointerLayers, toolCursors });

  // click, hover, dblclick handler (transit insert/delete, feature selection, hover highlight)
  useEffect(() => {
    const TRANSIT_HOVER_SOURCE = "transit-hover-source";
    const TRANSIT_HOVER_LAYER = "transit-hover-ring";

    const map = mapRef.current;
    if (!map || !interactive) return;

    const tool = activeTool ?? MapTool.SELECT;
    let ghostActive = false;
    let hoveredTransitId: string | null = null;

    // ensure hover highlight source/layer exist (only when style is ready)
    function ensureHoverLayer() {
      if (!map || !map.isStyleLoaded()) return;
      if (map.getSource(TRANSIT_HOVER_SOURCE)) return;
      map.addSource(TRANSIT_HOVER_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: TRANSIT_HOVER_LAYER,
        type: "circle",
        source: TRANSIT_HOVER_SOURCE,
        paint: {
          "circle-radius": 12,
          "circle-color": "transparent",
          "circle-stroke-color": TRANSIT_HOVER_RING_COLOR,
          "circle-stroke-width": 2,
          "circle-stroke-opacity": 0.8,
        },
      });
    }
    if (map.isStyleLoaded()) {
      ensureHoverLayer();
    } else {
      map.once("style.load", ensureHoverLayer);
    }

    function updateWaypointHover(e: maplibregl.MapMouseEvent) {
      if (!map) return;
      const wpHoverLayers = ALL_WP_HOVER_LAYERS.filter((id) => {
        try { return map.getLayer(id); } catch { return false; }
      });
      if (wpHoverLayers.length === 0) return;
      // lazily create hover source if style is ready but source missing
      if (!map.getSource(TRANSIT_HOVER_SOURCE)) {
        try { ensureHoverLayer(); } catch { return; }
      }
      const hoverSrc = map.getSource(TRANSIT_HOVER_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!hoverSrc) return;

      const hits = map.queryRenderedFeatures(e.point, { layers: wpHoverLayers });
      if (hits.length > 0) {
        const wpId = hits[0].properties?.id;
        if (wpId && wpId !== hoveredTransitId) {
          hoveredTransitId = wpId;
          hoverSrc.setData({
            type: "FeatureCollection",
            features: [{ type: "Feature", properties: {}, geometry: hits[0].geometry }],
          });
        }
      } else if (hoveredTransitId) {
        hoveredTransitId = null;
        hoverSrc.setData({ type: "FeatureCollection", features: [] });
      }
    }

    function handleMouseMove(e: maplibregl.MapMouseEvent) {
      if (!map) return;

      // transit circle hover highlight (SELECT + MOVE_WAYPOINT)
      if (tool === MapTool.SELECT || tool === MapTool.MOVE_WAYPOINT) {
        updateWaypointHover(e);
      }

      // ghost waypoint on transit path (MOVE only, full map page only)
      if (tool !== MapTool.MOVE_WAYPOINT || !onTransitInsertRef.current) return;
      try { if (!map.getLayer(WAYPOINT_TRANSIT_HIT_LAYER)) return; } catch { return; }

      const features = map.queryRenderedFeatures(e.point, { layers: [WAYPOINT_TRANSIT_HIT_LAYER] });
      const ghostSrc = map.getSource(WAYPOINT_GHOST_TRANSIT_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!ghostSrc) return;

      // don't show ghost when hovering an existing transit circle
      if (hoveredTransitId) {
        if (ghostActive) {
          ghostSrc.setData({ type: "FeatureCollection", features: [] });
          ghostActive = false;
        }
        return;
      }

      if (features.length > 0) {
        // transit insert altitude: linear interpolation between segment endpoints
        const { alt, afterSeq } = resolveTransitInsertion(features[0].properties, e.lngLat);
        ghostSrc.setData({
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            properties: { after_seq: afterSeq },
            geometry: { type: "Point", coordinates: [e.lngLat.lng, e.lngLat.lat, alt] },
          }],
        });
        if (!ghostActive) {
          map.getCanvas().style.cursor = "copy";
          ghostActive = true;
        }
      } else if (ghostActive) {
        ghostSrc.setData({ type: "FeatureCollection", features: [] });
        map.getCanvas().style.cursor = "";
        ghostActive = false;
      }
    }

    function queryHits(point: maplibregl.Point) {
      /** query all pickable layers at a point. */
      if (!map) return [];
      const allQueryLayers = [...interactiveLayers, ...WAYPOINT_QUERY_LAYERS].filter((id) => {
        try { return map.getLayer(id); } catch { return false; }
      });
      return map.queryRenderedFeatures(point, { layers: allQueryLayers });
    }

    function handleClick(e: maplibregl.MapMouseEvent) {
      if (!map) return;

      // pick mode takes priority
      if (onMapClick) {
        onMapClick({ lng: e.lngLat.lng, lat: e.lngLat.lat });
        return;
      }

      // click-to-select runs for SELECT and both MOVE tools (MOVE is a SELECT
      // superset: drag-to-edit on top of click-to-select / pan-on-empty).
      // transit-insert below is gated on onTransitInsertRef, which only the
      // operator mission map provides, so coordinator MOVE_FEATURE is a no-op.
      if (
        tool !== MapTool.SELECT
        && tool !== MapTool.MOVE_WAYPOINT
        && tool !== MapTool.MOVE_FEATURE
      ) return;

      // skip re-selection when clicking vertex editor nodes/edges
      const vertexLayers = ["vertex-edit-corners", "vertex-edit-center", "vertex-edit-midpoints"]
        .filter((id) => { try { return map.getLayer(id); } catch { return false; } });
      if (vertexLayers.length > 0) {
        const vHits = map.queryRenderedFeatures(e.point, { layers: vertexLayers });
        if (vHits.length > 0) return;
      }

      // transit path click to insert (full map page only)
      try {
        if (onTransitInsertRef.current && map.getLayer(WAYPOINT_TRANSIT_HIT_LAYER)) {
          let onCircle = false;
          try {
            if (map.getLayer(WAYPOINT_TRANSIT_CIRCLE_LAYER)) {
              onCircle = map.queryRenderedFeatures(e.point, { layers: [WAYPOINT_TRANSIT_CIRCLE_LAYER] }).length > 0;
            }
          } catch { /* layer not ready */ }

          if (!onCircle) {
            const hitFeatures = map.queryRenderedFeatures(e.point, { layers: [WAYPOINT_TRANSIT_HIT_LAYER] });
            if (hitFeatures.length > 0) {
              // transit insert altitude: linear interpolation between segment endpoints
              const { alt, afterSeq } = resolveTransitInsertion(hitFeatures[0].properties, e.lngLat);
              onTransitInsertRef.current?.([e.lngLat.lng, e.lngLat.lat, alt], afterSeq);
              return;
            }
          }
        }
      } catch { /* layer not ready */ }

      const features = queryHits(e.point);

      if (!features.length) {
        setSelectedFeature(null);
        onFeatureClick?.(null);
        if (onWaypointClick) onWaypointClick(null);
        return;
      }

      // check for waypoint hit first (highest priority)
      const wpHit = features.find((f) =>
        WAYPOINT_QUERY_LAYERS.includes(f.layer?.id ?? ""),
      );
      if (wpHit && wpHit.properties) {
        const built = buildWaypointFeature(wpHit, waypointsRef.current);
        if (built) {
          if (onWaypointClick) {
            onWaypointClick(selectedWaypointId === built.wpId ? null : built.wpId);
          }
          setSelectedFeature(built.feature);
          // single-click: select only. the focusFeature effect syncs highlight;
          // no fly is ever triggered for plain clicks.
          return;
        }
      }

      const mapFeature = buildInfraFeature(features, airport);
      if (mapFeature) {
        setSelectedFeature(mapFeature);
        onFeatureClick?.(mapFeature);
      }
    }

    function handleDblClick(e: maplibregl.MapMouseEvent) {
      if (!map) return;
      if (
        tool !== MapTool.SELECT
        && tool !== MapTool.MOVE_WAYPOINT
        && tool !== MapTool.MOVE_FEATURE
      ) return;

      // transit waypoint double-click: delete if handler is provided (map editor only)
      try {
        if (onTransitDeleteRef.current && map.getLayer(WAYPOINT_TRANSIT_CIRCLE_LAYER)) {
          const transitHits = map.queryRenderedFeatures(e.point, {
            layers: [WAYPOINT_TRANSIT_CIRCLE_LAYER],
          });
          if (transitHits.length > 0 && transitHits[0].properties?.id) {
            e.preventDefault();
            onTransitDeleteRef.current(transitHits[0].properties.id);
            return;
          }
        }
      } catch { /* layer not ready */ }

      const features = queryHits(e.point);
      if (features.length === 0) {
        // empty-space double-click: let maplibre's default doubleClickZoom run.
        return;
      }

      // double-click on a feature: select AND recenter (no built-in zoom).
      e.preventDefault();

      const wpHit = features.find((f) =>
        WAYPOINT_QUERY_LAYERS.includes(f.layer?.id ?? ""),
      );
      if (wpHit && wpHit.properties) {
        const built = buildWaypointFeature(wpHit, waypointsRef.current);
        if (built) {
          if (onWaypointClick) onWaypointClick(built.wpId);
          setSelectedFeature(built.feature);
          onFeatureClick?.(built.feature);
          flyMapLibreToFeature(map, built.feature);
          return;
        }
      }

      const mapFeature = buildInfraFeature(features, airport);
      if (mapFeature) {
        setSelectedFeature(mapFeature);
        onFeatureClick?.(mapFeature);
        flyMapLibreToFeature(map, mapFeature);
      }
    }

    map.on("mousemove", handleMouseMove);
    map.on("click", handleClick);
    map.on("dblclick", handleDblClick);
    return () => {
      map.off("mousemove", handleMouseMove);
      map.off("click", handleClick);
      map.off("dblclick", handleDblClick);
      try {
        if (ghostActive) {
          map.getCanvas().style.cursor = "";
          const ghostSrc = map.getSource(WAYPOINT_GHOST_TRANSIT_SOURCE) as maplibregl.GeoJSONSource | undefined;
          if (ghostSrc) ghostSrc.setData({ type: "FeatureCollection", features: [] });
        }
        const hoverSrc = map.getSource(TRANSIT_HOVER_SOURCE) as maplibregl.GeoJSONSource | undefined;
        if (hoverSrc) hoverSrc.setData({ type: "FeatureCollection", features: [] });
      } catch { /* map already destroyed */ }
    };
  }, [
    mapRef,
    airport,
    interactive,
    onFeatureClick,
    onWaypointClick,
    selectedWaypointId,
    onMapClick,
    activeTool,
    interactiveLayers,
    setSelectedFeature,
    waypointsRef,
  ]);
}
