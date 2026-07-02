import { useTranslation } from "react-i18next";
import { formatAglDisplayName } from "@/utils/agl";
import { aglFields } from "@/config/featureFields";
import type { AGLResponse, SurfaceResponse } from "@/types/airport";
import { CoordRows, FieldRows, InfoRow } from "./rows";

/** info rows for an AGL (approach ground lights) feature. */
export default function AglInfoPanel({
  agl,
  surfaces,
}: {
  agl: AGLResponse;
  surfaces?: SurfaceResponse[];
}) {
  const { t } = useTranslation();
  const parentSurface = surfaces?.find((s) => s.id === agl.surface_id);
  return (
    <>
      <InfoRow label={t("featureFields.name")} value={formatAglDisplayName(agl, parentSurface)} />
      <FieldRows defs={aglFields} entity={agl} />
      <CoordRows position={agl.position} label={t("dashboard.poiCoordinates")} />
    </>
  );
}
