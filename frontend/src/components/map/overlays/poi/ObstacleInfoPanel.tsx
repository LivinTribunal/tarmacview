import { useTranslation } from "react-i18next";
import { obstacleFields } from "@/config/featureFields";
import type { ObstacleResponse } from "@/types/airport";
import { FieldRows, PolygonCoordRows } from "./rows";

/** info rows for an obstacle feature. */
export default function ObstacleInfoPanel({ obstacle }: { obstacle: ObstacleResponse }) {
  const { t } = useTranslation();
  return (
    <>
      <FieldRows defs={obstacleFields} entity={obstacle} />
      <PolygonCoordRows polygon={obstacle.boundary} label={t("dashboard.poiCoordinates")} />
    </>
  );
}
