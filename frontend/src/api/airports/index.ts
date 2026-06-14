// re-export barrel - keeps the historic `@/api/airports` import path stable
// after the split into per-sub-resource modules. every name/signature/url is
// identical to the pre-split single file.

export {
  listAirports,
  listAirportSummaries,
  getAirport,
  createAirport,
  lookupAirport,
  updateAirport,
  deleteAirport,
  setDefaultDrone,
  bulkChangeDrone,
} from "./core";

export {
  uploadTerrainDEM,
  deleteTerrainDEM,
  downloadTerrainData,
  fetchElevationAt,
} from "./terrain";

export { extractPhotoMetadata } from "./photoMetadata";

export {
  listSurfaces,
  createSurface,
  updateSurface,
  deleteSurface,
  recalculateSurface,
  createReverseSurface,
  coupleSurface,
  decoupleSurface,
} from "./surfaces";

export {
  listObstacles,
  createObstacle,
  updateObstacle,
  deleteObstacle,
  recalculateObstacle,
} from "./obstacles";

export {
  listSafetyZones,
  createSafetyZone,
  updateSafetyZone,
  deleteSafetyZone,
} from "./safetyZones";

export { listAGLs, createAGL, updateAGL, deleteAGL } from "./agls";

export {
  listLHAs,
  createLHA,
  updateLHA,
  deleteLHA,
  bulkCreateLHAs,
} from "./lhas";
