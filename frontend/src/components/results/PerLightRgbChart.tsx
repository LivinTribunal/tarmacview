import { useTranslation } from "react-i18next";
import type { LightSeries } from "@/types/measurement";
import { RGB_CHANNEL_COLORS } from "@/constants/palette";
import PerLightChannelChart from "./PerLightChannelChart";

/** per-light raw r/g/b channels (0-255) over time with an elevation overlay. */
export default function PerLightRgbChart({
  lights,
}: {
  lights: LightSeries[];
}) {
  const { t } = useTranslation();
  return (
    <PerLightChannelChart
      title={t("results.perLight.rgbTitle")}
      explanation={t("results.charts.explain.perLightRgb")}
      yLabel={t("results.perLight.rgbUnit")}
      lights={lights}
      testId="chart-per-light-rgb"
      channels={[
        {
          name: t("results.perLight.channelRed"),
          color: RGB_CHANNEL_COLORS.red,
          value: (p) => p.red ?? null,
        },
        {
          name: t("results.perLight.channelGreen"),
          color: RGB_CHANNEL_COLORS.green,
          value: (p) => p.green ?? null,
        },
        {
          name: t("results.perLight.channelBlue"),
          color: RGB_CHANNEL_COLORS.blue,
          value: (p) => p.blue ?? null,
        },
      ]}
    />
  );
}
