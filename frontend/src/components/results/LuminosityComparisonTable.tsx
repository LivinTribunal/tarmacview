import { useTranslation } from "react-i18next";
import type { LightSeries } from "@/types/measurement";
import { seriesStats } from "./resultsStats";

function num(value: number): string {
  return value.toFixed(1);
}

/** per-light measured-intensity min/max/avg/range. */
export default function LuminosityComparisonTable({
  lights,
}: {
  lights: LightSeries[];
}) {
  const { t } = useTranslation();
  const rows = lights.map((l) => ({
    name: l.light_name,
    stats: seriesStats(l.points.map((p) => p.intensity)),
  }));
  const hasData = rows.some((r) => r.stats !== null);

  return (
    <>
      <h3 className="text-sm font-medium text-tv-text-primary mb-3">
        {t("results.luminosityCompare.title")}
      </h3>
      {hasData ? (
        <table
          className="w-full text-sm"
          data-testid="luminosity-comparison-table"
        >
          <thead>
            <tr className="text-left text-tv-text-secondary border-b border-tv-border">
              <th className="py-2 pr-3 font-medium">
                {t("results.table.light")}
              </th>
              <th className="py-2 pr-3 font-medium">{t("results.stats.min")}</th>
              <th className="py-2 pr-3 font-medium">{t("results.stats.max")}</th>
              <th className="py-2 pr-3 font-medium">{t("results.stats.avg")}</th>
              <th className="py-2 font-medium">{t("results.stats.range")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.name}
                className="border-b border-tv-border last:border-0"
              >
                <td className="py-2 pr-3 text-tv-text-primary font-medium">
                  {r.name}
                </td>
                <td className="py-2 pr-3 text-tv-text-primary">
                  {r.stats ? num(r.stats.min) : "—"}
                </td>
                <td className="py-2 pr-3 text-tv-text-primary">
                  {r.stats ? num(r.stats.max) : "—"}
                </td>
                <td className="py-2 pr-3 text-tv-text-primary">
                  {r.stats ? num(r.stats.avg) : "—"}
                </td>
                <td className="py-2 text-tv-text-primary">
                  {r.stats ? num(r.stats.range) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-tv-text-muted py-6 text-center">
          {t("results.luminosityCompare.empty")}
        </p>
      )}
    </>
  );
}
