import {
  ArcType,
  Cartesian3,
  Color,
  LabelStyle,
  VerticalOrigin,
  Cartesian2,
  NearFarScalar,
  CustomDataSource,
  PropertyBag,
  PolylineDashMaterialProperty,
} from "cesium";
import type { Entity as CesiumEntity } from "cesium";
import type { WaypointResponse } from "@/types/flightPlan";
import type { PointZ } from "@/types/common";
import type { FlightPlanScope } from "@/types/enums";
import {
  TRANSIT_COLOR,
  MEASUREMENT_COLOR,
  TAKEOFF_COLOR,
  LANDING_COLOR,
} from "./cesiumColors";
import { cartFromAgl } from "./terrainSampling";
import { DECLUTTER_PRIORITY, type StackedLabel } from "./labelDeclutter";

/** polyline material can be a solid color or a dashed material property. */
type PolylineMaterial = Color | PolylineDashMaterialProperty;

/** build polyline entity options with explicit non-clamping 3D rendering.
 * ensures the line is drawn at absolute ellipsoidal altitudes, not snapped
 * to terrain. exported for unit testing. */
export function buildPolylineOptions(
  positions: Cartesian3[],
  width: number,
  material: PolylineMaterial,
  depthFailMaterial: PolylineMaterial,
): CesiumEntity.ConstructorOptions {
  return {
    polyline: {
      positions,
      width,
      material,
      depthFailMaterial,
      clampToGround: false,
      arcType: ArcType.NONE,
    },
  } as CesiumEntity.ConstructorOptions;
}

/** true for a measurement that holds the drone for recording start/stop. */
export function isRecordingBookend(wp: WaypointResponse): boolean {
  return (
    wp.waypoint_type === "MEASUREMENT" &&
    (wp.camera_action === "RECORDING_START" || wp.camera_action === "RECORDING_STOP")
  );
}

/** get color for a waypoint dot based on its type and inspection index. */
function getWaypointColor(wp: WaypointResponse): Color {
  if (wp.waypoint_type === "TRANSIT") return Color.WHITE;
  if (wp.waypoint_type === "TAKEOFF") return TAKEOFF_COLOR;
  if (wp.waypoint_type === "LANDING") return LANDING_COLOR;
  if (wp.waypoint_type === "HOVER") return Color.fromCssColorString("#e5a545");
  if (isRecordingBookend(wp)) return Color.fromCssColorString("#e5a545");
  return MEASUREMENT_COLOR;
}

/** get color for a path segment leading to a waypoint. */
function getSegmentColor(toType: string): Color {
  if (toType === "TRANSIT" || toType === "TAKEOFF" || toType === "LANDING") {
    return TRANSIT_COLOR;
  }
  return MEASUREMENT_COLOR;
}

/** create a PropertyBag for entity click handling and declutter tagging. */
function makeProperties(
  featureType: string,
  featureId: string,
  extra?: Record<string, unknown>,
): PropertyBag {
  const props = new PropertyBag();
  props.addProperty("featureType", featureType);
  props.addProperty("featureId", featureId);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      props.addProperty(k, v);
    }
  }
  return props;
}

/** every remaining scope omits ground takeoff/landing waypoints - operator
 * hand-launches and triggers the wayline airborne. kept as a named export so
 * existing call sites stay byte-stable; the gate is always false now. */
export function scopeIncludesTakeoffLanding(
  scope?: FlightPlanScope | null,
): boolean {
  void scope;
  return false;
}

/** add color-coded path segments between consecutive waypoints. the synthetic
 * takeoff/landing legs are gated on flight_plan_scope. exported for unit testing. */
export function addPathSegments(
  ds: CustomDataSource,
  waypoints: WaypointResponse[],
  heights: Map<string, number>,
  width: number,
  takeoff: PointZ | null | undefined,
  landing: PointZ | null | undefined,
  showTakeoffLanding: boolean,
  flightPlanScope: FlightPlanScope | null | undefined,
): void {
  const sorted = waypoints.slice().sort((a, b) => a.sequence_order - b.sequence_order);
  if (sorted.length < 1) return;

  // synthetic T/L legs derive from mission-level coords, not trajectory
  // waypoints - only draw them when the scope actually includes ground T/L.
  const drawTakeoffLanding =
    showTakeoffLanding && scopeIncludesTakeoffLanding(flightPlanScope);

  // takeoff -> first waypoint. takeoff sits on the ground (agl=0).
  if (drawTakeoffLanding && takeoff) {
    const [tLng, tLat] = takeoff.coordinates;
    const [wLng, wLat] = sorted[0].position.coordinates;
    const a = cartFromAgl(tLng, tLat, 0, heights);
    const b = cartFromAgl(wLng, wLat, sorted[0].agl ?? 0, heights);
    if (a && b) {
      const color = TRANSIT_COLOR;
      ds.entities.add(buildPolylineOptions([a, b], width, color, color));
    }
  }

  // waypoint-to-waypoint segments
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    const [fLng, fLat] = from.position.coordinates;
    const [tLng, tLat] = to.position.coordinates;
    const a = cartFromAgl(fLng, fLat, from.agl ?? 0, heights);
    const b = cartFromAgl(tLng, tLat, to.agl ?? 0, heights);
    if (a && b) {
      const color = getSegmentColor(to.waypoint_type);
      ds.entities.add(buildPolylineOptions([a, b], width, color, color));
    }
  }

  // last waypoint -> landing. landing sits on the ground (agl=0).
  if (drawTakeoffLanding && landing) {
    const last = sorted[sorted.length - 1];
    const [wLng, wLat] = last.position.coordinates;
    const [lLng, lLat] = landing.coordinates;
    const a = cartFromAgl(wLng, wLat, last.agl ?? 0, heights);
    const b = cartFromAgl(lLng, lLat, 0, heights);
    if (a && b) {
      const color = TRANSIT_COLOR;
      ds.entities.add(buildPolylineOptions([a, b], width, color, color));
    }
  }
}

// lazy-built up-pointing chevron icon used by addPathArrows. mirrors the 2d map's
// path-arrow icon rotated 90deg so cesium can align its top to a world direction.
let pathArrowUpImageCache: HTMLCanvasElement | undefined;
function getPathArrowUpImage(): HTMLCanvasElement | undefined {
  if (pathArrowUpImageCache) return pathArrowUpImageCache;
  if (typeof document === "undefined") return undefined;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  const cx = size / 2;
  const cy = size / 2;
  const w = size * 0.35;
  const h = size * 0.25;
  ctx.beginPath();
  ctx.moveTo(cx - w, cy + h);
  ctx.lineTo(cx, cy - h);
  ctx.lineTo(cx + w, cy + h);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = size * 0.15;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  pathArrowUpImageCache = canvas;
  return canvas;
}

/** draw direction arrows along each consecutive-waypoint segment using billboards
 * spaced at ~80m intervals (matching the 2d map's symbol-spacing). each billboard's
 * `alignedAxis` is the segment's world-space unit direction, so the chevron tip
 * follows travel direction in 3d - reversing the waypoint order flips the arrows
 * automatically without per-frame math. exported for unit testing. */
export function addPathArrows(
  ds: CustomDataSource,
  waypoints: WaypointResponse[],
  heights: Map<string, number>,
): void {
  const sorted = waypoints.slice().sort((a, b) => a.sequence_order - b.sequence_order);
  if (sorted.length < 2) return;

  const ARROW_SPACING_DEG = 0.0007; // ~80m at mid-latitudes
  // segments shorter than this (degrees) are degenerate - skip to avoid a
  // zero-length direction vector
  const MIN_SEGMENT_LEN_DEG = 0.00001;
  const image = getPathArrowUpImage();

  for (let i = 0; i < sorted.length - 1; i++) {
    const [fLng, fLat] = sorted[i].position.coordinates;
    const [tLng, tLat] = sorted[i + 1].position.coordinates;
    const fromCart = cartFromAgl(fLng, fLat, sorted[i].agl ?? 0, heights);
    const toCart = cartFromAgl(tLng, tLat, sorted[i + 1].agl ?? 0, heights);
    if (!fromCart || !toCart) continue;

    const dLng = tLng - fLng;
    const dLat = tLat - fLat;
    const segLen = Math.sqrt(dLng * dLng + dLat * dLat);
    if (segLen < MIN_SEGMENT_LEN_DEG) continue;

    // world-space unit direction along the segment
    const direction = new Cartesian3();
    Cartesian3.subtract(toCart, fromCart, direction);
    Cartesian3.normalize(direction, direction);

    const count = Math.max(1, Math.floor(segLen / ARROW_SPACING_DEG));

    for (let a = 0; a < count; a++) {
      const frac = (a + 1) / (count + 1);
      const pos = new Cartesian3();
      Cartesian3.lerp(fromCart, toCart, frac, pos);

      ds.entities.add({
        position: pos,
        billboard: {
          image,
          alignedAxis: direction,
          rotation: 0,
          scale: 0.6,
          color: Color.WHITE.withAlpha(0.85),
          scaleByDistance: new NearFarScalar(100, 0.8, 5000, 0.3),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: makeProperties("path_arrow", `${i}-${a}`, {
          declutterPriority: DECLUTTER_PRIORITY.arrow,
          declutterGroup: `path_arrow:${i}-${a}`,
        }),
      } as CesiumEntity.ConstructorOptions);
    }
  }
}

/** add waypoint dot and label entities. labels mirror the 2d map convention:
 * MEASUREMENT waypoints carry their inspection index (e.g. "1", "2"); transits
 * and hovers are unlabeled. stacked-column waypoints (same ground lng,lat)
 * collapse to a single visible label on the lowest-altitude entry; deeper
 * waypoints in the column hide their label but keep their dot. exported for
 * unit testing. */
export function addWaypointDots(
  ds: CustomDataSource,
  waypoints: WaypointResponse[],
  selectedWaypointId: string | null | undefined,
  heights: Map<string, number>,
  stackMap: Map<string, StackedLabel>,
  inspectionIndexMap: Record<string, number> | undefined,
  highlightedIds?: string[] | null,
): void {
  const highlightSet = highlightedIds ? new Set(highlightedIds) : null;

  // pre-scan: every ground (lng,lat) that contains a MEASUREMENT gets that
  // MEASUREMENT's inspection-index label. waypoints stacked with the measurement
  // (e.g. a transit at the same xy) inherit the same label so the visible entity
  // in the stack reads as inspection N regardless of which type sits lowest.
  const labelByGround = new Map<string, string>();
  if (inspectionIndexMap) {
    for (const wp of waypoints) {
      if (wp.waypoint_type !== "MEASUREMENT" || !wp.inspection_id) continue;
      const idx = inspectionIndexMap[wp.inspection_id];
      if (idx === undefined) continue;
      const [lng, lat] = wp.position.coordinates;
      const key = `${lng.toFixed(6)},${lat.toFixed(6)}`;
      if (!labelByGround.has(key)) labelByGround.set(key, String(idx));
    }
  }

  for (const wp of waypoints) {
    // skip takeoff/landing - rendered separately by addTakeoffLanding
    if (wp.waypoint_type === "TAKEOFF" || wp.waypoint_type === "LANDING") continue;

    const [lng, lat] = wp.position.coordinates;
    const pos = cartFromAgl(lng, lat, wp.agl ?? 0, heights);
    if (!pos) continue;

    const isSelected = selectedWaypointId != null && selectedWaypointId === wp.id;
    const isHighlighted = highlightSet?.has(wp.id) ?? false;
    const color = getWaypointColor(wp);
    const isMeasurement = wp.waypoint_type === "MEASUREMENT";
    const isTransit = wp.waypoint_type === "TRANSIT";
    const pixelSize = isSelected ? 18 : (isMeasurement ? 10 : 9);

    const stack = stackMap.get(wp.id);
    const groundKey = `${lng.toFixed(6)},${lat.toFixed(6)}`;
    const labelText = labelByGround.get(groundKey) ?? "";
    // hide the label entirely when this waypoint's stack-position is not the
    // visible one, or when there's no inspection label to render
    const showLabel = (stack ? stack.show : true) && labelText !== "";

    // stack-hidden labels skip the declutter pass entirely - they keep show=false
    // regardless of camera; only the visible (lowest-altitude) label competes
    // for screen-space against neighbouring entities.
    const declutterExtras = showLabel
      ? {
          declutterPriority: DECLUTTER_PRIORITY.waypoint,
          declutterGroup: `waypoint:${wp.id}`,
        }
      : undefined;

    ds.entities.add({
      name: `WP ${wp.sequence_order}`,
      position: pos,
      point: {
        pixelSize,
        color: isSelected ? Color.CYAN : color,
        outlineColor: isSelected ? Color.WHITE : (isTransit ? Color.fromCssColorString("#6b6b6b") : Color.WHITE),
        outlineWidth: isSelected ? 4 : 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: labelText,
        show: showLabel,
        font: "bold 12px sans-serif",
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -12),
        scaleByDistance: new NearFarScalar(100, 1.0, 8000, 0.4),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: makeProperties("waypoint", wp.id, declutterExtras),
    } as CesiumEntity.ConstructorOptions);

    // warning highlight ring
    if (isHighlighted) {
      ds.entities.add({
        position: pos,
        point: {
          pixelSize: 22,
          color: Color.TRANSPARENT,
          outlineColor: Color.fromCssColorString("#e54545"),
          outlineWidth: 3,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
  }
}

/** add takeoff and landing markers clamped to sampled terrain. */
export function addTakeoffLanding(
  ds: CustomDataSource,
  takeoff: PointZ | null | undefined,
  landing: PointZ | null | undefined,
  heights: Map<string, number>,
  takeoffLabel: string,
  landingLabel: string,
): void {
  const addMarker = (
    coord: PointZ,
    color: Color,
    label: string,
    waypointType: string,
  ) => {
    const [lng, lat] = coord.coordinates;
    // takeoff/landing sit on the ground via agl=0, so no vertical stub line is
    // needed - the previous polyline went from sampled terrain to sampled
    // terrain (same point) once the renderer stopped offsetting markers by
    // takeoff_alt - airport.elevation.
    const markerPos = cartFromAgl(lng, lat, 0, heights);
    if (!markerPos) return;

    ds.entities.add({
      name: label,
      position: markerPos,
      point: {
        pixelSize: 18,
        color,
        outlineColor: Color.WHITE,
        outlineWidth: 3,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: label,
        font: "bold 13px sans-serif",
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: makeProperties("waypoint", waypointType.toLowerCase(), {
        declutterPriority: DECLUTTER_PRIORITY.takeoffLanding,
        declutterGroup: `waypoint:${waypointType.toLowerCase()}`,
      }),
    } as CesiumEntity.ConstructorOptions);
  };

  if (takeoff) addMarker(takeoff, TAKEOFF_COLOR, takeoffLabel, "TAKEOFF");
  if (landing) addMarker(landing, LANDING_COLOR, landingLabel, "LANDING");
}

/** add dashed camera heading lines from measurement waypoints to their targets. */
export function addCameraHeadingLines(
  ds: CustomDataSource,
  waypoints: WaypointResponse[],
  heights: Map<string, number>,
): void {
  for (const wp of waypoints) {
    if (wp.waypoint_type !== "MEASUREMENT" || !wp.camera_target) continue;
    const [lng, lat] = wp.position.coordinates;
    const [tLng, tLat] = wp.camera_target.coordinates;
    const a = cartFromAgl(lng, lat, wp.agl ?? 0, heights);
    const b = cartFromAgl(tLng, tLat, wp.camera_target_agl ?? 0, heights);
    if (!a || !b) continue;

    const color = getWaypointColor(wp).withAlpha(0.4);
    ds.entities.add(buildPolylineOptions(
      [a, b],
      1,
      new PolylineDashMaterialProperty({
        color,
        dashLength: 8,
      }),
      color,
    ));
  }
}

/** add a small black dot for every transit waypoint in the simplified trajectory. */
export function addCornerDots(
  ds: CustomDataSource,
  waypoints: WaypointResponse[],
  heights: Map<string, number>,
): void {
  for (const wp of waypoints) {
    if (wp.waypoint_type !== "TRANSIT") continue;
    const [lng, lat] = wp.position.coordinates;
    const pos = cartFromAgl(lng, lat, wp.agl ?? 0, heights);
    if (!pos) continue;
    ds.entities.add({
      position: pos,
      point: {
        pixelSize: 4,
        color: Color.BLACK,
        outlineColor: Color.WHITE,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }
}

/** add stacked measurement dots where multiple waypoints share a ground position. */
export function addStackedMeasurementDots(
  ds: CustomDataSource,
  waypoints: WaypointResponse[],
  heights: Map<string, number>,
): void {
  const groups = new Map<string, WaypointResponse[]>();
  for (const wp of waypoints) {
    if (wp.waypoint_type !== "MEASUREMENT" && wp.waypoint_type !== "HOVER") continue;
    const [lng, lat] = wp.position.coordinates;
    const key = `${lng.toFixed(6)},${lat.toFixed(6)}`;
    const list = groups.get(key) ?? [];
    list.push(wp);
    groups.set(key, list);
  }

  for (const [, group] of groups) {
    if (group.length <= 1) continue;
    const [lng, lat] = group[0].position.coordinates;
    const pos = cartFromAgl(lng, lat, group[0].agl ?? 0, heights);
    if (!pos) continue;
    ds.entities.add({
      position: pos,
      point: {
        pixelSize: 6,
        color: MEASUREMENT_COLOR,
        outlineColor: Color.WHITE,
        outlineWidth: 1.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }
}
