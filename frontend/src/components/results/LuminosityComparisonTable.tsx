import type { LightSeries } from "@/types/measurement";
import StatsComparisonTable from "./StatsComparisonTable";

function num(value: number): string {
  return value.toFixed(1);
}

/** per-light measured-intensity min/max/avg/range. */
export default function LuminosityComparisonTable({
  lights,
}: {
  lights: LightSeries[];
}) {
  return (
    <StatsComparisonTable
      lights={lights}
      select={(p) => p.intensity}
      format={num}
      titleKey="results.luminosityCompare.title"
      emptyKey="results.luminosityCompare.empty"
      testId="luminosity-comparison-table"
    />
  );
}
