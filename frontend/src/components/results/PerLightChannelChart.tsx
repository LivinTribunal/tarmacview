import { useState, type ReactNode } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "react-i18next";
import type { LightSeries, LightSeriesPoint } from "@/types/measurement";
import {
  CHART_COLORS,
  CHART_REFERENCE_COLORS,
  CHART_ZONE_COLORS,
} from "@/constants/palette";
import { lightColor } from "./chartColors";
import ChartShell from "./ChartShell";
import PapiUnitSelector from "./PapiUnitSelector";
import VerdictBadge from "./VerdictBadge";
import { transitionVerdict } from "./TransitionAngleTable";

export interface Channel {
  name: string;
  color: string;
  value: (point: LightSeriesPoint) => number | null;
}

interface PerLightChannelChartProps {
  title: string;
  explanation: string;
  yLabel: string;
  lights: LightSeries[];
  channels: Channel[];
  // extra left-axis reference lines (e.g. the white-33% line)
  referenceLines?: ReactNode;
  testId?: string;
}

/** single-light chart with an a/b/c/d selector, angle overlay, and a verdict badge. */
export default function PerLightChannelChart({
  title,
  explanation,
  yLabel,
  lights,
  channels,
  referenceLines,
  testId,
}: PerLightChannelChartProps) {
  const { t } = useTranslation();
  const names = lights.map((l) => l.light_name);
  const [active, setActive] = useState<string>(names[0] ?? "");
  const light = lights.find((l) => l.light_name === active) ?? lights[0];

  if (!light) {
    return (
      <ChartShell
        title={title}
        explanation={explanation}
        hasData={false}
        testId={testId}
      >
        <ComposedChart />
      </ChartShell>
    );
  }

  const hasData = light.points.some((p) =>
    channels.some((c) => c.value(p) !== null),
  );
  const verdict =
    light.passed === true
      ? "pass"
      : light.passed === false
        ? "fail"
        : transitionVerdict(
            light.transition_angle_middle,
            light.setting_angle,
            light.tolerance,
          );

  return (
    <ChartShell
      title={title}
      explanation={explanation}
      hasData={hasData}
      badge={<VerdictBadge verdict={verdict} />}
      toolbar={
        <PapiUnitSelector
          lights={names}
          active={light.light_name}
          onChange={setActive}
        />
      }
      testId={testId}
    >
      <ComposedChart
        data={light.points}
        margin={{ top: 5, right: 16, bottom: 24, left: 0 }}
      >
        <CartesianGrid stroke={CHART_COLORS.GRID} strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="timestamp"
          stroke={CHART_COLORS.AXIS}
          tick={{ fontSize: 11, fill: CHART_COLORS.AXIS }}
          label={{
            value: t("results.charts.timeAxis"),
            position: "insideBottom",
            offset: -8,
            fontSize: 11,
            fill: CHART_COLORS.AXIS,
          }}
        />
        <YAxis
          yAxisId="left"
          stroke={CHART_COLORS.AXIS}
          tick={{ fontSize: 11, fill: CHART_COLORS.AXIS }}
          label={{
            value: yLabel,
            angle: -90,
            position: "insideLeft",
            fontSize: 11,
            fill: CHART_COLORS.AXIS,
          }}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          stroke={CHART_COLORS.AXIS}
          tick={{ fontSize: 11, fill: CHART_COLORS.AXIS }}
          label={{
            value: t("results.charts.elevationOverlay"),
            angle: 90,
            position: "insideRight",
            fontSize: 11,
            fill: CHART_COLORS.AXIS,
          }}
        />
        <Tooltip
          contentStyle={{ fontSize: 12 }}
          labelFormatter={(v) => `${Number(v).toFixed(2)} s`}
        />
        <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 12, paddingTop: 16 }} />

        {/* angle transition bands + dashed nominal line on the angle (right) axis */}
        {light.transition_angle_min !== null &&
          light.transition_angle_middle !== null &&
          light.transition_angle_max !== null && [
            <ReferenceArea
              key="zone-red"
              yAxisId="right"
              y1={light.transition_angle_min}
              y2={light.transition_angle_middle}
              fill={CHART_ZONE_COLORS.RED}
              fillOpacity={0.12}
              ifOverflow="extendDomain"
            />,
            <ReferenceArea
              key="zone-white"
              yAxisId="right"
              y1={light.transition_angle_middle}
              y2={light.transition_angle_max}
              fill={CHART_ZONE_COLORS.WHITE}
              fillOpacity={0.18}
              ifOverflow="extendDomain"
            />,
          ]}
        {light.setting_angle !== null && (
          <ReferenceLine
            yAxisId="right"
            y={light.setting_angle}
            stroke={CHART_REFERENCE_COLORS.NOMINAL}
            strokeDasharray="6 4"
          />
        )}
        {referenceLines}

        {channels.map((channel) => (
          <Line
            key={channel.name}
            yAxisId="left"
            dataKey={(p: LightSeriesPoint) => channel.value(p)}
            name={channel.name}
            stroke={channel.color}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        ))}

        <Line
          yAxisId="right"
          dataKey="angle"
          name={t("results.charts.elevationOverlay")}
          stroke={lightColor(light.light_name)}
          strokeDasharray="4 3"
          strokeOpacity={0.55}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
      </ComposedChart>
    </ChartShell>
  );
}
