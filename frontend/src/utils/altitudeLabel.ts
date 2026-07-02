/** datum-aware altitude display helpers - the single formatting path for every
 * altitude readout so no site ever renders a bare, ambiguous `m`. */

import { formatNumber } from "@/utils/format";

type TFn = (key: string, opts?: Record<string, unknown>) => string;

type Datum = "MSL" | "AGL";

function datumToken(t: TFn, datum: Datum): string {
  /** localized MSL / AGL token. */
  return datum === "MSL" ? t("common.datum.msl") : t("common.datum.agl");
}

/** "12.00 m AGL" / "1234.50 m MSL"; empty string when the value is null. */
export function datumHeightLabel(
  value: number | null | undefined,
  t: TFn,
  datum: Datum,
  decimals = 2,
): string {
  const n = formatNumber(value, decimals);
  if (n === "") return "";
  return `${n}${t("common.units.m")} ${datumToken(t, datum)}`;
}

/** "123.00 m MSL / 45.00 m AGL"; drops the AGL segment when agl is null, and
 * returns just the AGL segment when only agl is known. */
export function mslAglLabel(
  msl: number | null | undefined,
  agl: number | null | undefined,
  t: TFn,
  decimals = 2,
): string {
  const mslText = datumHeightLabel(msl, t, "MSL", decimals);
  const aglText = datumHeightLabel(agl, t, "AGL", decimals);
  if (mslText && aglText) return `${mslText} / ${aglText}`;
  return mslText || aglText;
}

function rangeSegment(
  min: number | null | undefined,
  max: number | null | undefined,
  t: TFn,
  datum: Datum,
  decimals: number,
): string {
  // arrow (not dash) so a negative AGL bound doesn't read as a subtraction
  if (min == null || max == null) return "";
  return `${formatNumber(min, decimals)} → ${formatNumber(max, decimals)}${t("common.units.m")} ${datumToken(t, datum)}`;
}

/** "100.0 → 140.0 m MSL / 8.3 → 24.5 m AGL"; drops whichever datum pair is null. */
export function mslAglRangeLabel(
  minMsl: number | null | undefined,
  maxMsl: number | null | undefined,
  minAgl: number | null | undefined,
  maxAgl: number | null | undefined,
  t: TFn,
  decimals = 1,
): string {
  const mslText = rangeSegment(minMsl, maxMsl, t, "MSL", decimals);
  const aglText = rangeSegment(minAgl, maxAgl, t, "AGL", decimals);
  if (mslText && aglText) return `${mslText} / ${aglText}`;
  return mslText || aglText;
}
