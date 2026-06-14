import type maplibregl from "maplibre-gl";
import type { MapFeature } from "@/types/map";
import type { WaypointResponse } from "@/types/flightPlan";
import type { AirportDetailResponse } from "@/types/airport";
import { interpolateAltitude } from "@/utils/altitudeInterpolation";
import {
  WAYPOINT_TRANSIT_CIRCLE_LAYER,
  WAYPOINT_MEASUREMENT_CIRCLE_LAYER,
  WAYPOINT_TAKEOFF_LAYER,
  WAYPOINT_LANDING_LAYER,
  WAYPOINT_HOVER_LAYER,
  SIMPLIFIED_TAKEOFF_LAYER,
  SIMPLIFIED_LANDING_LAYER,
} from "../layers/waypointLayers";
import {
  SAFETY_ZONE_FILL_LAYER,
  SAFETY_ZONE_HATCH_LAYER,
  SAFETY_ZONE_BORDER_LAYER,
  AIRPORT_BOUNDARY_LINE_LAYER,
} from "../layers/safetyZoneLayers";
import { OBSTACLE_BOUNDARY_LAYER } from "../layers/obstacleLayers";

/** all waypoint layer ids that participate in pick + hover, ordered as in
 * usePickAndSelect's original handlers (transit/measurement first, then T/L,
 * hover, and the two simplified-trajectory T/L markers). */
export const WAYPOINT_QUERY_LAYERS = [
  WAYPOINT_TRANSIT_CIRCLE_LAYER,
  WAYPOINT_MEASUREMENT_CIRCLE_LAYER,
  WAYPOINT_TAKEOFF_LAYER,
  WAYPOINT_LANDING_LAYER,
  WAYPOINT_HOVER_LAYER,
  SIMPLIFIED_TAKEOFF_LAYER,
  SIMPLIFIED_LANDING_LAYER,
];

/** waypoint layer ids that drive hover-ring highlighting. excludes the two
 * simplified T/L markers because the hover ring isn't used in simplified mode. */
export const ALL_WP_HOVER_LAYERS = [
  WAYPOINT_TRANSIT_CIRCLE_LAYER,
  WAYPOINT_MEASUREMENT_CIRCLE_LAYER,
  WAYPOINT_TAKEOFF_LAYER,
  WAYPOINT_LANDING_LAYER,
  WAYPOINT_HOVER_LAYER,
];

/** resolve transit insertion altitude + after_seq from a transit-hit feature's properties. */
export function resolveTransitInsertion(
  properties: Record<string, unknown> | null | undefined,
  lngLat: { lng: number; lat: number },
): { alt: number; afterSeq: number } {
  const props = properties ?? {};
  const fromAlt = (typeof props.from_alt === "number" ? props.from_alt : 0);
  const toAlt = (typeof props.to_alt === "number" ? props.to_alt : fromAlt);
  const afterSeq = (typeof props.from_seq === "number" ? props.from_seq : 0);
  const { from_lng: fromLng, from_lat: fromLat, to_lng: toLng, to_lat: toLat } = props;
  const alt = (
    typeof fromLng === "number" && typeof fromLat === "number"
    && typeof toLng === "number" && typeof toLat === "number"
  )
    ? interpolateAltitude([fromLng, fromLat, fromAlt], [toLng, toLat, toAlt], [lngLat.lng, lngLat.lat])
    : fromAlt;
  return { alt, afterSeq };
}

/** build a waypoint MapFeature from a queried layer hit. */
export function buildWaypointFeature(
  wpHit: maplibregl.MapGeoJSONFeature,
  waypoints: WaypointResponse[] | undefined,
): { wpId: string; feature: MapFeature } | null {
  const wpId = String(wpHit.properties?.id ?? "");
  if (!wpId) return null;
  const coords = wpHit.geometry && "coordinates" in wpHit.geometry
    ? (wpHit.geometry as GeoJSON.Point).coordinates
    : [0, 0, 0];
  const alt = Number(wpHit.properties?.altitude ?? coords[2] ?? 0);
  const stackCount = Number(wpHit.properties?.stack_count ?? 1);
  const ids = wpId.includes(",") ? wpId.split(",") : [wpId];
  // a stack collapses N waypoints under one feature. waypointsToGeoJSON picks
  // a recording-bookend MEASUREMENT as the representative so `camera_action`
  // survives - mirror that here so the panel reads `hover_duration` /
  // `camera_target` from the same bookend instead of whichever waypoint
  // happens to be first in the comma-joined id list.
  const stackedWps = (waypoints ?? []).filter((w) => ids.includes(w.id));
  const bookend = stackedWps.find(
    (w) =>
      w.waypoint_type === "MEASUREMENT" &&
      (w.camera_action === "RECORDING_START" || w.camera_action === "RECORDING_STOP"),
  );
  const fullWp = bookend ?? stackedWps.find((w) => w.id === ids[0]) ?? stackedWps[0];
  // stack only: gimbal pitch + agl min/max so the panel can render range rows
  // that mirror the alt_min/alt_max range coming off the geojson properties.
  const pitches = stackCount > 1
    ? stackedWps.map((w) => w.gimbal_pitch).filter((p): p is number => p != null)
    : [];
  const gimbalPitchMin = pitches.length ? Math.min(...pitches) : undefined;
  const gimbalPitchMax = pitches.length ? Math.max(...pitches) : undefined;
  const agls = stackCount > 1
    ? stackedWps.map((w) => w.agl).filter((a): a is number => a != null)
    : [];
  const aglMin = agls.length ? Math.min(...agls) : undefined;
  const aglMax = agls.length ? Math.max(...agls) : undefined;
  return {
    wpId,
    feature: {
      type: "waypoint",
      data: {
        id: wpId,
        waypoint_type: String(wpHit.properties?.waypoint_type ?? ""),
        sequence_order: Number(wpHit.properties?.sequence_order ?? 0),
        position: { type: "Point", coordinates: [coords[0], coords[1], alt] },
        stack_count: stackCount,
        seq_min: stackCount > 1 ? Number(wpHit.properties?.seq_min) : undefined,
        seq_max: stackCount > 1 ? Number(wpHit.properties?.seq_max) : undefined,
        alt_min: stackCount > 1 ? Number(wpHit.properties?.alt_min) : undefined,
        alt_max: stackCount > 1 ? Number(wpHit.properties?.alt_max) : undefined,
        agl_min: aglMin,
        agl_max: aglMax,
        gimbal_pitch_min: gimbalPitchMin,
        gimbal_pitch_max: gimbalPitchMax,
        heading: fullWp?.heading ?? null,
        speed: fullWp?.speed ?? null,
        camera_action: fullWp?.camera_action ?? null,
        camera_target: fullWp?.camera_target ?? null,
        gimbal_pitch: fullWp?.gimbal_pitch ?? null,
        hover_duration: fullWp?.hover_duration ?? null,
        agl: fullWp?.agl ?? null,
        camera_target_agl: fullWp?.camera_target_agl ?? null,
      },
    },
  };
}

/** build an infrastructure MapFeature from non-waypoint hits, preferring points. */
export function buildInfraFeature(
  features: maplibregl.MapGeoJSONFeature[],
  airport: AirportDetailResponse,
): MapFeature | null {
  const pointFeature = features.find(
    (f) =>
      f.layer?.id !== SAFETY_ZONE_FILL_LAYER &&
      f.layer?.id !== SAFETY_ZONE_HATCH_LAYER &&
      f.layer?.id !== SAFETY_ZONE_BORDER_LAYER &&
      f.layer?.id !== AIRPORT_BOUNDARY_LINE_LAYER &&
      f.layer?.id !== OBSTACLE_BOUNDARY_LAYER,
  );
  const f = pointFeature ?? features[0];
  const props = f.properties;
  if (!props) return null;
  const entityType = props.entityType as string;

  if (entityType === "surface") {
    const surface = airport.surfaces.find((s) => s.id === props.id);
    return surface ? { type: "surface", data: surface } : null;
  }
  if (entityType === "obstacle") {
    const obstacle = airport.obstacles.find((o) => o.id === props.id);
    return obstacle ? { type: "obstacle", data: obstacle } : null;
  }
  if (entityType === "safety_zone" || entityType === "airport_boundary") {
    const zone = airport.safety_zones.find((z) => z.id === props.id);
    return zone ? { type: "safety_zone", data: zone } : null;
  }
  if (entityType === "agl") {
    const agl = airport.surfaces
      .flatMap((s) => s.agls)
      .find((a) => a.id === props.id);
    return agl ? { type: "agl", data: agl } : null;
  }
  if (entityType === "lha") {
    const lha = airport.surfaces
      .flatMap((s) => s.agls.flatMap((a) => a.lhas))
      .find((l) => l.id === props.id);
    return lha ? { type: "lha", data: lha } : null;
  }
  return null;
}
