import { useEffect, useMemo, useRef } from "react";
import { Entity } from "resium";
import { ClockRange, JulianDate } from "cesium";
import type { Viewer as CesiumViewer } from "cesium";
import type { WaypointResponse } from "@/types/flightPlan";
import type { FlyAlongState } from "@/types/map";
import { useFlyAlongTerrain } from "./useFlyAlongTerrain";
import {
  MAX_WORLD_SCALE,
  MIN_PIXEL_SIZE,
  buildFlyAlongTimeline,
  type Timeline,
} from "./buildFlyAlongTimeline";

interface CesiumFlyAlongProps {
  viewer: CesiumViewer | null;
  waypoints: WaypointResponse[];
  segmentDurations: number[];
  flyAlongState: FlyAlongState;
  modelUrl: string;
  setProgress: (progress: number) => void;
  onComplete: () => void;
}

/** animates the active drone model along the flight trajectory using a cesium
 * SampledPositionProperty driven by viewer.clock. mounted by CesiumMapViewer
 * when fly-along state leaves idle. no camera chase - the user keeps free
 * control of the camera throughout playback. */
export default function CesiumFlyAlong({
  viewer,
  waypoints,
  segmentDurations,
  flyAlongState,
  modelUrl,
  setProgress,
  onComplete,
}: CesiumFlyAlongProps) {
  const heights = useFlyAlongTerrain(viewer, waypoints);

  // build the cesium timeline (position + orientation properties + clock window).
  // rebuilt whenever the inputs that define the path change - status/speed are
  // handled by separate effects so live speed changes don't tear the timeline.
  const timeline = useMemo<Timeline | null>(
    () => buildFlyAlongTimeline(viewer, waypoints, segmentDurations, heights),
    [heights, waypoints, segmentDurations, viewer],
  );

  // configure viewer.clock when the timeline (re)builds. status/speed effects
  // below toggle shouldAnimate / multiplier without rebuilding.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !timeline) return;
    const { startTime, totalDuration } = timeline;
    viewer.clock.startTime = JulianDate.clone(startTime);
    viewer.clock.stopTime = JulianDate.addSeconds(startTime, totalDuration, new JulianDate());
    viewer.clock.currentTime = JulianDate.clone(startTime);
    viewer.clock.clockRange = ClockRange.CLAMPED;
    viewer.clock.multiplier = flyAlongState.speed;
    viewer.clock.shouldAnimate = flyAlongState.status === "playing";
    return () => {
      if (!viewer.isDestroyed()) {
        viewer.clock.shouldAnimate = false;
      }
    };
    // status/speed are reapplied by separate effects below - intentionally
    // excluded so a live speed change doesn't rebuild the clock window
  }, [viewer, timeline]);

  // react to play / pause / stop without rebuilding the timeline
  const completedRef = useRef(false);
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !timeline) return;
    if (flyAlongState.status === "playing") {
      // resume from current position if mid-stream, otherwise restart
      const elapsed = JulianDate.secondsDifference(
        viewer.clock.currentTime,
        timeline.startTime,
      );
      if (elapsed >= timeline.totalDuration - 0.001 || elapsed < 0) {
        viewer.clock.currentTime = JulianDate.clone(timeline.startTime);
      }
      completedRef.current = false;
      viewer.clock.shouldAnimate = true;
    } else if (flyAlongState.status === "paused") {
      viewer.clock.shouldAnimate = false;
    } else {
      viewer.clock.currentTime = JulianDate.clone(timeline.startTime);
      viewer.clock.shouldAnimate = false;
      completedRef.current = true;
    }
  }, [viewer, timeline, flyAlongState.status]);

  // live speed changes
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    viewer.clock.multiplier = flyAlongState.speed;
  }, [viewer, flyAlongState.speed]);

  // per-frame progress + completion detection. throttled to actual frame rate
  // by virtue of postRender; React batches setProgress at its own pace.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const setProgressRef = useRef(setProgress);
  setProgressRef.current = setProgress;
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !timeline) return;
    const { startTime, totalDuration } = timeline;
    const listener = () => {
      if (viewer.isDestroyed() || totalDuration <= 0) return;
      const elapsed = JulianDate.secondsDifference(viewer.clock.currentTime, startTime);
      const pct = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
      setProgressRef.current(pct);
      if (elapsed >= totalDuration - 0.001 && !completedRef.current) {
        completedRef.current = true;
        onCompleteRef.current();
      }
    };
    viewer.scene.postRender.addEventListener(listener);
    return () => {
      if (!viewer.isDestroyed()) {
        viewer.scene.postRender.removeEventListener(listener);
      }
    };
  }, [viewer, timeline]);

  if (!timeline || flyAlongState.status === "idle") return null;

  return (
    <Entity
      key="fly-along-marker"
      position={timeline.positionProperty}
      orientation={timeline.orientationProperty}
      model={{
        uri: modelUrl,
        scale: timeline.scaleProperty,
        minimumPixelSize: MIN_PIXEL_SIZE,
        maximumScale: MAX_WORLD_SCALE,
      }}
    />
  );
}
