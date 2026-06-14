import { useCallback, useEffect } from "react";
import type maplibregl from "maplibre-gl";

export const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

type DrawingLayer = Parameters<maplibregl.Map["addLayer"]>[0];

export interface DrawingSourceSpec {
  /** geojson source id owned by one drawing tool */
  source: string;
  /** layers backed by this source, in paint (add) order */
  layers: DrawingLayer[];
}

/** idempotently add each spec source + its layers (per-source guard, exactly like the old ensureSources). */
export function createDrawingLayer(map: maplibregl.Map, spec: DrawingSourceSpec[]): void {
  for (const { source, layers } of spec) {
    if (map.getSource(source)) continue;
    map.addSource(source, { type: "geojson", data: EMPTY_FC });
    for (const layer of layers) map.addLayer(layer);
  }
}

/** reset every spec source to an empty feature collection. */
export function clearDrawingSources(map: maplibregl.Map, spec: DrawingSourceSpec[]): void {
  for (const { source } of spec) {
    const s = map.getSource(source) as maplibregl.GeoJSONSource | undefined;
    if (s) s.setData(EMPTY_FC);
  }
}

/** tear down layers then sources in reverse (LIFO) order, swallowing missing-id errors. */
export function removeDrawingSources(map: maplibregl.Map, spec: DrawingSourceSpec[]): void {
  for (let i = spec.length - 1; i >= 0; i--) {
    const { layers } = spec[i];
    for (let j = layers.length - 1; j >= 0; j--) {
      const id = layers[j].id;
      try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* noop */ }
    }
  }
  for (let i = spec.length - 1; i >= 0; i--) {
    try { if (map.getSource(spec[i].source)) map.removeSource(spec[i].source); } catch { /* noop */ }
  }
}

interface UseDrawingSources {
  ensure: () => void;
  clear: () => void;
}

/** shared add/clear plumbing for a drawing tool; owns the unmount-only source teardown. */
export default function useDrawingSources(
  map: maplibregl.Map | null,
  spec: DrawingSourceSpec[],
): UseDrawingSources {
  const ensure = useCallback(() => {
    if (map) createDrawingLayer(map, spec);
  }, [map, spec]);

  const clear = useCallback(() => {
    if (map) clearDrawingSources(map, spec);
  }, [map, spec]);

  useEffect(() => {
    return () => { if (map) removeDrawingSources(map, spec); };
  }, [map, spec]);

  return { ensure, clear };
}
