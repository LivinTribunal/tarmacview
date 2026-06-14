/** coordinate display formatting - sub-mm lat/lon precision, configurable altitude. */

import { formatNumber } from "@/utils/format";

// 9 dp is sub-mm at the equator; past 9 is below GNSS noise
const COORD_DECIMALS = 9;

/** format a latitude (9 dp default), empty string for null/undefined/NaN. */
export function formatLat(
  value: number | null | undefined,
  decimals = COORD_DECIMALS,
): string {
  return formatNumber(value, decimals);
}

/** format a longitude (9 dp default), empty string for null/undefined/NaN. */
export function formatLon(
  value: number | null | undefined,
  decimals = COORD_DECIMALS,
): string {
  return formatNumber(value, decimals);
}

/** format an altitude to the given decimals (default 1), empty for null/undefined/NaN. */
export function formatAlt(
  value: number | null | undefined,
  decimals = 1,
): string {
  return formatNumber(value, decimals);
}
