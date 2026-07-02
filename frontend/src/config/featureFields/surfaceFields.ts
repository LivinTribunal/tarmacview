import { formatNumber } from "@/utils/format";
import type { SurfaceResponse } from "@/types/airport";
import type { FeatureFieldDef } from "./types";

/** ordered surface display fields. dimensions is a read-only combined field;
 * length/width are label-only entries the edit panel references. */
export const surfaceFields: FeatureFieldDef<SurfaceResponse>[] = [
  { key: "identifier", labelKey: "featureFields.identifier", read: (s) => s.identifier },
  { key: "surface_type", labelKey: "featureFields.surfaceType", read: (s) => s.surface_type },
  {
    key: "heading",
    labelKey: "featureFields.heading",
    read: (s) => (s.heading != null ? `${formatNumber(s.heading, 1)}°` : null),
  },
  { key: "length", labelKey: "featureFields.length" },
  { key: "width", labelKey: "featureFields.width" },
  {
    key: "dimensions",
    labelKey: "featureFields.dimensions",
    read: (s, t) =>
      s.length != null && s.width != null
        ? `${formatNumber(s.length, 2)}${t("common.units.m")} × ${formatNumber(s.width, 2)}${t("common.units.m")}`
        : null,
  },
  {
    key: "buffer_distance",
    labelKey: "featureFields.bufferDistance",
    read: (s, t) => `${formatNumber(s.buffer_distance, 2)}${t("common.units.m")}`,
  },
];
