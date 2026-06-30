import { useRef } from "react";
import type maplibregl from "maplibre-gl";
import useDrawingSources, { type DrawingSourceSpec } from "./useDrawingSources";
import useDrawTool from "./useDrawTool";

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

  useDrawTool(map, active, {
    ensure,
    reset: clear,
    onClick(e) {
      clear();
      onCompleteRef.current([e.lngLat.lng, e.lngLat.lat]);
    },
    onMouseMove(e, m) {
      if (m.isStyleLoaded()) ensure();
      const s = m.getSource(SRC_PREVIEW) as maplibregl.GeoJSONSource | undefined;
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
    },
  });
}
