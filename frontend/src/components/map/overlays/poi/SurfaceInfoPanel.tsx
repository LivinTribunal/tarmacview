import { useTranslation } from "react-i18next";
import { surfaceFields } from "@/config/featureFields";
import type { SurfaceResponse } from "@/types/airport";
import { FieldRows, PolygonCoordRows } from "./rows";

/** info rows for a surface feature (runway / taxiway / apron). */
export default function SurfaceInfoPanel({ surface }: { surface: SurfaceResponse }) {
  const { t } = useTranslation();
  return (
    <>
      <FieldRows defs={surfaceFields} entity={surface} />
      {surface.boundary && (
        <PolygonCoordRows polygon={surface.boundary} label={t("dashboard.poiCoordinates")} />
      )}
    </>
  );
}
