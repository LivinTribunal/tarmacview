import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "react-i18next";
import type { IterationSeries, LightSeriesPoint } from "@/types/measurement";
import { CHART_COLORS, ITERATION_SERIES_COLORS } from "@/constants/palette";

interface IterationOverlayChartProps {
  title: string;
  series: IterationSeries[];
  field: keyof LightSeriesPoint;
  yLabel: string;
}

/** overlay chart for one light/field - one line per iteration over the frame timestamp. */
export default function IterationOverlayChart({
  title,
  series,
  field,
  yLabel,
}: IterationOverlayChartProps) {
  const { t } = useTranslation();
  const hasData = series.some((s) => s.points.some((p) => p[field] !== null));

  return (
    <div
      className="bg-tv-surface border border-tv-border rounded-2xl p-4"
      data-testid={`iteration-chart-${String(field)}`}
    >
      <h3 className="text-sm font-medium text-tv-text-primary mb-3">{title}</h3>
      {hasData ? (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart margin={{ top: 5, right: 16, bottom: 24, left: 0 }}>
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
            <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 12, paddingTop: 16 }} />
            {series.map((s, i) =>
              s.points.some((p) => p[field] !== null) ? (
                <Line
                  key={s.iteration_index ?? i}
                  data={s.points}
                  dataKey={field as string}
                  name={t("iterationCompare.iterationN", { index: s.iteration_index })}
                  stroke={ITERATION_SERIES_COLORS[i % ITERATION_SERIES_COLORS.length]}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ) : null,
            )}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-sm text-tv-text-muted py-8 text-center">
          {t("iterationCompare.noData")}
        </p>
      )}
    </div>
  );
}
