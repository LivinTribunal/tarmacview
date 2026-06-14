// pure geojson builders for the full waypoint trajectory layer set.
// peeled out of waypointFullLayers.ts (R15 follow-up) so the parent module
// keeps only the MapLibre-coupled registration / mutator code. these helpers
// are FeatureCollection transforms - no map.* calls, no MapLibre types -
// importable from the barrel and unit-testable without a fake map.

import type { WaypointResponse } from "@/types/flightPlan";
import type { PointZ } from "@/types/common";
import {
  TRANSIT_PATH_COLOR,
  coordKey,
  segmentKey,
  offsetSegmentLeft,
  resolveWaypointColor,
  resolveSegmentColor,
  resolveLabel,
} from "./waypointShared";

/** converts waypoints + standalone markers to geojson points, collapsing vertical stacks. */
export function waypointsToGeoJSON(
  waypoints: WaypointResponse[],
  takeoff?: PointZ | null,
  landing?: PointZ | null,
  inspectionIndexMap?: Record<string, number>,
): GeoJSON.FeatureCollection {
  const sorted = waypoints.slice().sort(
    (a, b) => a.sequence_order - b.sequence_order,
  );

  // non-stackable types get individual features
  const NON_STACKABLE = new Set(["TAKEOFF", "LANDING", "TRANSIT"]);
  const features: GeoJSON.Feature[] = [];
  const stackable: WaypointResponse[] = [];

  for (const wp of sorted) {
    // video start/stop hovers share position with measurements - skip on map,
    // they're visible in the waypoint list panel
    if (wp.waypoint_type === "HOVER" &&
        (wp.camera_action === "RECORDING_START" || wp.camera_action === "RECORDING_STOP")) {
      continue;
    }

    if (NON_STACKABLE.has(wp.waypoint_type)) {
      features.push({
        type: "Feature",
        properties: {
          id: wp.id,
          sequence_order: wp.sequence_order,
          waypoint_type: wp.waypoint_type,
          camera_action: wp.camera_action ?? "NONE",
          inspection_id: wp.inspection_id,
          label: resolveLabel(wp.waypoint_type, wp.inspection_id, inspectionIndexMap),
          color: resolveWaypointColor(wp.waypoint_type),
          has_camera_target: wp.camera_target ? "yes" : "no",
          stack_count: 1,
          altitude: wp.position.coordinates[2] ?? 0,
        },
        geometry: { type: "Point", coordinates: wp.position.coordinates },
      });
    } else {
      stackable.push(wp);
    }
  }

  // group stackable waypoints by ground position
  const stacks = new Map<string, WaypointResponse[]>();
  for (const wp of stackable) {
    const [lon, lat] = wp.position.coordinates;
    const key = coordKey(lon, lat);
    const group = stacks.get(key);
    if (group) {
      group.push(wp);
    } else {
      stacks.set(key, [wp]);
    }
  }

  for (const group of stacks.values()) {
    if (group.length === 1) {
      const wp = group[0];
      features.push({
        type: "Feature",
        properties: {
          id: wp.id,
          sequence_order: wp.sequence_order,
          waypoint_type: wp.waypoint_type,
          camera_action: wp.camera_action ?? "NONE",
          inspection_id: wp.inspection_id,
          label: resolveLabel(wp.waypoint_type, wp.inspection_id, inspectionIndexMap),
          color: resolveWaypointColor(wp.waypoint_type),
          has_camera_target: wp.camera_target ? "yes" : "no",
          stack_count: 1,
          altitude: wp.position.coordinates[2] ?? 0,
        },
        geometry: { type: "Point", coordinates: wp.position.coordinates },
      });
    } else {
      // collapsed stack - prefer a recording-bookend MEASUREMENT so the
      // camera_action survives collapse and the bookend symbol layer matches;
      // fall back to any MEASUREMENT so the circle layer filter still hits
      const bookend = group.find(
        (w) =>
          w.waypoint_type === "MEASUREMENT" &&
          (w.camera_action === "RECORDING_START" || w.camera_action === "RECORDING_STOP"),
      );
      const representative =
        bookend ?? group.find((w) => w.waypoint_type === "MEASUREMENT") ?? group[0];
      const alts = group.map((w) => w.position.coordinates[2] ?? 0);
      const ids = group.map((w) => w.id).join(",");
      const seqs = group.map((w) => w.sequence_order);

      features.push({
        type: "Feature",
        properties: {
          id: ids,
          sequence_order: Math.min(...seqs),
          waypoint_type: representative.waypoint_type,
          camera_action: representative.camera_action ?? "NONE",
          inspection_id: representative.inspection_id,
          label: resolveLabel(representative.waypoint_type, representative.inspection_id, inspectionIndexMap),
          color: resolveWaypointColor(representative.waypoint_type),
          has_camera_target: "no",
          stack_count: group.length,
          seq_min: Math.min(...seqs),
          seq_max: Math.max(...seqs),
          alt_min: Math.min(...alts),
          alt_max: Math.max(...alts),
        },
        geometry: { type: "Point", coordinates: group[0].position.coordinates },
      });
    }
  }

  // standalone takeoff/landing from mission coordinates - always shown so the map
  // updates immediately when the user places or deletes a point, even before
  // trajectory regeneration. override any stale flight-plan TAKEOFF/LANDING.
  const hasTakeoffWp = features.some((f) => f.properties?.waypoint_type === "TAKEOFF");
  const hasLandingWp = features.some((f) => f.properties?.waypoint_type === "LANDING");

  if (takeoff) {
    if (hasTakeoffWp) {
      // override flight plan takeoff position with current mission coordinate
      const idx = features.findIndex((f) => f.properties?.waypoint_type === "TAKEOFF");
      if (idx >= 0) {
        (features[idx].geometry as GeoJSON.Point).coordinates = takeoff.coordinates;
        features[idx].properties!.altitude = takeoff.coordinates[2] ?? 0;
      }
    } else {
      features.push({
        type: "Feature",
        properties: {
          id: "takeoff",
          sequence_order: 0,
          waypoint_type: "TAKEOFF",
          color: "#4595e5",
          stack_count: 1,
          altitude: takeoff.coordinates[2] ?? 0,
        },
        geometry: { type: "Point", coordinates: takeoff.coordinates },
      });
    }
  }
  if (landing) {
    if (hasLandingWp) {
      const idx = features.findIndex((f) => f.properties?.waypoint_type === "LANDING");
      if (idx >= 0) {
        (features[idx].geometry as GeoJSON.Point).coordinates = landing.coordinates;
        features[idx].properties!.altitude = landing.coordinates[2] ?? 0;
      }
    } else {
      features.push({
        type: "Feature",
        properties: {
          id: "landing",
          sequence_order: 0,
          waypoint_type: "LANDING",
          color: "#e54545",
          stack_count: 1,
          altitude: landing.coordinates[2] ?? 0,
        },
        geometry: { type: "Point", coordinates: landing.coordinates },
      });
    }
  }

  // remove stale flight-plan takeoff/landing when mission coordinate is cleared
  if (!takeoff && hasTakeoffWp && waypoints.length > 0) {
    const idx = features.findIndex((f) => f.properties?.waypoint_type === "TAKEOFF");
    if (idx >= 0) features.splice(idx, 1);
  }
  if (!landing && hasLandingWp && waypoints.length > 0) {
    const idx = features.findIndex((f) => f.properties?.waypoint_type === "LANDING");
    if (idx >= 0) features.splice(idx, 1);
  }

  return { type: "FeatureCollection", features };
}

/** builds line segments between consecutive waypoints, colored by type and phase. */
export function waypointsToLineGeoJSON(
  waypoints: WaypointResponse[],
): GeoJSON.FeatureCollection {
  const sorted = waypoints.slice().sort(
    (a, b) => a.sequence_order - b.sequence_order,
  );
  if (sorted.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }

  // first pass - count how many segments share each ground path
  const segmentCounts = new Map<string, number>();
  for (let i = 0; i < sorted.length - 1; i++) {
    const key = segmentKey(sorted[i].position.coordinates, sorted[i + 1].position.coordinates);
    segmentCounts.set(key, (segmentCounts.get(key) ?? 0) + 1);
  }

  // second pass - build features, offsetting overlapping segments
  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    // raw endpoints (un-offset) so transit insert can interpolate against real waypoint altitudes
    const fromCoord = from.position.coordinates;
    const toCoord = to.position.coordinates;
    const toType = to.waypoint_type;

    let color: string;
    if (toType === "TRANSIT" || toType === "TAKEOFF" || toType === "LANDING") {
      color = TRANSIT_PATH_COLOR;
    } else {
      color = resolveSegmentColor(toType);
    }

    const key = segmentKey(fromCoord, toCoord);
    const isOverlapping = (segmentCounts.get(key) ?? 0) > 1;

    const coords = isOverlapping
      ? offsetSegmentLeft(fromCoord, toCoord, 5)
      : [fromCoord, toCoord];

    features.push({
      type: "Feature",
      properties: {
        color,
        inspection_id: to.inspection_id ?? null,
        from_seq: from.sequence_order,
        from_alt: fromCoord[2] ?? 0,
        to_alt: toCoord[2] ?? 0,
        from_lng: fromCoord[0],
        from_lat: fromCoord[1],
        to_lng: toCoord[0],
        to_lat: toCoord[1],
      },
      geometry: {
        type: "LineString",
        coordinates: coords,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/** builds camera target lines from measurement waypoints. */
export function waypointsToCameraLineGeoJSON(
  waypoints: WaypointResponse[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const wp of waypoints) {
    if (wp.camera_target && wp.waypoint_type === "MEASUREMENT") {
      features.push({
        type: "Feature",
        properties: { inspection_id: wp.inspection_id ?? null },
        geometry: {
          type: "LineString",
          coordinates: [
            wp.position.coordinates,
            wp.camera_target.coordinates,
          ],
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/** builds camera target point features for map rendering. */
export function waypointsToCameraTargetGeoJSON(
  waypoints: WaypointResponse[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const wp of waypoints) {
    if (wp.camera_target) {
      features.push({
        type: "Feature",
        properties: { id: wp.id, inspection_id: wp.inspection_id },
        geometry: { type: "Point", coordinates: wp.camera_target.coordinates },
      });
    }
  }
  return { type: "FeatureCollection", features };
}
