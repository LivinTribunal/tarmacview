import { datumHeightLabel } from "@/utils/altitudeLabel";
import type { SafetyZoneResponse } from "@/types/airport";
import type { FeatureFieldDef } from "./types";

/** ordered safety-zone display fields (regular zones); floor/ceiling are MSL,
 * the *_agl counterparts are the derived AGL readings. */
export const safetyZoneFields: FeatureFieldDef<SafetyZoneResponse>[] = [
  { key: "name", labelKey: "featureFields.name", read: (z) => z.name },
  { key: "type", labelKey: "featureFields.type", read: (z) => z.type.replace(/_/g, " ") },
  {
    key: "is_active",
    labelKey: "featureFields.active",
    read: (z, t) => (z.is_active ? t("common.yes") : t("common.no")),
  },
  {
    key: "altitude_floor",
    labelKey: "featureFields.floor",
    read: (z, t) => (z.altitude_floor != null ? datumHeightLabel(z.altitude_floor, t, "MSL") : null),
  },
  {
    key: "altitude_ceiling",
    labelKey: "featureFields.ceiling",
    read: (z, t) => (z.altitude_ceiling != null ? datumHeightLabel(z.altitude_ceiling, t, "MSL") : null),
  },
  {
    key: "altitude_floor_agl",
    labelKey: "featureFields.floorAgl",
    read: (z, t) => (z.altitude_floor_agl != null ? datumHeightLabel(z.altitude_floor_agl, t, "AGL") : null),
  },
  {
    key: "altitude_ceiling_agl",
    labelKey: "featureFields.ceilingAgl",
    read: (z, t) => (z.altitude_ceiling_agl != null ? datumHeightLabel(z.altitude_ceiling_agl, t, "AGL") : null),
  },
];
