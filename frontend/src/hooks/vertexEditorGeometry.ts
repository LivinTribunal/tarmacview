import type { MapFeature } from "@/types/map";
import {
  polygonCentroid,
  haversineDistance,
  extractCenterline,
  computeBearing,
  circleToPolygon,
  EARTH_RADIUS,
} from "@/utils/geo";
import { roundAlt } from "@/utils/coordRounding";
import { bufferLineString } from "@/components/map/layers/surfaceLayers";
import { DEFAULT_TAXIWAY_WIDTH_M, DEFAULT_RUNWAY_WIDTH_M } from "@/constants/surface";

export type EditMode = "polygon" | "circle";

export interface EditState {
  mode: EditMode;
  corners: [number, number][];
  center: [number, number];
  radius: number;
}

export interface VertexGeometryUpdate {
  geometry: GeoJSON.Geometry;
  boundary?: GeoJSON.Geometry;
  polygon?: GeoJSON.Geometry;
  width?: number;
  length?: number;
  heading?: number;
}

export function extractEditState(feature: MapFeature): EditState | null {
  /** build edit state from a selected feature. */
  if (feature.type === "safety_zone") {
    const ring = feature.data.geometry.coordinates[0];
    if (!ring || ring.length < 4) return null;
    const corners = ring.slice(0, -1).map(([lng, lat]) => [lng, lat] as [number, number]);
    const center = polygonCentroid(corners);

    // detect circles
    if (corners.length >= 16) {
      const dists = corners.map((c) => haversineDistance(center[0], center[1], c[0], c[1]));
      const avgDist = dists.reduce((s, d) => s + d, 0) / dists.length;
      const isCircle = avgDist > 0 && dists.every((d) => Math.abs(d - avgDist) / avgDist < 0.05);
      if (isCircle) {
        return { mode: "circle", corners: [], center, radius: avgDist };
      }
    }

    return { mode: "polygon", corners, center, radius: 0 };
  }

  if (feature.type === "obstacle") {
    const ring = feature.data.boundary?.coordinates[0];
    if (!ring || ring.length < 4) return null;
    const corners = ring.slice(0, -1).map(([lng, lat]) => [lng, lat] as [number, number]);
    const center = polygonCentroid(corners);

    // detect circles - many vertices (~64) with uniform distance from centroid
    if (corners.length >= 16) {
      const dists = corners.map((c) => haversineDistance(center[0], center[1], c[0], c[1]));
      const avgDist = dists.reduce((s, d) => s + d, 0) / dists.length;
      const isCircle = avgDist > 0 && dists.every((d) => Math.abs(d - avgDist) / avgDist < 0.05);
      if (isCircle) {
        return { mode: "circle", corners: [], center, radius: avgDist };
      }
    }

    return { mode: "polygon", corners, center, radius: 0 };
  }

  if (feature.type === "surface") {
    // use stored boundary polygon directly when available
    if (feature.data.boundary) {
      const ring = feature.data.boundary.coordinates[0];
      if (!ring || ring.length < 4) return null;
      const corners = ring.slice(0, -1).map(([lng, lat]) => [lng, lat] as [number, number]);
      return { mode: "polygon", corners, center: polygonCentroid(corners), radius: 0 };
    }
    // fallback: reconstruct from centerline + width (legacy data without boundary)
    const coords = feature.data.geometry.coordinates;
    if (!coords || coords.length < 2) return null;
    const isTaxiway = feature.data.surface_type === "TAXIWAY";
    const width = isTaxiway ? DEFAULT_TAXIWAY_WIDTH_M : (feature.data.width ?? DEFAULT_RUNWAY_WIDTH_M);
    const ring2d = bufferLineString(coords, width);
    if (ring2d.length < 4) return null;
    const corners = ring2d.slice(0, -1).map(([lng, lat]) => [lng, lat] as [number, number]);
    return { mode: "polygon", corners, center: polygonCentroid(corners), radius: 0 };
  }

  return null;
}

/** compute edge point for circle radius handle (east of center). */
export function radiusEdgePoint(center: [number, number], radiusMeters: number): [number, number] {
  const [lng, lat] = center;
  const R = EARTH_RADIUS;
  const dLng = (radiusMeters / (R * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
  return [lng + dLng, lat];
}

/** rebuild the geometry payload for a vertex edit; null means do not emit. */
export function buildVertexGeometryUpdate(
  feat: MapFeature,
  st: EditState,
): VertexGeometryUpdate | null {
  if (feat.type === "safety_zone") {
    const elevation = feat.data.geometry.coordinates[0]?.[0]?.[2] ?? 0;
    if (st.mode === "circle") {
      const circleRing = circleToPolygon(st.center, st.radius);
      const ring = circleRing.map(([lng, lat]) => [lng, lat, elevation]);
      return { geometry: { type: "Polygon", coordinates: [ring] } };
    }
    if (st.corners.length < 3) return null;
    const ring = [...st.corners.map(([lng, lat]) => [lng, lat, elevation]), [st.corners[0][0], st.corners[0][1], elevation]];
    return { geometry: { type: "Polygon", coordinates: [ring] } };
  }

  if (feat.type === "obstacle") {
    const elevation = feat.data.boundary?.coordinates[0]?.[0]?.[2] ?? 0;
    if (st.mode === "circle") {
      const circleRing = circleToPolygon(st.center, st.radius);
      const ring = circleRing.map(([lng, lat]) => [lng, lat, elevation]);
      const poly = { type: "Polygon" as const, coordinates: [ring] };
      return { geometry: poly, boundary: poly };
    }
    if (st.corners.length < 3) return null;
    const ring = [...st.corners.map(([lng, lat]) => [lng, lat, elevation]), [st.corners[0][0], st.corners[0][1], elevation]];
    const poly = { type: "Polygon" as const, coordinates: [ring] };
    return { geometry: poly, boundary: poly };
  }

  if (feat.type === "surface") {
    if (st.corners.length < 3) return null;
    const elevation = feat.data.boundary?.coordinates[0]?.[0]?.[2]
      ?? feat.data.geometry.coordinates[0]?.[2] ?? 0;
    const pts = st.corners;

    // build polygon from current corners - this is the source of truth
    const polyRing = [...pts.map(([lng, lat]) => [lng, lat, elevation]), [pts[0][0], pts[0][1], elevation]];
    const boundaryGeom = { type: "Polygon" as const, coordinates: [polyRing] };

    // derive centerline from polygon corners for labels/dashes
    const centerline = extractCenterline(pts);
    const clCoords = centerline.map(([lng, lat]) => [lng, lat, elevation]);

    // derive width/length/heading for display (only meaningful for 4-corner polygons)
    let width: number | undefined;
    let length: number | undefined;
    if (pts.length === 4) {
      const d01 = haversineDistance(pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
      const d12 = haversineDistance(pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
      if (d01 >= d12) {
        width = (d12 + haversineDistance(pts[3][0], pts[3][1], pts[0][0], pts[0][1])) / 2;
        length = d01;
      } else {
        width = (d01 + haversineDistance(pts[2][0], pts[2][1], pts[3][0], pts[3][1])) / 2;
        length = d12;
      }
    }
    if (centerline.length < 2) return null;
    const heading = computeBearing(
      centerline[0][0], centerline[0][1], centerline[1][0], centerline[1][1],
    );

    const isTaxiway = feat.data.surface_type === "TAXIWAY";
    const roundedWidth = width != null ? roundAlt(width) : undefined;
    return {
      geometry: { type: "LineString", coordinates: clCoords },
      boundary: boundaryGeom,
      polygon: boundaryGeom,
      width: isTaxiway ? undefined : roundedWidth,
      length: length != null ? roundAlt(length) : undefined,
      heading: heading != null ? Math.round(heading * 10) / 10 : undefined,
    };
  }

  return null;
}
