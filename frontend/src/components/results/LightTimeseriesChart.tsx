import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "react-i18next";
import type { LightSeries, LightSeriesPoint } from "@/types/measurement";
import { CHART_COLORS } from "@/constants/palette";
import { lightColor } from "./chartColors";

interface LightTimeseriesChartProps {
  title: string;
  lights: LightSeries[];
  field: keyof LightSeriesPoint;
  yLabel: string;
  // draw a horizontal reference line at each light's transition middle angle
  showTransitionLines?: boolean;
}

/** shared recharts line chart - one line per light over the frame timestamp. */
export default function LightTimeseriesChart({
  title,
  lights,
  field,
  yLabel,
  showTransitionLines = false,
}: LightTimeseriesChartProps) {
  const { t } = useTranslation();
  const hasData = lights.some((light) =>
    light.points.some((p) => p[field] !== null),
  );

  return (
    <div
      className="bg-tv-surface border border-tv-border rounded-2xl p-4"
      data-testid={`chart-${String(field)}`}
    >
      <h3 className="text-sm font-medium text-tv-text-primary mb-3">{title}</h3>
      {hasData ? (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart margin={{ top: 5, right: 16, bottom: 16, left: 0 }}>
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
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              labelFormatter={(v) => `${Number(v).toFixed(2)} s`}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {lights.map((light) =>
              light.points.some((p) => p[field] !== null) ? (
                <Line
                  key={light.light_name}
                  data={light.points}
                  dataKey={field as string}
                  name={light.light_name}
                  stroke={lightColor(light.light_name)}
                  dot={false}
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
                    y={light.transition_angle_middle}
                    stroke={lightColor(light.light_name)}
                    strokeDasharray="6 4"
                    strokeOpacity={0.5}
                  />
                ) : null,
              )}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-sm text-tv-text-muted py-8 text-center">
          {t("results.noData")}
        </p>
      )}
    </div>
  );
}
