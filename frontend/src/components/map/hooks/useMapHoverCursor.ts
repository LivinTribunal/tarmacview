import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type maplibregl from "maplibre-gl";
import { MapTool } from "@/hooks/useMapTools";

interface UseMapHoverCursorParams {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  interactive: boolean;
  activeTool?: MapTool;
  pointerLayers: string[];
  toolCursors: Record<string, string>;
}

/** hover pointer for pickable layers - applies to SELECT and the MOVE tools,
 * since MOVE is a superset of SELECT (click-to-select on top of drag-to-edit). */
export function useMapHoverCursor({
  mapRef,
  interactive,
  activeTool,
  pointerLayers,
  toolCursors,
}: UseMapHoverCursorParams): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !interactive) return;

    function handleMouseEnter() {
      const tool = activeTool ?? MapTool.SELECT;
      if (
        map &&
        (tool === MapTool.SELECT
          || tool === MapTool.MOVE_WAYPOINT
          || tool === MapTool.MOVE_FEATURE)
      ) {
        map.getCanvas().style.cursor = "pointer";
      }
    }
    function handleMouseLeave() {
      const tool = activeTool ?? MapTool.SELECT;
      if (map) {
        map.getCanvas().style.cursor = toolCursors[tool] ?? "";
      }
    }

    function bindCursor() {
      if (!map) return;
      for (const layerId of pointerLayers) {
        try {
          if (map.getLayer(layerId)) {
            map.on("mouseenter", layerId, handleMouseEnter);
            map.on("mouseleave", layerId, handleMouseLeave);
          }
        } catch {
          // layer may not exist
        }
      }
    }

    if (map.isStyleLoaded()) {
      bindCursor();
    } else {
      map.on("load", bindCursor);
    }

    return () => {
      for (const layerId of pointerLayers) {
        try {
          map.off("mouseenter", layerId, handleMouseEnter);
          map.off("mouseleave", layerId, handleMouseLeave);
        } catch {
          // cleanup
        }
      }
      map.off("load", bindCursor);
    };
  }, [mapRef, interactive, activeTool, pointerLayers, toolCursors]);
}
