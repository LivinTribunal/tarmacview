import { useTranslation } from "react-i18next";
import { lhaFields } from "@/config/featureFields";
import type { LHAResponse } from "@/types/airport";
import { CoordRows, FieldRows } from "./rows";

/** info rows for a single LHA (lamp head assembly). */
export default function LhaInfoPanel({ lha }: { lha: LHAResponse }) {
  const { t } = useTranslation();
  return (
    <>
      <FieldRows defs={lhaFields} entity={lha} />
      <CoordRows position={lha.position} label={t("dashboard.poiCoordinates")} />
    </>
  );
}
