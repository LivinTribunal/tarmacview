/** shared raster tile endpoints used by the map modules. */

// default external endpoints - kept literal so closed-network deployments can
// override via VITE_TILE_* env vars at build time without losing cloud parity.
const ESRI_WORLD_IMAGERY_DEFAULT =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_REFERENCE_DEFAULT =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const OSM_DEFAULT =
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ESRI_ATTRIBUTION_DEFAULT = "Tiles © Esri";

export const ESRI_WORLD_IMAGERY_TILES =
  import.meta.env.VITE_TILE_IMAGERY_URL || ESRI_WORLD_IMAGERY_DEFAULT;

export const ESRI_REFERENCE_TILES =
  import.meta.env.VITE_TILE_REFERENCE_URL || ESRI_REFERENCE_DEFAULT;

export const OSM_TILES =
  import.meta.env.VITE_TILE_OSM_URL || OSM_DEFAULT;

export const ESRI_ATTRIBUTION =
  import.meta.env.VITE_TILE_IMAGERY_ATTRIBUTION || ESRI_ATTRIBUTION_DEFAULT;
