import { useTranslation } from "react-i18next";
import { formatNumber } from "@/utils/format";
import type { ObstacleResponse } from "@/types/airport";
import { InfoRow, PolygonCoordRows } from "./rows";

/** info rows for an obstacle feature. */
export default function ObstacleInfoPanel({ obstacle }: { obstacle: ObstacleResponse }) {
  const { t } = useTranslation();
  return (
    <>
      <InfoRow label={t("dashboard.poiName")} value={obstacle.name} />
      <InfoRow label={t("dashboard.poiType")} value={obstacle.type.replace(/_/g, " ")} />
      <InfoRow
        label={t("dashboard.poiHeight")}
        value={`${formatNumber(obstacle.height, 2)}${t("common.units.m")}`}
      />
      <InfoRow
        label={t("dashboard.bufferDistance")}
        value={`${formatNumber(obstacle.buffer_distance, 2)}${t("common.units.m")}`}
      />
      <PolygonCoordRows polygon={obstacle.boundary} label={t("dashboard.poiCoordinates")} />
    </>
  );
}
