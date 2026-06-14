import {
  createSurface,
  createObstacle,
  createSafetyZone,
  createAGL,
  createLHA,
} from "@/api/airports";
import type { AirportDetailResponse } from "@/types/airport";
import type { ElevationResolver } from "@/utils/takeoffLandingPlacement";
import {
  extractCenterline,
  circleToPolygon,
  haversineDistance,
  computeBearing,
} from "@/utils/geo";
import { roundAlt } from "@/utils/coordRounding";
import { openRing, derivePolygonWidth } from "@/utils/polygonGeometryDerivation";
import { buildLhaCreatePayload } from "@/pages/coordinator-center/buildLhaCreatePayload";
import {
  resolveRingZ,
  resolvePointAltitude,
} from "@/pages/coordinator-center/resolveCreationElevations";

export interface EntityCreateContext {
  id: string;
  airport: AirportDetailResponse;
  elevationResolver: ElevationResolver | undefined;
  fallbackElevation: number;
  pendingGeometry: GeoJSON.Polygon | null;
  pendingCircleCenter: [number, number] | undefined;
  pendingPointPosition: [number, number] | undefined;
  pendingLhaParentAglId: string | null;
}

async function createSurfaceEntity(
  entityType: string,
  data: Record<string, unknown>,
  ctx: EntityCreateContext,
): Promise<void> {
  /** build and submit a runway/taxiway surface create payload. */
  const { id, elevationResolver, fallbackElevation, pendingGeometry } = ctx;
  if (!pendingGeometry) throw new Error("missing geometry");
  const ring = pendingGeometry.coordinates[0] as [number, number][];

  // store the drawn polygon as boundary (source of truth) with per-vertex Z
  const boundaryCoords: [number, number, number][][] = await Promise.all(
    pendingGeometry.coordinates.map((r) =>
      resolveRingZ(r as [number, number][], elevationResolver, fallbackElevation),
    ),
  );

  // derive centerline from the polygon for labels/dashes - per-vertex Z too
  const centerline = extractCenterline(ring);
  const geomCoords: [number, number, number][] = await resolveRingZ(
    centerline,
    elevationResolver,
    fallbackElevation,
  );

  // derive width/length/heading from polygon for metadata
  const pts = openRing(ring);
  let drawnLength: number | undefined;

  // length from centerline
  if (centerline.length >= 2) {
    drawnLength = haversineDistance(centerline[0][0], centerline[0][1], centerline[1][0], centerline[1][1]);
  }

  const drawnWidth = derivePolygonWidth(ring, centerline, pts);
  // geographic bearing - naive atan2 on lng/lat deltas is off by several
  // degrees at non-equatorial latitudes
  const drawnHeading = computeBearing(
    centerline[0][0], centerline[0][1], centerline[1][0], centerline[1][1],
  );

  // prefer user-entered form values over the derived ones
  const formHeading = typeof data.heading === "number" ? data.heading : undefined;
  const formLength = typeof data.length === "number" ? data.length : undefined;
  const formWidth = typeof data.width === "number" ? data.width : undefined;

  const roundedDrawnWidth = drawnWidth != null ? roundAlt(drawnWidth) : undefined;
  const roundedDrawnLength = drawnLength != null ? roundAlt(drawnLength) : undefined;
  const roundedDrawnHeading = Math.round(drawnHeading * 10) / 10;

  // touchpoint alt auto-fills from dem when the form left it blank
  let touchpointAlt = data.touchpoint_altitude as number | undefined;
  const tpLat = data.touchpoint_latitude as number | undefined;
  const tpLon = data.touchpoint_longitude as number | undefined;
  if (touchpointAlt == null && tpLat != null && tpLon != null) {
    touchpointAlt = await resolvePointAltitude(
      tpLat,
      tpLon,
      elevationResolver,
      fallbackElevation,
    );
  }

  // threshold/end ride as WKT POINT Z strings off the runway form; the backend
  // schema accepts the same wire shape it persists, so reparse them into the
  // structured PointZ that createSurface expects.
  const thresholdPosition = parsePointZ(data.threshold_position);
  const endPosition = parsePointZ(data.end_position);

  await createSurface(id, {
    identifier: String(data.name ?? ""),
    surface_type: entityType === "runway" ? "RUNWAY" : "TAXIWAY",
    geometry: { type: "LineString", coordinates: geomCoords },
    boundary: { type: "Polygon", coordinates: boundaryCoords },
    heading: formHeading ?? roundedDrawnHeading,
    length: formLength ?? roundedDrawnLength,
    width: entityType === "runway" ? (formWidth ?? roundedDrawnWidth) : undefined,
    threshold_position: thresholdPosition,
    end_position: endPosition,
    touchpoint_latitude: tpLat,
    touchpoint_longitude: tpLon,
    touchpoint_altitude: touchpointAlt,
  });
}

/** parse a "POINT Z (lon lat alt)" wkt string into the wire PointZ shape. */
function parsePointZ(
  value: unknown,
): { type: "Point"; coordinates: [number, number, number] } | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(
    /^POINT\s*Z\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i,
  );
  if (!match) return undefined;
  return {
    type: "Point",
    coordinates: [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])],
  };
}

async function createSafetyZoneEntity(
  entityType: string,
  data: Record<string, unknown>,
  ctx: EntityCreateContext,
): Promise<void> {
  /** build and submit a safety-zone create payload. */
  const { id, elevationResolver, fallbackElevation, pendingGeometry } = ctx;
  if (!pendingGeometry) throw new Error("missing geometry");
  const polyCoords: [number, number, number][][] = await Promise.all(
    pendingGeometry.coordinates.map((ring) =>
      resolveRingZ(ring as [number, number][], elevationResolver, fallbackElevation),
    ),
  );
  const zoneType = entityType
    .replace("safety_zone_", "")
    .toUpperCase()
    .replace("NO_FLY", "TEMPORARY_NO_FLY") as
    | "CTR"
    | "RESTRICTED"
    | "PROHIBITED"
    | "TEMPORARY_NO_FLY"
    | "AIRPORT_BOUNDARY";
  const isBoundary = zoneType === "AIRPORT_BOUNDARY";
  await createSafetyZone(id, {
    name: String(data.name ?? ""),
    type: zoneType,
    geometry: { type: "Polygon", coordinates: polyCoords },
    altitude_floor: isBoundary ? undefined : (data.altitude_floor as number | undefined),
    altitude_ceiling: isBoundary ? undefined : (data.altitude_ceiling as number | undefined),
    is_active: isBoundary ? true : (data.is_active as boolean | undefined),
  });
}

async function createObstacleEntity(
  data: Record<string, unknown>,
  ctx: EntityCreateContext,
): Promise<void> {
  /** build and submit an obstacle create payload. */
  const {
    id,
    elevationResolver,
    fallbackElevation,
    pendingGeometry,
    pendingCircleCenter,
    pendingPointPosition,
  } = ctx;
  const bufferDist = (data.buffer_distance as number) ?? 5.0;
  // polygon obstacle gets per-vertex dem; circle/point uses the form's submitted alt
  let obstacleCoords: [number, number, number][];
  if (pendingGeometry) {
    obstacleCoords = await resolveRingZ(
      pendingGeometry.coordinates[0] as [number, number][],
      elevationResolver,
      fallbackElevation,
    );
  } else {
    const center = (data.center as [number, number]) ?? pendingCircleCenter ?? pendingPointPosition;
    if (!center) throw new Error("missing position");
    const formAlt = typeof data.altitude === "number" ? data.altitude : fallbackElevation;
    const ring = circleToPolygon(center, Math.max(bufferDist, 1));
    obstacleCoords = ring.map(([lng, lat]): [number, number, number] => [lng, lat, formAlt]);
  }
  await createObstacle(id, {
    name: String(data.name ?? ""),
    height: (data.height as number) ?? 0,
    boundary: { type: "Polygon", coordinates: [obstacleCoords] },
    buffer_distance: bufferDist,
    type: (data.type as "BUILDING" | "TOWER" | "ANTENNA" | "VEGETATION" | "OTHER") ?? "BUILDING",
  });
}

async function createAglEntity(
  data: Record<string, unknown>,
  ctx: EntityCreateContext,
): Promise<void> {
  /** build and submit an agl create payload. */
  const { id, fallbackElevation, pendingPointPosition } = ctx;
  const pos = (data.center as [number, number]) ?? pendingPointPosition;
  if (!pos) throw new Error("missing position");
  const sid = data.surface_id as string;
  if (!sid) throw new Error("missing surface");
  const aglTypeValue = String(data.agl_type ?? "PAPI");
  const normalizedAglType: "PAPI" | "RUNWAY_EDGE_LIGHTS" =
    aglTypeValue === "RUNWAY_EDGE_LIGHTS" ? "RUNWAY_EDGE_LIGHTS" : "PAPI";
  const altZ = typeof data.altitude === "number" ? data.altitude : fallbackElevation;
  await createAGL(id, sid, {
    agl_type: normalizedAglType,
    name: String(data.name ?? ""),
    position: { type: "Point", coordinates: [pos[0], pos[1], altZ] },
    side: data.side as "LEFT" | "RIGHT" | undefined,
    glide_slope_angle: data.glide_slope_angle as number | undefined,
    distance_from_threshold: data.distance_from_threshold as number | undefined,
  });
}

async function createLhaEntity(
  data: Record<string, unknown>,
  ctx: EntityCreateContext,
): Promise<void> {
  /** build and submit an lha create payload. */
  const { id, airport, fallbackElevation, pendingPointPosition, pendingLhaParentAglId } = ctx;
  const pos = (data.center as [number, number]) ?? pendingPointPosition;
  if (!pos) throw new Error("missing position");
  const aglId = (data.agl_id as string) || pendingLhaParentAglId;
  if (!aglId) throw new Error("missing AGL");
  // find the surface that owns this agl
  const parentSurface = airport.surfaces.find((s) =>
    s.agls.some((a) => a.id === aglId),
  );
  if (!parentSurface) throw new Error("missing parent surface");
  // ensure data.altitude is set for the lha payload builder
  const lhaData = typeof data.altitude === "number"
    ? data
    : { ...data, altitude: fallbackElevation };
  await createLHA(id, parentSurface.id, aglId, buildLhaCreatePayload(lhaData, pos));
}

/** dispatch a creation-form submit to the matching per-entity build routine. */
export async function createEntity(
  entityType: string,
  data: Record<string, unknown>,
  ctx: EntityCreateContext,
): Promise<void> {
  if (entityType === "runway" || entityType === "taxiway") {
    await createSurfaceEntity(entityType, data, ctx);
  } else if (entityType.startsWith("safety_zone_")) {
    await createSafetyZoneEntity(entityType, data, ctx);
  } else if (entityType === "obstacle") {
    await createObstacleEntity(data, ctx);
  } else if (entityType === "agl") {
    await createAglEntity(data, ctx);
  } else if (entityType === "lha") {
    await createLhaEntity(data, ctx);
  } else {
    throw new Error(`unknown entity type: ${entityType}`);
  }
}
