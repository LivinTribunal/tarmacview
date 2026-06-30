import { useTranslation } from "react-i18next";
import { formatNumber } from "@/utils/format";
import type { LHAResponse } from "@/types/airport";
import { CoordRows, InfoRow } from "./rows";

/** info rows for a single LHA (lamp head assembly). */
export default function LhaInfoPanel({ lha }: { lha: LHAResponse }) {
  const { t } = useTranslation();
  return (
    <>
      <InfoRow
        label={t("airport.lha.sequenceNumber")}
        value={`#${lha.sequence_number}`}
      />
      <InfoRow label={t("dashboard.poiUnitDesignator")} value={lha.unit_designator} />
      <InfoRow label={t("dashboard.poiLampType")} value={lha.lamp_type} />
      <InfoRow
        label={t("dashboard.poiSettingAngle")}
        value={`${formatNumber(lha.setting_angle, 1)}°`}
      />
      {lha.tolerance != null && (
        <InfoRow
          label={t("dashboard.poiTolerance")}
          value={`${formatNumber(lha.tolerance, 1)}°`}
        />
      )}
      {lha.lens_height_agl_m != null && (
        <InfoRow
          label={t("airport.lha.lensHeightAgl")}
          value={`${formatNumber(lha.lens_height_agl_m, 2)} ${t("common.units.m")}`}
        />
      )}
      {lha.lens_height_msl_m != null && (
        <InfoRow
          label={t("airport.lha.lensHeightMsl")}
          value={`${formatNumber(lha.lens_height_msl_m, 2)} ${t("common.units.m")}`}
        />
      )}
      <CoordRows position={lha.position} label={t("dashboard.poiCoordinates")} />
    </>
  );
}
