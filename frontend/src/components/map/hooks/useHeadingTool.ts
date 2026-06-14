import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type maplibregl from "maplibre-gl";
import { MapTool } from "@/hooks/useMapTools";
import { computeBearing as computeBearingFn } from "@/utils/geo";
import { waitForStyleLoaded } from "../mapStyles";
import { HEADING_TOOL_COLOR, NEUTRAL } from "@/constants/palette";

/** add heading tool sources and layers to the map. */
export function addHeadingLayersToMap(map: maplibregl.Map) {
  const emptyFC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

  if (!map.getSource("heading-point")) {
    map.addSource("heading-point", { type: "geojson", data: emptyFC });

    // origin circle
    map.addLayer({
      id: "heading-point-layer",
      type: "circle",
      source: "heading-point",
      filter: ["==", ["get", "kind"], "origin"],
      paint: {
        "circle-radius": 4,
        "circle-color": HEADING_TOOL_COLOR,
        "circle-stroke-color": NEUTRAL.WHITE,
        "circle-stroke-width": 2,
      },
    });

    // arrowhead at endpoint - bearing property is already offset by -90
    map.addLayer({
      id: "heading-arrow-layer",
      type: "symbol",
      source: "heading-point",
      filter: ["==", ["get", "kind"], "endpoint"],
      layout: {
        "text-field": "▶",
        "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
        "text-size": 16,
        "text-rotate": ["get", "bearing"],
        "text-rotation-alignment": "map",
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": HEADING_TOOL_COLOR,
      },
    });
  }

  if (!map.getSource("heading-line")) {
    map.addSource("heading-line", { type: "geojson", data: emptyFC });
    map.addLayer({
      id: "heading-line-layer",
      type: "line",
      source: "heading-line",
      paint: {
        "line-color": HEADING_TOOL_COLOR,
        "line-width": 2,
      },
    });
  }

  if (!map.getSource("heading-label")) {
    map.addSource("heading-label", { type: "geojson", data: emptyFC });
    map.addLayer({
      id: "heading-label-layer",
      type: "symbol",
      source: "heading-label",
      layout: {
        "text-field": ["get", "label"],
        "text-size": 13,
        "text-offset": [0, -1.2],
        "text-anchor": "bottom",
        "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": HEADING_TOOL_COLOR,
        "text-halo-color": NEUTRAL.BLACK,
        "text-halo-width": 1.5,
      },
    });
  }
}

interface UseHeadingToolParams {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  activeTool?: MapTool;
  onHeadingClear?: () => void;
  headingOrigin?: [number, number] | null;
  isHeadingDrawing?: boolean;
  headingData?: {
    point: GeoJSON.FeatureCollection;
    line: GeoJSON.FeatureCollection;
    label: GeoJSON.FeatureCollection;
  };
}

/** heading tool: right-click/esc to clear, mousemove updates sources directly, data->source sync. */
export function useHeadingTool({
  mapRef,
  activeTool,
  onHeadingClear,
  headingOrigin,
  isHeadingDrawing,
  headingData,
}: UseHeadingToolParams) {
  // heading tool: right-click/esc to clear, mousemove updates sources directly (no react state)
  const headingOriginRef = useRef(headingOrigin);
  headingOriginRef.current = headingOrigin;
  const isHeadingDrawingRef = useRef(isHeadingDrawing);
  isHeadingDrawingRef.current = isHeadingDrawing;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const tool = activeTool ?? MapTool.SELECT;
    if (tool !== MapTool.HEADING) return;

    function handleContextMenu(e: maplibregl.MapMouseEvent) {
      e.preventDefault();
      onHeadingClear?.();
    }

    function handleMouseMove(e: maplibregl.MapMouseEvent) {
      const origin = headingOriginRef.current;
      if (!isHeadingDrawingRef.current || !origin) return;

      const cursor: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      const bearing = Math.round(computeBearingFn(origin[0], origin[1], cursor[0], cursor[1]) * 100) / 100;

      // update sources directly - no react re-render
      if (!map!.getSource("heading-point")) return;

      const pointSrc = map!.getSource("heading-point") as maplibregl.GeoJSONSource | undefined;
      if (pointSrc) pointSrc.setData({
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: { kind: "origin" }, geometry: { type: "Point", coordinates: origin } },
          { type: "Feature", properties: { kind: "endpoint", bearing: bearing - 90 }, geometry: { type: "Point", coordinates: cursor } },
        ],
      });

      const lineSrc = map!.getSource("heading-line") as maplibregl.GeoJSONSource | undefined;
      if (lineSrc) lineSrc.setData({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [origin, cursor] } }],
      });

      const labelSrc = map!.getSource("heading-label") as maplibregl.GeoJSONSource | undefined;
      const midLng = (origin[0] + cursor[0]) / 2;
      const midLat = (origin[1] + cursor[1]) / 2;
      if (labelSrc) labelSrc.setData({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: { label: `${bearing.toFixed(2)}°` }, geometry: { type: "Point", coordinates: [midLng, midLat] } }],
      });
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onHeadingClear?.();
      }
    }

    map.on("contextmenu", handleContextMenu);
    map.on("mousemove", handleMouseMove);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      map.off("contextmenu", handleContextMenu);
      map.off("mousemove", handleMouseMove);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mapRef, activeTool, onHeadingClear]);

  // sync heading data to sources
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function sync() {
      /** push heading geojson into map sources. */
      if (!map) return;

      // only add layers if sources missing (first call or after style change)
      if (!map.getSource("heading-point")) addHeadingLayersToMap(map);

      const emptyFC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
      const point = headingData?.point ?? emptyFC;
      const line = headingData?.line ?? emptyFC;
      const label = headingData?.label ?? emptyFC;

      const pointSrc = map.getSource("heading-point") as maplibregl.GeoJSONSource | undefined;
      const lineSrc = map.getSource("heading-line") as maplibregl.GeoJSONSource | undefined;
      const labelSrc = map.getSource("heading-label") as maplibregl.GeoJSONSource | undefined;

      if (pointSrc) pointSrc.setData(point);
      if (lineSrc) lineSrc.setData(line);
      if (labelSrc) labelSrc.setData(label);
    }

    if (map.isStyleLoaded()) {
      sync();
    } else {
      const cancel = waitForStyleLoaded(map, sync);
      return cancel;
    }
  }, [mapRef, headingData]);
}
