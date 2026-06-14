import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type maplibregl from "maplibre-gl";
import { MapTool } from "@/hooks/useMapTools";
import { WAYPOINT_HIGHLIGHT_COLORS, NEUTRAL } from "@/constants/palette";
import { waitForStyleLoaded } from "../mapStyles";

/** add measure tool sources and layers to the map. */
export function addMeasureLayersToMap(map: maplibregl.Map) {
  const emptyFC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

  if (!map.getSource("measure-points")) {
    map.addSource("measure-points", { type: "geojson", data: emptyFC });
    map.addLayer({
      id: "measure-points-layer",
      type: "circle",
      source: "measure-points",
      paint: {
        "circle-radius": 5,
        "circle-color": WAYPOINT_HIGHLIGHT_COLORS.HIGHLIGHT,
        "circle-stroke-color": WAYPOINT_HIGHLIGHT_COLORS.HALO,
        "circle-stroke-width": 2,
      },
    });
  }

  if (!map.getSource("measure-lines")) {
    map.addSource("measure-lines", { type: "geojson", data: emptyFC });
    map.addLayer({
      id: "measure-lines-layer",
      type: "line",
      source: "measure-lines",
      paint: {
        "line-color": WAYPOINT_HIGHLIGHT_COLORS.HIGHLIGHT,
        "line-width": 2,
        "line-dasharray": [4, 3],
      },
    });
  }

  if (!map.getSource("measure-labels")) {
    map.addSource("measure-labels", { type: "geojson", data: emptyFC });
    map.addLayer({
      id: "measure-labels-layer",
      type: "symbol",
      source: "measure-labels",
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
        "text-color": WAYPOINT_HIGHLIGHT_COLORS.HIGHLIGHT,
        "text-halo-color": NEUTRAL.BLACK,
        "text-halo-width": 1.5,
      },
    });
  }
}

interface UseMeasureToolParams {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  activeTool?: MapTool;
  isMeasureDrawing?: boolean;
  onMeasureClear?: () => void;
  onMeasureFinish?: () => void;
  onMeasureMouseMove?: (lng: number, lat: number) => void;
  measureData?: {
    points: GeoJSON.FeatureCollection;
    lines: GeoJSON.FeatureCollection;
    labels: GeoJSON.FeatureCollection;
  };
}

/** measure tool: contextmenu/esc to finish/clear, mousemove cursor line, data->source sync. */
export function useMeasureTool({
  mapRef,
  activeTool,
  isMeasureDrawing,
  onMeasureClear,
  onMeasureFinish,
  onMeasureMouseMove,
  measureData,
}: UseMeasureToolParams) {
  // measure tool: contextmenu to finish/clear, mousemove for cursor line, esc to clear
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const tool = activeTool ?? MapTool.SELECT;
    if (tool !== MapTool.MEASURE) return;

    function handleContextMenu(e: maplibregl.MapMouseEvent) {
      e.preventDefault();
      if (isMeasureDrawing) {
        onMeasureFinish?.();
      } else {
        onMeasureClear?.();
      }
    }

    function handleMouseMove(e: maplibregl.MapMouseEvent) {
      if (isMeasureDrawing) {
        onMeasureMouseMove?.(e.lngLat.lng, e.lngLat.lat);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onMeasureClear?.();
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
  }, [mapRef, activeTool, isMeasureDrawing, onMeasureClear, onMeasureFinish, onMeasureMouseMove]);

  // sync measure data to sources - ensure layers exist first
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    function sync() {
      /** push measure geojson into map sources. */
      if (!map) return;
      if (!map.getSource("measure-points")) addMeasureLayersToMap(map);

      const emptyFC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
      const points = measureData?.points ?? emptyFC;
      const lines = measureData?.lines ?? emptyFC;
      const labels = measureData?.labels ?? emptyFC;

      const pointsSrc = map.getSource("measure-points") as maplibregl.GeoJSONSource | undefined;
      const linesSrc = map.getSource("measure-lines") as maplibregl.GeoJSONSource | undefined;
      const labelsSrc = map.getSource("measure-labels") as maplibregl.GeoJSONSource | undefined;

      if (pointsSrc) pointsSrc.setData(points);
      if (linesSrc) linesSrc.setData(lines);
      if (labelsSrc) labelsSrc.setData(labels);
    }

    if (map.isStyleLoaded()) {
      sync();
    } else {
      const cancel = waitForStyleLoaded(map, sync);
      return cancel;
    }
  }, [mapRef, measureData]);
}
