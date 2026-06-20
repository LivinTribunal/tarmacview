/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_CESIUM_ION_TOKEN?: string;
  readonly VITE_TILE_IMAGERY_URL?: string;
  readonly VITE_TILE_REFERENCE_URL?: string;
  readonly VITE_TILE_OSM_URL?: string;
  readonly VITE_TILE_IMAGERY_ATTRIBUTION?: string;
  readonly VITE_CESIUM_TERRAIN_URL?: string;
  readonly VITE_CESIUM_IMAGERY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
