import { useState, useCallback, useEffect } from "react";
import type { FlyAlongState, FlyAlongSpeed } from "@/types/map";

interface UseFlyAlongReturn {
  state: FlyAlongState;
  play: () => void;
  pause: () => void;
  stop: () => void;
  setSpeed: (speed: FlyAlongSpeed) => void;
  setProgress: (progress: number) => void;
}

/** status/speed/progress controller for the 3d fly-along playback. */
// owns status/speed/progress only; the actual motion is driven by cesium's
// clock inside CesiumFlyAlong, which pushes per-frame progress back via
// setProgress. play() from idle starts fresh from 0; play() from paused
// resumes at the current progress.
export default function useFlyAlong(waypointCount: number): UseFlyAlongReturn {
  const [state, setState] = useState<FlyAlongState>({
    status: "idle",
    speed: 2,
    progress: 0,
  });

  const play = useCallback(() => {
    if (waypointCount < 2) return;
    setState((prev) => ({
      ...prev,
      status: "playing",
      progress: prev.status === "paused" ? prev.progress : 0,
    }));
  }, [waypointCount]);

  const pause = useCallback(() => {
    setState((prev) => (prev.status === "playing" ? { ...prev, status: "paused" } : prev));
  }, []);

  const stop = useCallback(() => {
    setState((prev) => ({ status: "idle", speed: prev.speed, progress: 0 }));
  }, []);

  const setSpeed = useCallback((speed: FlyAlongSpeed) => {
    setState((prev) => ({ ...prev, speed }));
  }, []);

  const setProgress = useCallback((progress: number) => {
    const clamped = Math.min(100, Math.max(0, progress));
    setState((prev) => (prev.progress === clamped ? prev : { ...prev, progress: clamped }));
  }, []);

  // stop if the trajectory shrinks below the playable threshold
  useEffect(() => {
    if (waypointCount < 2) {
      setState((prev) =>
        prev.status === "idle" ? prev : { status: "idle", speed: prev.speed, progress: 0 },
      );
    }
  }, [waypointCount]);

  return { state, play, pause, stop, setSpeed, setProgress };
}
