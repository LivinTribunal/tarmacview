import { Cartesian3, Cartographic, Math as CesiumMath } from "cesium";
import { EARTH_RADIUS_M } from "@/constants/geo";
import type { PolygonZ, LineStringZ } from "@/types/common";

/** convert a geojson polygon to a cesium cartesian3 array for polygon hierarchy. */
export function polygonToCartesian3(polygon: PolygonZ): Cartesian3[] {
  const ring = polygon.coordinates[0];
  return ring.map(([lng, lat, alt]) =>
    Cartesian3.fromDegrees(lng, lat, alt ?? 0),
  );
}

/** convert a geojson linestringz to a cesium cartesian3 array. */
export function lineStringToCartesian3(line: LineStringZ): Cartesian3[] {
  return line.coordinates.map(([lng, lat, alt]) =>
    Cartesian3.fromDegrees(lng, lat, alt ?? 0),
  );
}

// maplibre ground resolution at zoom 0 (metres per pixel at equator)
const METERS_PER_PIXEL_Z0 = 156543.03392;
// cesium default vertical field of view (60 degrees) - used for altitude calculations
const CESIUM_FOV = Math.PI / 3;
const HALF_FOV_TAN = Math.tan(CESIUM_FOV / 2);
const DEG_TO_RAD = Math.PI / 180;
const M_PER_DEG_LAT = EARTH_RADIUS_M * DEG_TO_RAD;

/** convert maplibre center/zoom to cesium camera params. */
export function maplibreToCesiumCamera(
  center: { lng: number; lat: number },
  zoom: number,
  bearing: number,
  pitch: number,
  viewportHeight: number,
): {
  destination: Cartesian3;
  orientation: { heading: number; pitch: number; roll: number };
} {
  const latRad = center.lat * DEG_TO_RAD;
  const metersPerPixel =
    (METERS_PER_PIXEL_Z0 * Math.cos(latRad)) / Math.pow(2, zoom);
  const altitude = (metersPerPixel * viewportHeight) / (2 * HALF_FOV_TAN);

  const headingRad = CesiumMath.toRadians((360 - bearing) % 360);
  const pitchRad = CesiumMath.toRadians(-(90 - pitch));

  // when tilted, maplibre center is the look-at target on the ground,
  // but cesium destination is the camera position. offset backward
  // along the bearing direction so the viewport centers match.
  let camLng = center.lng;
  let camLat = center.lat;
  const pitchMlRad = pitch * DEG_TO_RAD;

  if (pitch > 0.5) {
    const groundOffset = altitude * Math.tan(pitchMlRad);
    const bearingRad = bearing * DEG_TO_RAD;
    const mPerDegLng = M_PER_DEG_LAT * Math.cos(latRad);
    camLat = center.lat - (groundOffset * Math.cos(bearingRad)) / M_PER_DEG_LAT;
    camLng = center.lng - (groundOffset * Math.sin(bearingRad)) / mPerDegLng;
  }

  const destination = Cartesian3.fromDegrees(camLng, camLat, altitude);
  return {
    destination,
    orientation: { heading: headingRad, pitch: pitchRad, roll: 0 },
  };
}

/** convert cesium camera to maplibre center/zoom/bearing. */
export function cesiumToMaplibreCamera(
  position: Cartesian3,
  heading: number,
  pitch: number,
  viewportHeight: number,
): {
  center: { lng: number; lat: number };
  zoom: number;
  bearing: number;
  pitch: number;
} {
  const carto = Cartographic.fromCartesian(position);
  const camLng = CesiumMath.toDegrees(carto.longitude);
  const camLat = CesiumMath.toDegrees(carto.latitude);
  const alt = carto.height;

  const latRad = camLat * DEG_TO_RAD;
  const metersPerPixel = (alt * 2 * HALF_FOV_TAN) / Math.max(viewportHeight, 1);
  const zoom = Math.log2(
    (METERS_PER_PIXEL_Z0 * Math.cos(latRad)) / Math.max(metersPerPixel, 0.001),
  );
  const bearingDeg = (360 - CesiumMath.toDegrees(heading)) % 360;
  const pitchDeg = 90 + CesiumMath.toDegrees(pitch);

  // project forward from camera position to find the look-at target,
  // which is what maplibre uses as its center coordinate.
  let centerLng = camLng;
  let centerLat = camLat;
  const pitchMlRad = Math.max(0, pitchDeg) * DEG_TO_RAD;

  if (pitchDeg > 0.5) {
    const groundOffset = alt * Math.tan(pitchMlRad);
    const bearingRad = bearingDeg * DEG_TO_RAD;
    const mPerDegLng = M_PER_DEG_LAT * Math.cos(latRad);
    centerLat = camLat + (groundOffset * Math.cos(bearingRad)) / M_PER_DEG_LAT;
    centerLng = camLng + (groundOffset * Math.sin(bearingRad)) / mPerDegLng;
  }

  return {
    center: { lng: centerLng, lat: centerLat },
    zoom: Math.max(0, Math.min(22, zoom)),
    bearing: bearingDeg,
    pitch: Math.max(0, Math.min(85, pitchDeg)),
  };
}

// re-exported so 2D and 3D buffer renderers stay in sync
export { bufferPolygon } from "../layers/obstacleLayers";
