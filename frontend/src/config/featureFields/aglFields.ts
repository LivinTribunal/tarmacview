import { formatNumber } from "@/utils/format";
import { datumHeightLabel } from "@/utils/altitudeLabel";
import type { AGLResponse } from "@/types/airport";
import type { FeatureFieldDef } from "./types";

const isPapi = (a: AGLResponse) => a.agl_type === "PAPI";

/** ordered AGL display fields; read panels gain MEHT height + altitude and the
 * glide-slope tolerance the read view previously omitted. */
export const aglFields: FeatureFieldDef<AGLResponse>[] = [
  { key: "agl_type", labelKey: "featureFields.type", read: (a) => a.agl_type.replace(/_/g, " ") },
  { key: "side", labelKey: "featureFields.side", visible: (a) => a.side != null, read: (a) => a.side },
  {
    key: "glide_slope_angle",
    labelKey: "featureFields.glideAngle",
    visible: (a) => isPapi(a) && a.glide_slope_angle != null,
    read: (a) => `${formatNumber(a.glide_slope_angle, 1)}°`,
  },
  {
    key: "glide_slope_angle_tolerance",
    labelKey: "featureFields.glideTolerance",
    visible: (a) => isPapi(a) && a.glide_slope_angle_tolerance != null,
    read: (a) => `${formatNumber(a.glide_slope_angle_tolerance, 1)}°`,
  },
  {
    key: "distance_from_threshold",
    labelKey: "featureFields.distanceFromThreshold",
    visible: (a) => isPapi(a) && a.distance_from_threshold != null,
    read: (a, t) => `${formatNumber(a.distance_from_threshold, 1)}${t("common.units.m")}`,
  },
  {
    key: "meht_height_m",
    labelKey: "featureFields.mehtHeight",
    visible: (a) => isPapi(a) && a.meht_height_m != null,
    read: (a, t) => datumHeightLabel(a.meht_height_m, t, "AGL"),
  },
  {
    key: "meht_altitude_msl",
    labelKey: "featureFields.mehtAltitude",
    visible: (a) => isPapi(a) && a.meht_altitude_msl != null,
    read: (a, t) => datumHeightLabel(a.meht_altitude_msl, t, "MSL"),
  },
];
