import { useTranslation } from "react-i18next";
import { safetyZoneFields } from "@/config/featureFields";
import type { SafetyZoneResponse } from "@/types/airport";
import { FieldRows, InfoRow, PolygonCoordRows } from "./rows";
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
      <FieldRows defs={safetyZoneFields} entity={zone} />
      <PolygonCoordRows polygon={zone.geometry} label={t("dashboard.poiCoordinates")} />
    </>
  );
}
