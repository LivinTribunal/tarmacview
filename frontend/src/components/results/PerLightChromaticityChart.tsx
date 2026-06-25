import { ReferenceLine } from "recharts";
import { useTranslation } from "react-i18next";
import type { LightSeries } from "@/types/measurement";
import { CHART_REFERENCE_COLORS, RGB_CHANNEL_COLORS } from "@/constants/palette";
import PerLightChannelChart from "./PerLightChannelChart";

// normalized white point - all three channels equal at 1/3
const WHITE_33 = 1 / 3;

/** per-light normalized r/g/b chromaticity (%) with a white-33% reference line. */
export default function PerLightChromaticityChart({
  lights,
}: {
  lights: LightSeries[];
}) {
  const { t } = useTranslation();
  return (
    <PerLightChannelChart
      title={t("results.perLight.chromaTitle")}
      explanation={t("results.charts.explain.perLightChroma")}
      yLabel={t("results.perLight.chromaUnit")}
      lights={lights}
      testId="chart-per-light-chroma"
      referenceLines={
        <ReferenceLine
          yAxisId="left"
          y={WHITE_33}
          stroke={CHART_REFERENCE_COLORS.WHITE_33}
          strokeDasharray="6 4"
        />
      }
      channels={[
        {
          name: t("results.perLight.channelRed"),
          color: RGB_CHANNEL_COLORS.red,
          value: (p) => p.chromaticity_x,
        },
        {
          name: t("results.perLight.channelGreen"),
          color: RGB_CHANNEL_COLORS.green,
          value: (p) => p.chromaticity_y,
        },
        {
          name: t("results.perLight.channelBlue"),
          color: RGB_CHANNEL_COLORS.blue,
          value: (p) =>
            p.chromaticity_x !== null && p.chromaticity_y !== null
              ? 1 - p.chromaticity_x - p.chromaticity_y
              : null,
        },
      ]}
    />
  );
}
