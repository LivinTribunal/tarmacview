import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type maplibregl from "maplibre-gl";
import { MapTool } from "@/hooks/useMapTools";
import {
  MAP_ZOOM_TICK_DURATION_MS,
  MAP_ZOOM_INITIAL_DEFAULT,
} from "@/constants/mapAnimations";

interface UseZoomToolParams {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  activeTool?: MapTool;
  interactive: boolean;
  zoomPercent?: number;
  suppressZoomEndRef: MutableRefObject<boolean>;
}

/** zoom tool: click to zoom in/out, plus parent-driven zoomPercent sync. */
export function useZoomTool({
  mapRef,
  activeTool,
  interactive,
  zoomPercent,
  suppressZoomEndRef,
}: UseZoomToolParams) {
  // zoom tool: click to zoom in/out, sync zoomPercent
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !interactive) return;
    const tool = activeTool ?? MapTool.SELECT;
    if (tool !== MapTool.ZOOM) return;

    function handleZoomClick() {
      if (!map) return;
      map.zoomTo(map.getZoom() + 1, { duration: MAP_ZOOM_TICK_DURATION_MS });
    }

    function handleZoomContext(e: maplibregl.MapMouseEvent) {
      e.preventDefault();
      if (!map) return;
      map.zoomTo(map.getZoom() - 1, { duration: MAP_ZOOM_TICK_DURATION_MS });
    }

    map.on("click", handleZoomClick);
    map.on("contextmenu", handleZoomContext);
    return () => {
      map.off("click", handleZoomClick);
      map.off("contextmenu", handleZoomContext);
    };
  }, [mapRef, activeTool, interactive]);

  // sync zoomPercent from parent to map zoom level
  useEffect(() => {
    const map = mapRef.current;
    if (!map || zoomPercent === undefined) return;
    const targetZoom = MAP_ZOOM_INITIAL_DEFAULT * (zoomPercent / 100);
    if (Math.abs(map.getZoom() - targetZoom) > 0.1) {
      suppressZoomEndRef.current = true;
      map.zoomTo(targetZoom, { duration: MAP_ZOOM_TICK_DURATION_MS });
    }
  }, [mapRef, zoomPercent, suppressZoomEndRef]);
}
