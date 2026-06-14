import { useEffect, useRef } from "react";
import type maplibregl from "maplibre-gl";
import useDrawingSources, { type DrawingSourceSpec } from "./useDrawingSources";

const SRC_PREVIEW = "draw-point-preview";
const LYR_PREVIEW = "draw-point-preview-layer";

const SPEC: DrawingSourceSpec[] = [
  {
    source: SRC_PREVIEW,
    layers: [{
      id: LYR_PREVIEW,
      type: "circle",
      source: SRC_PREVIEW,
      paint: {
        "circle-radius": 6,
        "circle-color": "#3bbb3b",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-opacity": 0.7,
      },
    }],
  },
];

/** point placement tool - single click to place, cursor preview follows mouse. */
export default function usePlacePoint(
  map: maplibregl.Map | null,
  active: boolean,
  onComplete: (point: [number, number]) => void,
): void {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const { ensure, clear } = useDrawingSources(map, SPEC);

  useEffect(() => {
    if (!map || !active) return;

    if (map.isStyleLoaded()) {
      ensure();
    } else {
      map.once("style.load", () => ensure());
    }

    map.getCanvas().style.cursor = "crosshair";

    function handleClick(e: maplibregl.MapMouseEvent) {
      if (!map) return;
      clear();
      onCompleteRef.current([e.lngLat.lng, e.lngLat.lat]);
    }

    function handleMouseMove(e: maplibregl.MapMouseEvent) {
      if (!map) return;
      if (map.isStyleLoaded()) ensure();
      const s = map.getSource(SRC_PREVIEW) as maplibregl.GeoJSONSource | undefined;
      if (s) {
        s.setData({
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: [e.lngLat.lng, e.lngLat.lat] },
          }],
        });
      }
    }

    function handleContextMenu(e: maplibregl.MapMouseEvent) {
      e.preventDefault();
      // right-click does nothing special for point, just prevents context menu
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
  }, [map, active, ensure, clear]);
}
