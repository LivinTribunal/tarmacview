import { useTranslation } from "react-i18next";
import type { LightSeries, LightSeriesPoint } from "@/types/measurement";
import { seriesStats } from "./resultsStats";

/** per-light min/max/avg/range over a selected point field, formatted per caller. */
export default function StatsComparisonTable({
  lights,
  select,
  format,
  titleKey,
  emptyKey,
  testId,
}: {
  lights: LightSeries[];
  select: (point: LightSeriesPoint) => number | null;
  format: (value: number) => string;
  titleKey: string;
  emptyKey: string;
  testId: string;
}) {
  const { t } = useTranslation();
  const rows = lights.map((l) => ({
    name: l.light_name,
    stats: seriesStats(l.points.map(select)),
  }));
  const hasData = rows.some((r) => r.stats !== null);

  return (
    <>
      <h3 className="text-sm font-medium text-tv-text-primary mb-3">
        {t(titleKey)}
      </h3>
      {hasData ? (
        <table className="w-full text-sm" data-testid={testId}>
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
                  {r.stats ? format(r.stats.min) : "—"}
                </td>
                <td className="py-2 pr-3 text-tv-text-primary">
                  {r.stats ? format(r.stats.max) : "—"}
                </td>
                <td className="py-2 pr-3 text-tv-text-primary">
                  {r.stats ? format(r.stats.avg) : "—"}
                </td>
                <td className="py-2 text-tv-text-primary">
                  {r.stats ? format(r.stats.range) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-tv-text-muted py-6 text-center">
          {t(emptyKey)}
        </p>
      )}
    </>
  );
}
