import type maplibregl from "maplibre-gl";

export const SRC_NODES = "vertex-edit-nodes";
export const SRC_MIDPOINTS = "vertex-edit-midpoints";
export const LYR_CORNERS = "vertex-edit-corners";
export const LYR_CENTER = "vertex-edit-center";
export const LYR_MIDPOINTS = "vertex-edit-midpoints";

export const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function ensureSources(map: maplibregl.Map) {
  /** add vertex editing overlay source and layers. */
  if (map.getSource(SRC_NODES)) return;

  map.addSource(SRC_NODES, { type: "geojson", data: EMPTY_FC });

  // corner vertices - white/green
  map.addLayer({
    id: LYR_CORNERS,
    type: "circle",
    source: SRC_NODES,
    filter: ["in", ["get", "kind"], ["literal", ["corner", "radius"]]],
    paint: {
      "circle-radius": 5,
      "circle-color": "#ffffff",
      "circle-stroke-color": [
        "case",
        ["==", ["get", "kind"], "radius"], "#4595e5",
        "#3bbb3b",
      ],
      "circle-stroke-width": 2,
    },
  });

  // center mover - blue, larger
  map.addLayer({
    id: LYR_CENTER,
    type: "circle",
    source: SRC_NODES,
    filter: ["==", ["get", "kind"], "center"],
    paint: {
      "circle-radius": 7,
      "circle-color": "#4595e5",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });

  // ghost midpoint for edge insertion preview
  if (!map.getSource(SRC_MIDPOINTS)) {
    map.addSource(SRC_MIDPOINTS, { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: LYR_MIDPOINTS,
      type: "circle",
      source: SRC_MIDPOINTS,
      paint: {
        "circle-radius": 4,
        "circle-color": "#ffffff",
        "circle-stroke-color": "#3bbb3b",
        "circle-stroke-width": 1.5,
        "circle-opacity": 0.6,
        "circle-stroke-opacity": 0.6,
      },
    });
  }
}

export function clearSources(map: maplibregl.Map) {
  /** clear vertex editing overlay data. */
  const s = map.getSource(SRC_NODES) as maplibregl.GeoJSONSource | undefined;
  if (s) s.setData(EMPTY_FC);
  const m = map.getSource(SRC_MIDPOINTS) as maplibregl.GeoJSONSource | undefined;
  if (m) m.setData(EMPTY_FC);
}

export function removeSources(map: maplibregl.Map) {
  /** remove vertex editing layers and sources. */
  for (const lyr of [LYR_MIDPOINTS, LYR_CENTER, LYR_CORNERS]) {
    try { if (map.getLayer(lyr)) map.removeLayer(lyr); } catch (e) { console.warn("vertex editor: failed to remove layer", lyr, e); }
  }
  for (const src of [SRC_MIDPOINTS, SRC_NODES]) {
    try { if (map.getSource(src)) map.removeSource(src); } catch (e) { console.warn("vertex editor: failed to remove source", src, e); }
  }
}

/** poll map.isStyleLoaded() until true, then call callback. returns cancel fn. */
export function waitForStyleLoaded(map: maplibregl.Map, callback: () => void): () => void {
  let cancelled = false;
  let ticks = 0;
  function check() {
    if (cancelled) return;
    if (ticks++ > 300) {
      console.warn("vertex editor: style load timed out after ~5s");
      return;
    }
    if (map.isStyleLoaded()) callback();
    else requestAnimationFrame(check);
  }
  requestAnimationFrame(check);
  return () => { cancelled = true; };
}
