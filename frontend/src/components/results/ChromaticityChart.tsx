import { useTranslation } from "react-i18next";
import type { LightSeries } from "@/types/measurement";
import LightTimeseriesChart from "./LightTimeseriesChart";

/** per-light chromaticity (normalized red fraction) over time. */
export default function ChromaticityChart({
  lights,
}: {
  lights: LightSeries[];
}) {
  const { t } = useTranslation();
  return (
    <LightTimeseriesChart
      title={t("results.charts.chromaticity")}
      lights={lights}
      field="chromaticity_x"
      yLabel={t("results.charts.chromaticityUnit")}
    />
  );
}
