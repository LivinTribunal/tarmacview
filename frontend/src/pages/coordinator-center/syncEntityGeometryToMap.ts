import type maplibregl from "maplibre-gl";
import type { AirportDetailResponse } from "@/types/airport";
import { AIRPORT_BOUNDARY_SOURCE } from "@/components/map/layers/safetyZoneLayers";
import { AGL_SOURCE, LHA_SOURCE } from "@/components/map/layers/aglLayers";

// tracks current feature collections per source for live geometry preview updates
const sourceDataCache = new Map<string, GeoJSON.FeatureCollection>();

/** drop any cached source snapshots - call on unmount or in tests. */
export function clearSourceDataCache(): void {
  sourceDataCache.clear();
}

function snapshotSource(
  map: maplibregl.Map,
  sourceName: string,
): GeoJSON.FeatureCollection | null {
  /** snapshot current features from a map source into cache via public api. */
  const rendered = map.querySourceFeatures(sourceName);
  if (!rendered.length) return null;
  // strip maplibre-internal fields, keep only standard geojson
  const features: GeoJSON.Feature[] = rendered.map((f) => ({
    type: "Feature",
    properties: f.properties,
    geometry: f.geometry,
  }));
  const fc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };
  sourceDataCache.set(sourceName, fc);
  return fc;
}

/** update a single feature's geometry in a geojson source for live preview. */
export function updateSourceFeatureGeometry(
  map: maplibregl.Map,
  sourceName: string,
  featureId: string,
  geometry: GeoJSON.Geometry,
) {
  const src = map.getSource(sourceName) as maplibregl.GeoJSONSource | undefined;
  if (!src) return;
  const fc = sourceDataCache.get(sourceName) ?? snapshotSource(map, sourceName);
  if (!fc?.features) return;
  const updated = {
    ...fc,
    features: fc.features.map((f) =>
      f.properties?.id === featureId ? { ...f, geometry } : f,
    ),
  };
  sourceDataCache.set(sourceName, updated);
  src.setData(updated);
}

function isGeoJSONGeometry(v: unknown): v is GeoJSON.Geometry {
  /** runtime check that a value looks like a geojson geometry object. */
  return typeof v === "object" && v !== null && "type" in v && "coordinates" in v;
}

function asGeometry(v: unknown): GeoJSON.Geometry | undefined {
  /** narrow unknown to geojson geometry, or undefined if shape is wrong. */
  return isGeoJSONGeometry(v) ? v : undefined;
}

function asPolygon(v: unknown): GeoJSON.Polygon | undefined {
  /** narrow unknown to geojson polygon, or undefined. */
  const g = asGeometry(v);
  return g?.type === "Polygon" ? g : undefined;
}

function asPoint(v: unknown): GeoJSON.Point | undefined {
  /** narrow unknown to geojson point, or undefined. */
  const g = asGeometry(v);
  return g?.type === "Point" ? g : undefined;
}

/** push effective geometry to map sources after a history step, falling back to original when pending data is undefined. */
export function syncEntityGeometryToMap(
  map: maplibregl.Map,
  airport: AirportDetailResponse,
  entityType: string,
  entityId: string,
  pendingData: Record<string, unknown> | undefined,
) {
  const data = pendingData ?? {};

  if (entityType === "surface") {
    const surface = airport.surfaces.find((s) => s.id === entityId);
    if (!surface) return;
    const geometry = asGeometry(data.geometry) ?? surface.geometry;
    const boundary = asPolygon(data.boundary ?? data.polygon) ?? surface.boundary;
    const polySource = surface.surface_type === "RUNWAY" ? "runways-polygon" : "taxiways-polygon";
    const clSource = surface.surface_type === "RUNWAY" ? "runways" : "taxiways";
    if (boundary) updateSourceFeatureGeometry(map, polySource, entityId, boundary);
    if (geometry?.type === "LineString") {
      updateSourceFeatureGeometry(map, clSource, entityId, geometry);
    }
  } else if (entityType === "obstacle") {
    const obstacle = airport.obstacles.find((o) => o.id === entityId);
    if (!obstacle) return;
    const boundary = asPolygon(data.boundary ?? data.geometry) ?? obstacle.boundary;
    if (!boundary) return;
    updateSourceFeatureGeometry(map, "obstacles-boundary", entityId, boundary);
    const ring = boundary.coordinates[0];
    const cx = ring.reduce((s, c) => s + c[0], 0) / ring.length;
    const cy = ring.reduce((s, c) => s + c[1], 0) / ring.length;
    const cz = ring.reduce((s, c) => s + (c[2] ?? 0), 0) / ring.length;
    updateSourceFeatureGeometry(map, "obstacles", entityId, {
      type: "Point",
      coordinates: [cx, cy, cz],
    });
  } else if (entityType === "safety_zone") {
    const zone = airport.safety_zones.find((z) => z.id === entityId);
    if (!zone) return;
    const geometry = asPolygon(data.geometry) ?? zone.geometry;
    if (!geometry) return;
    if (zone.type === "AIRPORT_BOUNDARY") {
      const src = map.getSource(AIRPORT_BOUNDARY_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      src.setData({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: { id: entityId, name: zone.name, entityType: "airport_boundary", role: "outline" },
          geometry,
        }],
      });
    } else {
      updateSourceFeatureGeometry(map, "safety-zones", entityId, geometry);
    }
  } else if (entityType === "agl") {
    const agl = airport.surfaces.flatMap((s) => s.agls).find((a) => a.id === entityId);
    if (!agl) return;
    const position = asPoint(data.position) ?? agl.position;
    if (position) updateSourceFeatureGeometry(map, AGL_SOURCE, entityId, position);
  } else if (entityType === "lha") {
    const lha = airport.surfaces
      .flatMap((s) => s.agls.flatMap((a) => a.lhas))
      .find((l) => l.id === entityId);
    if (!lha) return;
    const position = asPoint(data.position) ?? lha.position;
    if (position) updateSourceFeatureGeometry(map, LHA_SOURCE, entityId, position);
  }
}
