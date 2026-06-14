import { useEffect, useRef, useCallback, useState } from "react";
import type maplibregl from "maplibre-gl";
import { computePolygonArea, formatArea, pixelDistance } from "@/utils/geo";
import useDrawingSources, { EMPTY_FC, type DrawingSourceSpec } from "./useDrawingSources";

const SNAP_PX = 15;
const SRC_FILL = "draw-polygon-fill";
const SRC_STROKE = "draw-polygon-stroke";
const SRC_VERTICES = "draw-polygon-vertices";
const SRC_LABELS = "draw-polygon-labels";
const LYR_FILL = "draw-polygon-fill-layer";
const LYR_STROKE_SOLID = "draw-polygon-stroke-solid";
const LYR_STROKE_DASHED = "draw-polygon-stroke-dashed";
const LYR_VERTICES = "draw-polygon-vertices-layer";
const LYR_LABELS = "draw-polygon-labels-layer";

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
        id: LYR_STROKE_SOLID,
        type: "line",
        source: SRC_STROKE,
        filter: ["==", ["get", "dashed"], false],
        paint: { "line-color": "#3bbb3b", "line-width": 2 },
      },
      {
        id: LYR_STROKE_DASHED,
        type: "line",
        source: SRC_STROKE,
        filter: ["==", ["get", "dashed"], true],
        paint: { "line-color": "#3bbb3b", "line-width": 1, "line-dasharray": [4, 3] },
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
        "circle-radius": ["case", ["get", "isSnapTarget"], 7, 4],
        "circle-color": "#3bbb3b",
        "circle-stroke-color": ["case", ["get", "isSnapTarget"], "#ffffff", "#ffffff"],
        "circle-stroke-width": ["case", ["get", "isSnapTarget"], 3, 2],
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

interface UseDrawPolygonReturn {
  isDrawing: boolean;
  cancel: () => void;
}

/** polygon drawing tool - click to add vertices, double-click or snap to first to close. */
export default function useDrawPolygon(
  map: maplibregl.Map | null,
  active: boolean,
  onComplete: (polygon: GeoJSON.Polygon) => void,
): UseDrawPolygonReturn {
  const verticesRef = useRef<[number, number][]>([]);
  const cursorRef = useRef<[number, number] | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const { ensure, clear } = useDrawingSources(map, SPEC);

  const updatePreview = useCallback(() => {
    /** sync drawing preview to map sources. */
    if (!map) return;
    if (map.isStyleLoaded()) ensure();
    const verts = verticesRef.current;
    const cursor = cursorRef.current;

    const fillSrc = map.getSource(SRC_FILL) as maplibregl.GeoJSONSource | undefined;
    if (fillSrc) {
      if (verts.length >= 2) {
        const ring = cursor ? [...verts, cursor, verts[0]] : [...verts, verts[0]];
        fillSrc.setData({
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            properties: {},
            geometry: { type: "Polygon", coordinates: [ring] },
          }],
        });
      } else {
        fillSrc.setData(EMPTY_FC);
      }
    }

    const strokeSrc = map.getSource(SRC_STROKE) as maplibregl.GeoJSONSource | undefined;
    if (strokeSrc) {
      const features: GeoJSON.Feature[] = [];
      for (let i = 1; i < verts.length; i++) {
        features.push({
          type: "Feature",
          properties: { dashed: false },
          geometry: { type: "LineString", coordinates: [verts[i - 1], verts[i]] },
        });
      }
      if (verts.length > 0 && cursor) {
        features.push({
          type: "Feature",
          properties: { dashed: false },
          geometry: { type: "LineString", coordinates: [verts[verts.length - 1], cursor] },
        });
      }
      // dashed closing line from cursor (or last vertex) back to first
      if (verts.length >= 2) {
        const lastPt = cursor ?? verts[verts.length - 1];
        features.push({
          type: "Feature",
          properties: { dashed: true },
          geometry: { type: "LineString", coordinates: [lastPt, verts[0]] },
        });
      }
      strokeSrc.setData({ type: "FeatureCollection", features });
    }

    const vertSrc = map.getSource(SRC_VERTICES) as maplibregl.GeoJSONSource | undefined;
    if (vertSrc) {
      let isSnapping = false;
      if (verts.length >= 3 && cursor) {
        const dist = pixelDistance(map, cursor, verts[0]);
        isSnapping = dist <= SNAP_PX;
      }
      vertSrc.setData({
        type: "FeatureCollection",
        features: verts.map((v, i) => ({
          type: "Feature" as const,
          properties: { index: i, isSnapTarget: i === 0 && isSnapping },
          geometry: { type: "Point" as const, coordinates: v },
        })),
      });
    }

    const labelSrc = map.getSource(SRC_LABELS) as maplibregl.GeoJSONSource | undefined;
    if (labelSrc) {
      if (verts.length >= 3) {
        const area = computePolygonArea(verts);
        const centroid: [number, number] = [
          verts.reduce((s, v) => s + v[0], 0) / verts.length,
          verts.reduce((s, v) => s + v[1], 0) / verts.length,
        ];
        labelSrc.setData({
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            properties: { label: formatArea(area) },
            geometry: { type: "Point", coordinates: cursor ?? centroid },
          }],
        });
      } else {
        labelSrc.setData(EMPTY_FC);
      }
    }
  }, [map, ensure]);

  const reset = useCallback(() => {
    /** reset drawing state. */
    verticesRef.current = [];
    cursorRef.current = null;
    setIsDrawing(false);
    clear();
  }, [clear]);

  const closePolygon = useCallback(() => {
    /** close the polygon and emit completed geometry. */
    const verts = verticesRef.current;
    if (verts.length < 3) return;
    const ring = [...verts, verts[0]];
    const polygon: GeoJSON.Polygon = { type: "Polygon", coordinates: [ring] };
    reset();
    onCompleteRef.current(polygon);
  }, [reset]);

  useEffect(() => {
    if (!map || !active) {
      if (map && verticesRef.current.length > 0) reset();
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
      const verts = verticesRef.current;

      // snap to first vertex to close
      if (verts.length >= 3) {
        const dist = pixelDistance(map, lngLat, verts[0]);
        if (dist <= SNAP_PX) {
          closePolygon();
          return;
        }
      }

      verticesRef.current = [...verts, lngLat];
      setIsDrawing(true);
      updatePreview();
    }

    function handleMouseMove(e: maplibregl.MapMouseEvent) {
      cursorRef.current = [e.lngLat.lng, e.lngLat.lat];
      updatePreview();
    }

    function handleDblClick(e: maplibregl.MapMouseEvent) {
      e.preventDefault();
      if (verticesRef.current.length >= 3) {
        closePolygon();
      }
    }

    function handleContextMenu(e: maplibregl.MapMouseEvent) {
      e.preventDefault();
      reset();
    }

    map.on("click", handleClick);
    map.on("mousemove", handleMouseMove);
    map.on("dblclick", handleDblClick);
    map.on("contextmenu", handleContextMenu);

    return () => {
      map.off("click", handleClick);
      map.off("mousemove", handleMouseMove);
      map.off("dblclick", handleDblClick);
      map.off("contextmenu", handleContextMenu);
      map.getCanvas().style.cursor = "";
      clear();
    };
  }, [map, active, updatePreview, closePolygon, reset, ensure, clear]);

  return { isDrawing, cancel: reset };
}
