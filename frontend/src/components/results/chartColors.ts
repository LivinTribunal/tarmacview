// per-light line-color lookup for the recharts results charts. the canonical
// hex lives in `src/constants/palette.ts` alongside the maplibre palette -
// recharts applies stroke/fill as svg presentation attributes which do not
// resolve css var(), so the raw hex must be defined there.

import {
  INSPECTION_LIGHT_COLORS,
  INSPECTION_LIGHT_FALLBACK_COLOR,
} from "@/constants/palette";

export function lightColor(name: string): string {
  return INSPECTION_LIGHT_COLORS[name] ?? INSPECTION_LIGHT_FALLBACK_COLOR;
}
