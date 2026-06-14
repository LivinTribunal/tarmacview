import type { WaypointResponse } from "@/types/flightPlan";
import { haversineDistance } from "./geo";

export interface SegmentDurationOptions {
  fallbackSpeed?: number | null;
}

const MIN_SPEED = 0.1;

/** per-segment durations (s) for fly-along playback at 1x. length is
 * waypoints.length - 1; each entry is hover_duration on the source
 * waypoint plus 3d distance / waypoint speed (or fallbackSpeed). returns
 * [] for fewer than 2 waypoints.
 */
export function computeSegmentDurations(
  waypoints: readonly WaypointResponse[],
  opts: SegmentDurationOptions = {},
): number[] {
  if (!waypoints || waypoints.length < 2) return [];
  const fallback = sanitizeSpeed(opts.fallbackSpeed);
  const durations: number[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const distance = segmentDistance(a, b);
    const speed = pickSpeed(a.speed, fallback);
    const travel = speed > 0 ? distance / speed : 0;
    const hover = Math.max(0, a.hover_duration ?? 0);
    durations.push(hover + travel);
  }
  return durations;
}

function segmentDistance(a: WaypointResponse, b: WaypointResponse): number {
  const [aLng, aLat, aAlt = 0] = a.position.coordinates;
  const [bLng, bLat, bAlt = 0] = b.position.coordinates;
  const horizontal = haversineDistance(aLng, aLat, bLng, bLat);
  const vertical = (bAlt ?? 0) - (aAlt ?? 0);
  return Math.sqrt(horizontal * horizontal + vertical * vertical);
}

function sanitizeSpeed(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return 0;
  return value;
}

function pickSpeed(primary: number | null | undefined, fallback: number): number {
  const s = sanitizeSpeed(primary);
  if (s > 0) return Math.max(MIN_SPEED, s);
  if (fallback > 0) return Math.max(MIN_SPEED, fallback);
  return 0;
}
