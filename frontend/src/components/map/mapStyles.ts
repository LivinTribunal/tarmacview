import type maplibregl from "maplibre-gl";
import { ESRI_WORLD_IMAGERY_TILES, OSM_TILES } from "@/constants/mapTiles";

export const GLYPHS_URL =
  import.meta.env.VITE_GLYPHS_URL ??
  "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";

/** polls map.isStyleLoaded() until true, then calls callback. returns cancel fn. */
export function waitForStyleLoaded(
  map: maplibregl.Map,
  callback: () => void,
): () => void {
  let cancelled = false;
  function check() {
    if (cancelled) return;
    if (map.isStyleLoaded()) {
      callback();
    } else {
      requestAnimationFrame(check);
    }
  }
  requestAnimationFrame(check);
  return () => { cancelled = true; };
}

/** esri world imagery raster style for satellite terrain mode. */
export function makeSatelliteStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      satellite: {
        type: "raster",
        tiles: [ESRI_WORLD_IMAGERY_TILES],
        tileSize: 256,
        maxzoom: 18,
      },
    },
    layers: [{ id: "satellite-base", type: "raster", source: "satellite" }],
  };
}

/** osm raster style for map terrain mode. */
export function makeMapStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      osm: {
        type: "raster",
        tiles: [OSM_TILES],
        tileSize: 256,
        maxzoom: 19,
      },
    },
    layers: [{ id: "osm-base", type: "raster", source: "osm" }],
  };
}
