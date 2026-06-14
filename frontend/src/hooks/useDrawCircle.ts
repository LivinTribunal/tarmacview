import { useEffect, useRef, useCallback, useState } from "react";
import type maplibregl from "maplibre-gl";
import { haversineDistance, circleToPolygon, formatDistance } from "@/utils/geo";
import useDrawingSources, { type DrawingSourceSpec } from "./useDrawingSources";

const SRC_FILL = "draw-circle-fill";
const SRC_STROKE = "draw-circle-stroke";
const SRC_VERTICES = "draw-circle-vertices";
const SRC_LABELS = "draw-circle-labels";
const LYR_FILL = "draw-circle-fill-layer";
const LYR_STROKE = "draw-circle-stroke-layer";
const LYR_RADIUS = "draw-circle-radius-layer";
const LYR_VERTICES = "draw-circle-vertices-layer";
const LYR_LABELS = "draw-circle-labels-layer";

const SPEC: DrawingSourceSpec[] = [
  {
    source: SRC_FILL,
    layers: [{
      id: LYR_FILL,
      type: "fill",
      source: SRC_FILL,
      paint: { "fill-color": "#3bbb3b", "fill-opacity": 0.1 },
    }],
  },
  {
    source: SRC_STROKE,
    layers: [
      {
        id: LYR_STROKE,
        type: "line",
        source: SRC_STROKE,
        filter: ["==", ["get", "kind"], "circle"],
        paint: { "line-color": "#3bbb3b", "line-width": 2, "line-dasharray": [4, 3] },
      },
      {
        id: LYR_RADIUS,
        type: "line",
        source: SRC_STROKE,
        filter: ["==", ["get", "kind"], "radius"],
        paint: { "line-color": "#3bbb3b", "line-width": 1, "line-dasharray": [3, 2] },
      },
    ],
  },
  {
    source: SRC_VERTICES,
    layers: [{
      id: LYR_VERTICES,
      type: "circle",
      source: SRC_VERTICES,
      paint: {
        "circle-radius": 4,
        "circle-color": "#3bbb3b",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    }],
  },
  {
    source: SRC_LABELS,
    layers: [{
      id: LYR_LABELS,
      type: "symbol",
      source: SRC_LABELS,
      layout: {
        "text-field": ["get", "label"],
        "text-size": 12,
        "text-offset": [0, -1.5],
        "text-anchor": "bottom",
        "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#3bbb3b",
        "text-halo-color": "#000000",
        "text-halo-width": 1.5,
      },
    }],
  },
];

export interface CircleResult {
  polygon: GeoJSON.Polygon;
  center: [number, number];
  radius: number;
}

interface UseDrawCircleReturn {
  isDrawing: boolean;
  cancel: () => void;
}

/** circle drawing tool - click center, move to set radius, click to finalize. */
export default function useDrawCircle(
  map: maplibregl.Map | null,
  active: boolean,
  onComplete: (result: CircleResult) => void,
): UseDrawCircleReturn {
  const centerRef = useRef<[number, number] | null>(null);
  const cursorRef = useRef<[number, number] | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const { ensure, clear } = useDrawingSources(map, SPEC);

  const updatePreview = useCallback(() => {
    /** sync circle preview to map sources. */
    if (!map) return;
    if (map.isStyleLoaded()) ensure();
    const center = centerRef.current;
    const cursor = cursorRef.current;

    if (!center || !cursor) {
      clear();
      return;
    }

    const radius = haversineDistance(center[0], center[1], cursor[0], cursor[1]);
    const ring = circleToPolygon(center, radius);

    const fillSrc = map.getSource(SRC_FILL) as maplibregl.GeoJSONSource | undefined;
    if (fillSrc) {
      fillSrc.setData({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [ring] },
        }],
      });
    }

    const strokeSrc = map.getSource(SRC_STROKE) as maplibregl.GeoJSONSource | undefined;
    if (strokeSrc) {
      strokeSrc.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { kind: "circle" },
            geometry: { type: "LineString", coordinates: ring },
          },
          {
            type: "Feature",
            properties: { kind: "radius" },
            geometry: { type: "LineString", coordinates: [center, cursor] },
          },
        ],
      });
    }

    const vertSrc = map.getSource(SRC_VERTICES) as maplibregl.GeoJSONSource | undefined;
    if (vertSrc) {
      vertSrc.setData({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: center },
        }],
      });
    }

    const labelSrc = map.getSource(SRC_LABELS) as maplibregl.GeoJSONSource | undefined;
    if (labelSrc) {
      const mid: [number, number] = [(center[0] + cursor[0]) / 2, (center[1] + cursor[1]) / 2];
      labelSrc.setData({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: { label: `Radius: ${formatDistance(radius)}` },
          geometry: { type: "Point", coordinates: mid },
        }],
      });
    }
  }, [map, ensure, clear]);

  const reset = useCallback(() => {
    /** reset drawing state. */
    centerRef.current = null;
    cursorRef.current = null;
    setIsDrawing(false);
    clear();
  }, [clear]);

  useEffect(() => {
    if (!map || !active) {
      if (map && centerRef.current) reset();
      return;
    }

    if (map.isStyleLoaded()) {
      ensure();
    } else {
      map.once("style.load", () => ensure());
    }

    map.getCanvas().style.cursor = "crosshair";

    function handleClick(e: maplibregl.MapMouseEvent) {
      if (!map) return;
      const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];

      if (!centerRef.current) {
        centerRef.current = lngLat;
        setIsDrawing(true);
        updatePreview();
      } else {
        const center = centerRef.current;
        const radius = haversineDistance(center[0], center[1], lngLat[0], lngLat[1]);
        const ring = circleToPolygon(center, radius);
        const polygon: GeoJSON.Polygon = { type: "Polygon", coordinates: [ring] };
        reset();
        onCompleteRef.current({ polygon, center, radius });
      }
    }

    function handleMouseMove(e: maplibregl.MapMouseEvent) {
      cursorRef.current = [e.lngLat.lng, e.lngLat.lat];
      if (centerRef.current) updatePreview();
    }

    function handleContextMenu(e: maplibregl.MapMouseEvent) {
      e.preventDefault();
      reset();
    }

    map.on("click", handleClick);
    map.on("mousemove", handleMouseMove);
    map.on("contextmenu", handleContextMenu);

    return () => {
      map.off("click", handleClick);
      map.off("mousemove", handleMouseMove);
      map.off("contextmenu", handleContextMenu);
      map.getCanvas().style.cursor = "";
      clear();
    };
  }, [map, active, updatePreview, reset, ensure, clear]);

  return { isDrawing, cancel: reset };
}
