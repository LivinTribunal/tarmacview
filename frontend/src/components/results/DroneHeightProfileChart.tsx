import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "react-i18next";
import type { DronePathPoint, ReferencePoint } from "@/types/measurement";
import { CHART_COLORS, TRAJECTORY_COLORS } from "@/constants/palette";
import { lightColor } from "./chartColors";
import ChartShell from "./ChartShell";

// reference_points entry that anchors an altitude-difference series
interface DiffSource {
  name: string;
  elevation: number;
  isTouchPoint: boolean;
}

/** drone WGS84 elevation plus dashed altitude-difference series to each PAPI light + touch point. */
export default function DroneHeightProfileChart({
  dronePath,
  referencePoints,
}: {
  dronePath: DronePathPoint[];
  referencePoints: ReferencePoint[];
}) {
  const { t } = useTranslation();
  const elevPoints = dronePath.filter((p) => p.elevation !== null);

  const diffSources: DiffSource[] = referencePoints
    .filter((r) => r.elevation !== null)
    .map((r) => ({
      name: r.light_name,
      elevation: r.elevation,
      isTouchPoint: r.light_name === "TOUCH_POINT",
    }));

  const rows = elevPoints.map((p) => {
    const row: Record<string, number> = {
      timestamp: p.timestamp,
      elevation: p.elevation as number,
    };
    for (const src of diffSources) {
      row[`diff_${src.name}`] = (p.elevation as number) - src.elevation;
    }
    return row;
  });

  return (
    <ChartShell
      title={t("results.heightProfile.title")}
      explanation={t("results.heightProfile.explanation")}
      hasData={elevPoints.length > 0}
      height={280}
      testId="chart-height-profile"
    >
      <LineChart data={rows} margin={{ top: 5, right: 16, bottom: 24, left: 0 }}>
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
              yAxisId="elev"
              stroke={CHART_COLORS.AXIS}
              domain={["auto", "auto"]}
              tick={{ fontSize: 11, fill: CHART_COLORS.AXIS }}
              label={{
                value: t("results.heightProfile.elevationUnit"),
                angle: -90,
                position: "insideLeft",
                fontSize: 11,
                fill: CHART_COLORS.AXIS,
              }}
            />
            <YAxis
              yAxisId="diff"
              orientation="right"
              stroke={CHART_COLORS.AXIS}
              domain={["auto", "auto"]}
              tick={{ fontSize: 11, fill: CHART_COLORS.AXIS }}
              label={{
                value: t("results.heightProfile.diffUnit"),
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
            <Line
              yAxisId="elev"
              dataKey="elevation"
              name={t("results.heightProfile.droneElevation")}
              stroke={TRAJECTORY_COLORS.PATH}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            {diffSources.map((src) => (
              <Line
                key={src.name}
                yAxisId="diff"
                dataKey={`diff_${src.name}`}
                name={t("results.heightProfile.diffLight", {
                  light: src.isTouchPoint
                    ? t("results.heightProfile.touchPoint")
                    : src.name,
                })}
                stroke={lightColor(src.name)}
                strokeDasharray="6 4"
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            ))}
      </LineChart>
    </ChartShell>
  );
}
