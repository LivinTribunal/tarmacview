import { useTranslation } from "react-i18next";
import type { LightSeries, LightSeriesPoint } from "@/types/measurement";
import LightTimeseriesChart from "./LightTimeseriesChart";

// red minus green chromaticity - a single color-balance number per frame
function colorDiff(point: LightSeriesPoint): number | null {
  if (point.chromaticity_x === null || point.chromaticity_y === null) {
    return null;
  }
  return point.chromaticity_x - point.chromaticity_y;
}

/** aggregate vertical-analysis charts - all four lights overlaid vs the angle overlay. */
export default function VerticalAnalysisSection({
  lights,
}: {
  lights: LightSeries[];
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <LightTimeseriesChart
        title={t("results.vertical.redChroma")}
        explanation={t("results.charts.explain.redChroma")}
        lights={lights}
        field="chromaticity_x"
        yLabel={t("results.charts.chromaticityUnit")}
        rightField="angle"
        rightLabel={t("results.charts.elevationOverlay")}
        testId="chart-vertical-red-chroma"
      />
      <LightTimeseriesChart
        title={t("results.vertical.luminosity")}
        explanation={t("results.charts.explain.luminosity")}
        lights={lights}
        field="intensity"
        yLabel={t("results.charts.intensityUnit")}
        rightField="angle"
        rightLabel={t("results.charts.elevationOverlay")}
        testId="chart-vertical-luminosity"
      />
      <LightTimeseriesChart
        title={t("results.vertical.colorDiff")}
        explanation={t("results.charts.explain.colorDiff")}
        lights={lights}
        field={colorDiff}
        yLabel={t("results.vertical.colorDiffUnit")}
        rightField="angle"
        rightLabel={t("results.charts.elevationOverlay")}
        testId="chart-vertical-color-diff"
      />
      <LightTimeseriesChart
        title={t("results.vertical.lightArea")}
        explanation={t("results.charts.explain.lightArea")}
        lights={lights}
        field="area_pixels"
        yLabel={t("results.vertical.lightAreaUnit")}
        rightField="angle"
        rightLabel={t("results.charts.elevationOverlay")}
        testId="chart-vertical-light-area"
      />
    </div>
  );
}
