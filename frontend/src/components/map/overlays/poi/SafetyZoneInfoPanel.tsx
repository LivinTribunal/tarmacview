import { useTranslation } from "react-i18next";
import { formatNumber } from "@/utils/format";
import type { SafetyZoneResponse } from "@/types/airport";
import { InfoRow, PolygonCoordRows } from "./rows";
import { computePolygonAreaPerimeter, formatArea, formatLength } from "./polygonMetrics";

/** info rows for a safety zone, with an AIRPORT_BOUNDARY-specific layout. */
export default function SafetyZoneInfoPanel({ zone }: { zone: SafetyZoneResponse }) {
  const { t } = useTranslation();

  if (zone.type === "AIRPORT_BOUNDARY") {
    const { areaM2, perimeterM } = computePolygonAreaPerimeter(zone.geometry);
    return (
      <>
        <InfoRow label={t("dashboard.poiName")} value={zone.name} />
        <InfoRow label={t("dashboard.poiType")} value={t("boundary.airportBoundary")} />
        <InfoRow
          label={t("dashboard.poiArea", { defaultValue: "Area" })}
          value={formatArea(areaM2, t)}
        />
        <InfoRow
          label={t("dashboard.poiPerimeter", { defaultValue: "Perimeter" })}
          value={formatLength(perimeterM, t)}
        />
        <PolygonCoordRows polygon={zone.geometry} label={t("dashboard.poiCoordinates")} />
      </>
    );
  }

  return (
    <>
      <InfoRow label={t("dashboard.poiName")} value={zone.name} />
      <InfoRow label={t("dashboard.poiType")} value={zone.type.replace(/_/g, " ")} />
      <InfoRow
        label={t("dashboard.poiActive")}
        value={zone.is_active ? t("common.yes") : t("common.no")}
      />
      {zone.altitude_floor != null && (
        <InfoRow
          label={t("dashboard.poiFloor")}
          value={`${formatNumber(zone.altitude_floor, 2)}${t("common.units.m")}`}
        />
      )}
      {zone.altitude_ceiling != null && (
        <InfoRow
          label={t("dashboard.poiCeiling")}
          value={`${formatNumber(zone.altitude_ceiling, 2)}${t("common.units.m")}`}
        />
      )}
      <PolygonCoordRows polygon={zone.geometry} label={t("dashboard.poiCoordinates")} />
    </>
  );
}
