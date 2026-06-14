import { useTranslation } from "react-i18next";
import type { LightSeries } from "@/types/measurement";
import LightTimeseriesChart from "./LightTimeseriesChart";

/** per-light elevation angle over time, with transition-middle reference lines. */
export default function LightAngleChart({ lights }: { lights: LightSeries[] }) {
  const { t } = useTranslation();
  return (
    <LightTimeseriesChart
      title={t("results.charts.angle")}
      lights={lights}
      field="angle"
      yLabel={t("results.charts.angleUnit")}
      showTransitionLines
    />
  );
}
