import { useTranslation } from "react-i18next";
import type { LightSeries } from "@/types/measurement";
import LightTimeseriesChart from "./LightTimeseriesChart";

/** per-light measured intensity over time. */
export default function IntensityChart({ lights }: { lights: LightSeries[] }) {
  const { t } = useTranslation();
  return (
    <LightTimeseriesChart
      title={t("results.charts.intensity")}
      explanation={t("results.charts.explain.intensity")}
      lights={lights}
      field="intensity"
      yLabel={t("results.charts.intensityUnit")}
      rightField="angle"
      rightLabel={t("results.charts.elevationOverlay")}
    />
  );
}
