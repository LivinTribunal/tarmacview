import { type ReactNode } from "react";
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

// a key into a point, or a derived accessor (e.g. a color-difference)
type FieldAccessor =
  | keyof LightSeriesPoint
  | ((point: LightSeriesPoint) => number | null);

interface LightTimeseriesChartProps {
  title: string;
  explanation: string;
  lights: LightSeries[];
  field: FieldAccessor;
  yLabel: string;
  // x dimension - default "timestamp" (seconds); "horizontal_angle" for horizontal analysis
  xField?: keyof LightSeriesPoint;
  xLabel?: string;
  // optional right-axis overlay (e.g. elevation angle) drawn dashed per light
  rightField?: keyof LightSeriesPoint;
  rightLabel?: string;
  // vertical reference line on the x-axis (horizontal analysis centerline)
  centerlineX?: number;
  badge?: ReactNode;
  // draw a horizontal reference line at each light's transition middle angle
  showTransitionLines?: boolean;
  // shade each light's red (below middle) and white (above middle) transition bands
  showTransitionZones?: boolean;
  testId?: string;
}

/** a light whose full transition band (min/middle/max) is known. */
function hasTransitionBand(
  light: LightSeries,
): light is LightSeries & {
  transition_angle_min: number;
  transition_angle_middle: number;
  transition_angle_max: number;
} {
  return (
    light.transition_angle_min !== null &&
    light.transition_angle_middle !== null &&
    light.transition_angle_max !== null
  );
}

function resolve(point: LightSeriesPoint, field: FieldAccessor): number | null {
  if (typeof field === "function") return field(point);
  const value = point[field];
  return typeof value === "number" ? value : null;
}

/** shared multi-light chart - one line per light, optional angle overlay + zones. */
export default function LightTimeseriesChart({
  title,
  explanation,
  lights,
  field,
  yLabel,
  xField = "timestamp",
  xLabel,
  rightField,
  rightLabel,
  centerlineX,
  badge,
  showTransitionLines = false,
  showTransitionZones = false,
  testId,
}: LightTimeseriesChartProps) {
  const { t } = useTranslation();
  const fieldKey = typeof field === "function" ? "derived" : String(field);
  const hasData = lights.some((light) =>
    light.points.some((p) => resolve(p, field) !== null),
  );
  const isTimeAxis = xField === "timestamp";

  return (
    <ChartShell
      title={title}
      explanation={explanation}
      hasData={hasData}
      badge={badge}
      testId={testId ?? `chart-${fieldKey}`}
    >
      <ComposedChart margin={{ top: 5, right: 16, bottom: 24, left: 0 }}>
        <CartesianGrid stroke={CHART_COLORS.GRID} strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey={xField}
          stroke={CHART_COLORS.AXIS}
          tick={{ fontSize: 11, fill: CHART_COLORS.AXIS }}
          label={{
            value: xLabel ?? t("results.charts.timeAxis"),
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
        {rightField && (
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke={CHART_COLORS.AXIS}
            tick={{ fontSize: 11, fill: CHART_COLORS.AXIS }}
            label={{
              value: rightLabel ?? t("results.charts.elevationOverlay"),
              angle: 90,
              position: "insideRight",
              fontSize: 11,
              fill: CHART_COLORS.AXIS,
            }}
          />
        )}
        <Tooltip
          contentStyle={{ fontSize: 12 }}
          labelFormatter={(v) =>
            isTimeAxis ? `${Number(v).toFixed(2)} s` : `${Number(v).toFixed(2)}°`
          }
        />
        {/* paddingTop drops the legend clear of the x-axis label below it */}
        <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 12, paddingTop: 16 }} />

        {showTransitionZones &&
          lights.filter(hasTransitionBand).flatMap((light) => [
            <ReferenceArea
              key={`zone-red-${light.light_name}`}
              yAxisId="left"
              y1={light.transition_angle_min}
              y2={light.transition_angle_middle}
              fill={CHART_ZONE_COLORS.RED}
              fillOpacity={0.12}
              ifOverflow="extendDomain"
            />,
            <ReferenceArea
              key={`zone-white-${light.light_name}`}
              yAxisId="left"
              y1={light.transition_angle_middle}
              y2={light.transition_angle_max}
              fill={CHART_ZONE_COLORS.WHITE}
              fillOpacity={0.18}
              ifOverflow="extendDomain"
            />,
          ])}

        {centerlineX !== undefined && (
          <ReferenceLine
            yAxisId="left"
            x={centerlineX}
            stroke={CHART_REFERENCE_COLORS.CENTERLINE}
            strokeDasharray="4 3"
          />
        )}

        {lights.map((light) =>
          light.points.some((p) => resolve(p, field) !== null) ? (
            <Line
              key={light.light_name}
              yAxisId="left"
              data={light.points}
              dataKey={(p: LightSeriesPoint) => resolve(p, field)}
              name={light.light_name}
              stroke={lightColor(light.light_name)}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ) : null,
        )}

        {/* per-light angle overlay on the right axis, drawn thin + dashed */}
        {rightField &&
          lights.map((light) =>
            light.points.some((p) => p[rightField] !== null) ? (
              <Line
                key={`overlay-${light.light_name}`}
                yAxisId="right"
                data={light.points}
                dataKey={rightField as string}
                stroke={lightColor(light.light_name)}
                strokeDasharray="4 3"
                strokeOpacity={0.45}
                dot={false}
                legendType="none"
                isAnimationActive={false}
                connectNulls
              />
            ) : null,
          )}

        {showTransitionLines &&
          lights.map((light) =>
            light.transition_angle_middle !== null ? (
              <ReferenceLine
                key={`ref-${light.light_name}`}
                yAxisId="left"
                y={light.transition_angle_middle}
                stroke={lightColor(light.light_name)}
                strokeDasharray="6 4"
                strokeOpacity={0.5}
              />
            ) : null,
          )}
      </ComposedChart>
    </ChartShell>
  );
}
