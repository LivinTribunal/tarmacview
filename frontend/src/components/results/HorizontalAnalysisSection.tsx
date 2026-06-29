import { useTranslation } from "react-i18next";
import type { LightSeries } from "@/types/measurement";
import LightTimeseriesChart from "./LightTimeseriesChart";
import LightDirectionCard from "./LightDirectionCard";

/** horizontal-analysis charts vs horizontal angle, plus the light-direction card. */
export default function HorizontalAnalysisSection({
  lights,
}: {
  lights: LightSeries[];
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <LightTimeseriesChart
        title={t("results.horizontal.redChroma")}
        explanation={t("results.charts.explain.hRedChroma")}
        lights={lights}
        field="chromaticity_x"
        yLabel={t("results.charts.chromaticityUnit")}
        xField="horizontal_angle"
        xLabel={t("results.charts.horizontalAxis")}
        centerlineX={0}
        testId="chart-horizontal-red-chroma"
      />
      <LightTimeseriesChart
        title={t("results.horizontal.luminosity")}
        explanation={t("results.charts.explain.hLuminosity")}
        lights={lights}
        field="intensity"
        yLabel={t("results.charts.intensityUnit")}
        xField="horizontal_angle"
        xLabel={t("results.charts.horizontalAxis")}
        centerlineX={0}
        testId="chart-horizontal-luminosity"
      />
      <LightDirectionCard lights={lights} />
    </div>
  );
}
