import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "react-i18next";
import type { DronePathPoint } from "@/types/measurement";
import { CHART_COLORS, TRAJECTORY_COLORS } from "@/constants/palette";

/** drone altitude (wgs84 elevation) over the flight timestamp. */
export default function ClimbProfileChart({
  dronePath,
}: {
  dronePath: DronePathPoint[];
}) {
  const { t } = useTranslation();
  const points = dronePath.filter((p) => p.elevation !== null);

  return (
    <div
      className="bg-tv-surface border border-tv-border rounded-2xl p-4"
      data-testid="chart-climb-profile"
    >
      <h3 className="text-sm font-medium text-tv-text-primary mb-3">
        {t("results.charts.climbProfile")}
      </h3>
      {points.length > 0 ? (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart
            data={points}
            margin={{ top: 5, right: 16, bottom: 16, left: 0 }}
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
              stroke={CHART_COLORS.AXIS}
              domain={["dataMin", "dataMax"]}
              tick={{ fontSize: 11, fill: CHART_COLORS.AXIS }}
              label={{
                value: t("results.charts.elevationUnit"),
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
            <Line
              dataKey="elevation"
              name={t("results.charts.climbProfile")}
              stroke={TRAJECTORY_COLORS.PATH}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
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
