import { formatNumber } from "@/utils/format";
import { datumHeightLabel } from "@/utils/altitudeLabel";
import type { LHAResponse } from "@/types/airport";
import type { FeatureFieldDef } from "./types";

/** ordered LHA display fields; lens heights carry explicit MSL / AGL datums. */
export const lhaFields: FeatureFieldDef<LHAResponse>[] = [
  {
    key: "sequence_number",
    labelKey: "featureFields.sequenceNumber",
    read: (l) => `#${l.sequence_number}`,
  },
  { key: "unit_designator", labelKey: "featureFields.unitDesignator", read: (l) => l.unit_designator },
  { key: "lamp_type", labelKey: "featureFields.lampType", read: (l) => l.lamp_type },
  {
    key: "setting_angle",
    labelKey: "featureFields.settingAngle",
    read: (l) => (l.setting_angle != null ? `${formatNumber(l.setting_angle, 1)}°` : null),
  },
  {
    key: "tolerance",
    labelKey: "featureFields.tolerance",
    visible: (l) => l.tolerance != null,
    read: (l) => `${formatNumber(l.tolerance, 1)}°`,
  },
  {
    key: "lens_height_msl_m",
    labelKey: "featureFields.lensHeightMsl",
    visible: (l) => l.lens_height_msl_m != null,
    read: (l, t) => datumHeightLabel(l.lens_height_msl_m, t, "MSL"),
  },
  {
    key: "lens_height_agl_m",
    labelKey: "featureFields.lensHeightAgl",
    visible: (l) => l.lens_height_agl_m != null,
    read: (l, t) => datumHeightLabel(l.lens_height_agl_m, t, "AGL"),
  },
];
