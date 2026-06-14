import { useTranslation } from "react-i18next";
import { formatNumber } from "@/utils/format";
import type { SurfaceResponse } from "@/types/airport";
import { InfoRow, PolygonCoordRows } from "./rows";

/** info rows for a surface feature (runway / taxiway / apron). */
export default function SurfaceInfoPanel({ surface }: { surface: SurfaceResponse }) {
  const { t } = useTranslation();
  return (
    <>
      <InfoRow label={t("dashboard.poiIdentifier")} value={surface.identifier} />
      <InfoRow label={t("dashboard.poiType")} value={surface.surface_type} />
      {surface.heading != null && (
        <InfoRow
          label={t("dashboard.poiHeading")}
          value={`${formatNumber(surface.heading, 1)}°`}
        />
      )}
      {surface.length != null && surface.width != null && (
        <InfoRow
          label={t("dashboard.poiDimensions")}
          value={`${formatNumber(surface.length, 2)}${t("common.units.m")} x ${formatNumber(surface.width, 2)}${t("common.units.m")}`}
        />
      )}
      {surface.boundary && (
        <PolygonCoordRows polygon={surface.boundary} label={t("dashboard.poiCoordinates")} />
      )}
    </>
  );
}
