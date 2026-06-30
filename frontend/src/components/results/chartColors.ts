// per-light line-color lookup for the recharts results charts. the canonical
// hex lives in `src/constants/palette.ts` alongside the maplibre palette -
// recharts applies stroke/fill as svg presentation attributes which do not
// resolve css var(), so the raw hex must be defined there.

import {
  CHART_COLORS,
  INSPECTION_LIGHT_COLORS,
  INSPECTION_LIGHT_FALLBACK_COLOR,
} from "@/constants/palette";

export function lightColor(name: string): string {
  return INSPECTION_LIGHT_COLORS[name] ?? INSPECTION_LIGHT_FALLBACK_COLOR;
}

/** shared recharts left-Y-axis props for the light timeseries charts. */
export function leftYAxisProps(yLabel: string) {
  return {
    yAxisId: "left" as const,
    stroke: CHART_COLORS.AXIS,
    tick: { fontSize: 11, fill: CHART_COLORS.AXIS },
    label: {
      value: yLabel,
      angle: -90,
      position: "insideLeft" as const,
      fontSize: 11,
      fill: CHART_COLORS.AXIS,
    },
  };
}
