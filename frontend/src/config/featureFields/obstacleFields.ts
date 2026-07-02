import { formatNumber } from "@/utils/format";
import { datumHeightLabel } from "@/utils/altitudeLabel";
import type { ObstacleResponse } from "@/types/airport";
import type { FeatureFieldDef } from "./types";

/** ordered obstacle display fields; height is AGL, base/top are derived MSL. */
export const obstacleFields: FeatureFieldDef<ObstacleResponse>[] = [
  { key: "name", labelKey: "featureFields.name", read: (o) => o.name },
  { key: "type", labelKey: "featureFields.type", read: (o) => o.type.replace(/_/g, " ") },
  {
    key: "height",
    labelKey: "featureFields.height",
    read: (o, t) => datumHeightLabel(o.height, t, "AGL"),
  },
  {
    key: "base_altitude_msl",
    labelKey: "featureFields.baseAltitude",
    read: (o, t) => (o.base_altitude_msl != null ? datumHeightLabel(o.base_altitude_msl, t, "MSL") : null),
  },
  {
    key: "top_altitude_msl",
    labelKey: "featureFields.topAltitude",
    read: (o, t) => (o.top_altitude_msl != null ? datumHeightLabel(o.top_altitude_msl, t, "MSL") : null),
  },
  {
    key: "buffer_distance",
    labelKey: "featureFields.bufferDistance",
    read: (o, t) => `${formatNumber(o.buffer_distance, 2)}${t("common.units.m")}`,
  },
];
