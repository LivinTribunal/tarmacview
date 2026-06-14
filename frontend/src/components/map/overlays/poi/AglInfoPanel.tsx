import { useTranslation } from "react-i18next";
import { formatAglDisplayName } from "@/utils/agl";
import { formatNumber } from "@/utils/format";
import type { AGLResponse, SurfaceResponse } from "@/types/airport";
import { CoordRows, InfoRow } from "./rows";

export default function AglInfoPanel({
  agl,
  surfaces,
}: {
  agl: AGLResponse;
  surfaces?: SurfaceResponse[];
}) {
  /** info rows for an AGL (approach ground lights) feature. */
  const { t } = useTranslation();
  const parentSurface = surfaces?.find((s) => s.id === agl.surface_id);
  return (
    <>
      <InfoRow label={t("dashboard.poiName")} value={formatAglDisplayName(agl, parentSurface)} />
      <InfoRow label={t("dashboard.poiType")} value={agl.agl_type.replace(/_/g, " ")} />
      {agl.side && <InfoRow label={t("dashboard.poiSide")} value={agl.side} />}
      {agl.agl_type === "PAPI" && agl.glide_slope_angle != null && (
        <InfoRow
          label={t("dashboard.poiGlideAngle")}
          value={`${formatNumber(agl.glide_slope_angle, 1)}°`}
        />
      )}
      {agl.agl_type === "PAPI" && agl.distance_from_threshold != null && (
        <InfoRow
          label={t("dashboard.poiDistanceFromThreshold")}
          value={`${formatNumber(agl.distance_from_threshold, 1)}${t("common.units.m")}`}
        />
      )}
      <CoordRows position={agl.position} label={t("dashboard.poiCoordinates")} />
    </>
  );
}
