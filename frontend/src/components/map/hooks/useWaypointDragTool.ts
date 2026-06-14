import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type maplibregl from "maplibre-gl";
import { MapTool } from "@/hooks/useMapTools";
import type { WaypointResponse } from "@/types/flightPlan";
import type { PointZ } from "@/types/common";
import {
  waypointsToGeoJSON,
  waypointsToLineGeoJSON,
  waypointsToSimplifiedLineGeoJSON,
  waypointsToSimplifiedCornersGeoJSON,
  WAYPOINT_SOURCE,
  WAYPOINT_LINE_SOURCE,
  SIMPLIFIED_LINE_SOURCE,
  SIMPLIFIED_CORNERS_SOURCE,
  WAYPOINT_TRANSIT_CIRCLE_LAYER,
  WAYPOINT_MEASUREMENT_CIRCLE_LAYER,
  WAYPOINT_TAKEOFF_LAYER,
  WAYPOINT_LANDING_LAYER,
  WAYPOINT_HOVER_LAYER,
} from "../layers/waypointLayers";

interface UseWaypointDragToolParams {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  activeTool?: MapTool;
  interactive: boolean;
  onWaypointDrag?: (waypointId: string, newPosition: [number, number, number]) => void;
  waypointsRef: MutableRefObject<WaypointResponse[] | undefined>;
  takeoffRef: MutableRefObject<PointZ | null | undefined>;
  landingRef: MutableRefObject<PointZ | null | undefined>;
  useTakeoffAsLandingRef: MutableRefObject<boolean | undefined>;
  indexMapRef: MutableRefObject<Record<string, number> | undefined>;
  toolCursors: Record<string, string>;
}

/** move waypoint tool: drag behavior with live preview, dragPan disable/enable on drag. */
export function useWaypointDragTool({
  mapRef,
  activeTool,
  interactive,
  onWaypointDrag,
  waypointsRef,
  takeoffRef,
  landingRef,
  useTakeoffAsLandingRef,
  indexMapRef,
  toolCursors,
}: UseWaypointDragToolParams) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !interactive) return;
    const tool = activeTool ?? MapTool.SELECT;
    if (tool !== MapTool.MOVE_WAYPOINT) return;

    const dragState = { waypointId: "", originalAlt: 0, dragging: false };
    let rafId = 0;

    const waypointQueryLayers = [
      WAYPOINT_TRANSIT_CIRCLE_LAYER,
      WAYPOINT_MEASUREMENT_CIRCLE_LAYER,
      WAYPOINT_TAKEOFF_LAYER,
      WAYPOINT_LANDING_LAYER,
      WAYPOINT_HOVER_LAYER,
    ];

    function handleMouseDown(e: maplibregl.MapMouseEvent) {
      if (!map) return;
      const layers = waypointQueryLayers.filter((id) => {
        try { return map.getLayer(id); } catch { return false; }
      });
      if (!layers.length) return;
      const features = map.queryRenderedFeatures(e.point, { layers });
      if (!features.length) return;
      const wpId = String(features[0].properties?.id ?? "");
      if (!wpId) return;
      const coords = features[0].geometry && "coordinates" in features[0].geometry
        ? (features[0].geometry as GeoJSON.Point).coordinates
        : [0, 0, 0];
      dragState.waypointId = wpId;
      dragState.originalAlt = coords[2] ?? 0;
      dragState.dragging = true;
      map.getCanvas().style.cursor = "grabbing";
      map.dragPan.disable();
      e.preventDefault();
    }

    function handleMouseMove(e: maplibregl.MapMouseEvent) {
      if (!dragState.dragging || !map) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!map) return;
        const wps = waypointsRef.current ?? [];
        const newCoords: [number, number, number] = [e.lngLat.lng, e.lngLat.lat, dragState.originalAlt];

        // live preview for standalone T/L markers
        let dragTakeoff = takeoffRef.current;
        let dragLanding = landingRef.current;
        if (dragState.waypointId === "takeoff" && dragTakeoff) {
          dragTakeoff = { ...dragTakeoff, coordinates: newCoords };
          if (useTakeoffAsLandingRef.current) {
            dragLanding = { ...dragTakeoff };
          }
        } else if (dragState.waypointId === "landing" && dragLanding) {
          dragLanding = { ...dragLanding, coordinates: newCoords };
        }

        const updated: WaypointResponse[] = wps.map((wp) => {
          if (wp.id !== dragState.waypointId) return wp;
          return {
            ...wp,
            position: {
              ...wp.position,
              coordinates: newCoords,
            },
          };
        });

        // update point source
        const pointSrc = map.getSource(WAYPOINT_SOURCE) as maplibregl.GeoJSONSource | undefined;
        if (pointSrc) {
          pointSrc.setData(
            waypointsToGeoJSON(updated, dragTakeoff, dragLanding, indexMapRef.current),
          );
        }

        // update line source
        const lineSrc = map.getSource(WAYPOINT_LINE_SOURCE) as maplibregl.GeoJSONSource | undefined;
        if (lineSrc) {
          lineSrc.setData(waypointsToLineGeoJSON(updated));
        }

        // update simplified trajectory sources
        const simpLineSrc = map.getSource(SIMPLIFIED_LINE_SOURCE) as maplibregl.GeoJSONSource | undefined;
        if (simpLineSrc) {
          simpLineSrc.setData(waypointsToSimplifiedLineGeoJSON(updated));
        }
        const simpCornerSrc = map.getSource(SIMPLIFIED_CORNERS_SOURCE) as maplibregl.GeoJSONSource | undefined;
        if (simpCornerSrc) {
          simpCornerSrc.setData(waypointsToSimplifiedCornersGeoJSON(updated));
        }
      });
    }

    function handleMouseUp(e: maplibregl.MapMouseEvent) {
      if (!dragState.dragging || !map) return;
      cancelAnimationFrame(rafId);
      dragState.dragging = false;
      map.getCanvas().style.cursor = toolCursors[MapTool.MOVE_WAYPOINT] || "crosshair";
      map.dragPan.enable();
      onWaypointDrag?.(
        dragState.waypointId,
        [e.lngLat.lng, e.lngLat.lat, dragState.originalAlt],
      );
      dragState.waypointId = "";
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
  }, [
    mapRef,
    activeTool,
    interactive,
    onWaypointDrag,
    waypointsRef,
    takeoffRef,
    landingRef,
    useTakeoffAsLandingRef,
    indexMapRef,
    toolCursors,
  ]);
}
