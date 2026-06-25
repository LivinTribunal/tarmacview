import type { LightSeries } from "@/types/measurement";
import StatsComparisonTable from "./StatsComparisonTable";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)} %`;
}

/** per-light red-chromaticity min/max/avg/range as percent. */
export default function ChromaticityComparisonTable({
  lights,
}: {
  lights: LightSeries[];
}) {
  return (
    <StatsComparisonTable
      lights={lights}
      select={(p) => p.chromaticity_x}
      format={pct}
      titleKey="results.chromaticityCompare.title"
      emptyKey="results.chromaticityCompare.empty"
      testId="chromaticity-comparison-table"
    />
  );
}
