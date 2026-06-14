import {
  CallbackProperty,
  Cartesian3,
  Cartographic,
  HeadingPitchRoll,
  JulianDate,
  Quaternion,
  SampledPositionProperty,
  Transforms,
  Math as CesiumMath,
} from "cesium";
import type { Viewer as CesiumViewer } from "cesium";
import type { WaypointResponse } from "@/types/flightPlan";
import { cartFromAgl } from "./terrainSampling";
import { bearing, bearingBetweenWaypoints, bodyTracksTarget } from "./flyAlongBearing";

// degrees the model's local "forward" is rotated clockwise (viewed from above)
// from cesium's expected forward (+Y north). the placeholder drone .glb files
// (MS GLTF Exporter 2.4.2.8) have their forward along +X, i.e. 90deg east of
// north, so we add the offset back when interpreting the planned compass
// heading. tune if a future drone .glb has a different convention.
const MODEL_FORWARD_OFFSET_DEG = 90;
// measured glTF bounding box of the bundled placeholder models (~25 m wide).
const MODEL_NATIVE_DIAMETER_M = 25;
// in the .glb's local Y axis the body sits between [-1, 6.66] so the visual
// center is ~2.83 m above the model's origin. cesium places the origin at the
// trajectory point, so without compensation the drone body floats above the
// path. shifting the placement altitude down by this * scale realigns the
// body with the polyline.
const MODEL_VISUAL_CENTER_Y_M = 2.83;
// uniform scale applied to the .glb so the placeholder ~25 m model renders
// at an exaggerated ~7.5 m footprint - realistic 1.25 m looks lost against
// the airport-scale scene, so we oversize for visibility.
export const USER_SCALE = 0.3;
// pixel-size bounds. lower bound enforced by Cesium's built-in
// `minimumPixelSize`; upper bound enforced by the scale callback below.
export const MIN_PIXEL_SIZE = 64;
const MAX_PIXEL_SIZE = 280;
// world-space scale cap. minimumPixelSize works by inflating the model's
// *world size* to maintain the pixel floor on screen, so at extreme zoom-out
// an uncapped maximumScale produces a city-sized drone. capping at 20
// (25 m native * 20 = 500 m max footprint) keeps the world size sane; beyond
// that zoom the drone simply shrinks below MIN_PIXEL_SIZE - acceptable
// because users would not expect to see a drone at 20+ km altitude anyway.
export const MAX_WORLD_SCALE = 20;

export interface Timeline {
  positionProperty: SampledPositionProperty;
  orientationProperty: CallbackProperty;
  scaleProperty: CallbackProperty;
  startTime: JulianDate;
  totalDuration: number;
}

/** build the cesium timeline (position + orientation properties + clock window).
 * rebuilt whenever the inputs that define the path change - status/speed are
 * handled by separate effects so live speed changes don't tear the timeline. */
export function buildFlyAlongTimeline(
  viewer: CesiumViewer | null,
  waypoints: WaypointResponse[],
  segmentDurations: number[],
  heights: Map<string, number> | null,
): Timeline | null {
  if (!heights || waypoints.length < 2) return null;
  if (segmentDurations.length !== waypoints.length - 1) return null;

  // shift the placement altitude down by the model's visual-center offset
  // (in the .glb's local Y, which maps to cesium up after the glTF Y-up
  // swap) so the body sits on the trajectory polyline rather than above it.
  // this uses the static USER_SCALE; when minimumPixelSize upscales the
  // model at far zoom the offset is undercompensated, but the resulting
  // pixel drift is small at those camera distances.
  const verticalOffset = MODEL_VISUAL_CENTER_Y_M * USER_SCALE;
  const positions: Cartesian3[] = [];
  for (const wp of waypoints) {
    const [lng, lat] = wp.position.coordinates;
    const agl = (wp.agl ?? 0) - verticalOffset;
    const pos = cartFromAgl(lng, lat, agl, heights);
    if (!pos) return null;
    positions.push(pos);
  }

  const startTime = JulianDate.now();
  const positionProperty = new SampledPositionProperty();

  const arrivalSeconds: number[] = new Array(waypoints.length);
  const hoverEndSeconds: number[] = new Array(waypoints.length);

  let cumulative = 0;
  positionProperty.addSample(JulianDate.clone(startTime), positions[0]);
  arrivalSeconds[0] = 0;
  hoverEndSeconds[0] = Math.max(0, waypoints[0].hover_duration ?? 0);

  for (let i = 0; i < segmentDurations.length; i++) {
    const segmentTotal = Math.max(0, segmentDurations[i] ?? 0);
    const hover = Math.max(0, waypoints[i].hover_duration ?? 0);
    const travel = Math.max(0, segmentTotal - hover);

    if (hover > 0) {
      const hoverEndTime = JulianDate.addSeconds(
        startTime,
        cumulative + hover,
        new JulianDate(),
      );
      positionProperty.addSample(hoverEndTime, positions[i]);
      cumulative += hover;
    }
    hoverEndSeconds[i] = cumulative;

    cumulative += travel;
    const arrivalTime = JulianDate.addSeconds(startTime, cumulative, new JulianDate());
    positionProperty.addSample(arrivalTime, positions[i + 1]);
    arrivalSeconds[i + 1] = cumulative;
    hoverEndSeconds[i + 1] = cumulative + Math.max(0, waypoints[i + 1].hover_duration ?? 0);
  }

  // pixel-size scale callback - only enforces the MAX (close zoom). the MIN
  // is enforced by Cesium's built-in `minimumPixelSize` on the entity model.
  // splitting the bounds this way is what makes the model reliably render -
  // a single CallbackPositionProperty-based path turned out not to.
  const sampledScratch = new Cartesian3();
  const scaleProperty = new CallbackProperty(() => {
    if (!viewer || viewer.isDestroyed()) return USER_SCALE;
    const pos = positionProperty.getValue(viewer.clock.currentTime, sampledScratch);
    if (!pos) return USER_SCALE;
    const dist = Cartesian3.distance(viewer.camera.positionWC, pos);
    if (dist <= 0) return USER_SCALE;
    const frustum = viewer.camera.frustum as { fovy?: number };
    const fovY = frustum.fovy ?? Math.PI / 3;
    const canvasH = viewer.canvas.clientHeight || 600;
    const naturalPx =
      (MODEL_NATIVE_DIAMETER_M * USER_SCALE * canvasH) /
      (2 * dist * Math.tan(fovY / 2));
    if (naturalPx > MAX_PIXEL_SIZE) {
      return USER_SCALE * (MAX_PIXEL_SIZE / naturalPx);
    }
    return USER_SCALE;
  }, false);

  // orientation: dynamic, recomputed each frame so we can yaw toward the
  // camera_target during inspection arcs and toward the next waypoint during
  // pure transit / takeoff / landing.
  const cartographicScratch = new Cartographic();
  const hprScratch = new HeadingPitchRoll();
  const posScratch2 = new Cartesian3();
  const orientationProperty = new CallbackProperty((time, result) => {
    if (!time) return result ?? Quaternion.clone(Quaternion.IDENTITY, new Quaternion());
    const elapsed = JulianDate.secondsDifference(time, startTime);

    // most-recent arrival = source waypoint
    let srcIdx = 0;
    for (let k = 0; k < arrivalSeconds.length; k++) {
      if (elapsed >= arrivalSeconds[k]) srcIdx = k;
      else break;
    }
    const src = waypoints[srcIdx];
    const next = srcIdx < waypoints.length - 1 ? waypoints[srcIdx + 1] : null;
    const inHover = elapsed <= hoverEndSeconds[srcIdx];
    const travelDuration = next != null
      ? arrivalSeconds[srcIdx + 1] - hoverEndSeconds[srcIdx]
      : 0;
    const travelFraction = travelDuration > 0 && !inHover
      ? Math.min(1, Math.max(0, (elapsed - hoverEndSeconds[srcIdx]) / travelDuration))
      : 0;

    const currentPos = positionProperty.getValue(time, posScratch2);
    if (!currentPos) {
      return result ?? Quaternion.clone(Quaternion.IDENTITY, new Quaternion());
    }

    // heading rule:
    //   - inspection segment (both endpoints body-tracks-target): yaw
    //     continuously toward the camera_target from the current
    //     interpolated position.
    //   - row sweep (both endpoints MEASUREMENT/HOVER with row-direction
    //     heading - FO / PSS): honor wp.heading verbatim.
    //   - everything else (transit segments, exit-from-inspection toward
    //     a transit waypoint, takeoff, landing): bearing from the source
    //     waypoint toward the next waypoint - the actual travel direction.
    const srcInspects = src.waypoint_type === "MEASUREMENT" || src.waypoint_type === "HOVER";
    const nextInspects =
      next != null && (next.waypoint_type === "MEASUREMENT" || next.waypoint_type === "HOVER");
    const trackTarget =
      bodyTracksTarget(src) &&
      // continue tracking during hover, OR when the next waypoint also
      // tracks the same kind of target (= we're inside an inspection arc).
      (inHover || (nextInspects && next != null && bodyTracksTarget(next)));
    const rowSweep =
      srcInspects &&
      nextInspects &&
      !trackTarget &&
      src.heading != null &&
      Number.isFinite(src.heading);

    let headingDeg: number;
    if (trackTarget) {
      const carto = Cartographic.fromCartesian(
        currentPos,
        undefined,
        cartographicScratch,
      );
      const curLng = CesiumMath.toDegrees(carto.longitude);
      const curLat = CesiumMath.toDegrees(carto.latitude);
      const [tLng, tLat] = src.camera_target!.coordinates;
      headingDeg = bearing(curLat, curLng, tLat, tLng);
    } else if (rowSweep) {
      headingDeg = src.heading!;
    } else if (next) {
      headingDeg = bearingBetweenWaypoints(src, next);
    } else if (srcIdx > 0) {
      headingDeg = bearingBetweenWaypoints(waypoints[srcIdx - 1], src);
    } else {
      headingDeg = 0;
    }

    // pitch: interpolate between adjacent gimbal_pitch values during travel
    // so the visualized tilt eases between waypoints (vertical-profile
    // climb sweeps the angle continuously).
    const pitchA = src.gimbal_pitch ?? 0;
    const pitchB = next?.gimbal_pitch ?? pitchA;
    const pitchDeg = inHover || travelDuration <= 0
      ? pitchA
      : pitchA + (pitchB - pitchA) * travelFraction;

    // model forward axis is along +X (90deg east of north) - see
    // MODEL_FORWARD_OFFSET_DEG for the rationale.
    hprScratch.heading = CesiumMath.toRadians(headingDeg - MODEL_FORWARD_OFFSET_DEG);
    hprScratch.pitch = CesiumMath.toRadians(pitchDeg);
    hprScratch.roll = 0;
    return Transforms.headingPitchRollQuaternion(
      currentPos,
      hprScratch,
      undefined,
      undefined,
      result ?? new Quaternion(),
    );
  }, false);

  return {
    positionProperty,
    orientationProperty,
    scaleProperty,
    startTime,
    totalDuration: cumulative,
  };
}
