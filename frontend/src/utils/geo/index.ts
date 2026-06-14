// re-export barrel - keeps the historic `@/utils/geo` import path stable
// after the split into distance / polygon / centerline modules. `toRad` stays
// internal (cross-module use only), exactly as it was in the old geo.ts.

export {
  EARTH_RADIUS,
  computeBearing,
  haversineDistance,
  formatDistance,
  pixelDistance,
  midpoint,
  rectangleDimensions,
} from "./distance";

export {
  computePolygonArea,
  formatArea,
  circleToPolygon,
  polygonCentroid,
  computePolygonMedianWidth,
} from "./polygon";

export { extractCenterline } from "./centerline";

export { distanceFromCenterline } from "./centerlineDistance";
