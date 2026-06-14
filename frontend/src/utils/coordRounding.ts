// shared coordinate-display rounding. single source for the round-trip idioms
// used when echoing picked/derived numbers back into form inputs.

/** round a lat/lon degree value to 6 decimal places (~0.11 m). */
export function roundCoord(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** round an altitude/length/width value to 2 decimal places. */
export function roundAlt(n: number): number {
  return Math.round(n * 100) / 100;
}
