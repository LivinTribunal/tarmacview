// min/max/avg/range over a series, shared by the comparison tables.

import type { LightSeries } from "@/types/measurement";

export interface SeriesStats {
  min: number;
  max: number;
  avg: number;
  range: number;
}

/** min/max/avg/range over the finite values; null when none are present. */
export function seriesStats(values: Array<number | null>): SeriesStats | null {
  const finite = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  if (finite.length === 0) return null;

  let min = finite[0];
  let max = finite[0];
  let sum = 0;
  for (const v of finite) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, avg: sum / finite.length, range: max - min };
}

/** mid glide path angle from PAPI_B max + PAPI_C min; null when either is missing. */
export function computeGlidePathAngle(lights: LightSeries[]): number | null {
  const b =
    lights.find((l) => l.light_name === "PAPI_B")?.transition_angle_max ?? null;
  const c =
    lights.find((l) => l.light_name === "PAPI_C")?.transition_angle_min ?? null;
  if (b === null || c === null) return null;
  return (b + c) / 2;
}
