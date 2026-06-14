import { AGL_COLORS } from "@/constants/palette";

// one color per AGL system type
const AGL_COLOR_BY_TYPE: Record<string, string> = {
  PAPI: AGL_COLORS.PAPI,
  RUNWAY_EDGE_LIGHTS: AGL_COLORS.RUNWAY_EDGE_LIGHTS,
};

const DEFAULT_AGL_COLOR = AGL_COLORS.DEFAULT;

/** return the canonical color for an AGL system type. */
export function aglColorForType(aglType: string | null | undefined): string {
  if (!aglType) return DEFAULT_AGL_COLOR;
  return AGL_COLOR_BY_TYPE[aglType] ?? DEFAULT_AGL_COLOR;
}
