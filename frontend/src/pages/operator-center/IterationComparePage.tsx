import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { compareIterations, getMeasurementResults } from "@/api/measurements";
import type { IterationCompare, LightComparison } from "@/types/measurement";
import Card from "@/components/common/Card";
import IterationOverlayChart from "@/components/results/IterationOverlayChart";

type Verdict = "pass" | "fail" | "unknown";

function verdictOf(passed: boolean | null): Verdict {
  if (passed === null) return "unknown";
  return passed ? "pass" : "fail";
}

// solid pill tones matching the transition-angle table
const VERDICT_CLASS: Record<Verdict, string> = {
  pass: "bg-[var(--tv-status-completed-bg)] text-[var(--tv-status-completed-text)]",
  fail: "bg-[var(--tv-status-cancelled-bg)] text-[var(--tv-status-cancelled-text)]",
  unknown: "bg-tv-surface-hover text-tv-text-muted",
};

function fmtAngle(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}°`;
}

function fmtDelta(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}°`;
}

/** N-way convergence compare for one iteration group: table + overlay charts + selector. */
export default function IterationComparePage() {
  const { t } = useTranslation();
  const { measurementId } = useParams<{ measurementId: string }>();

  const [data, setData] = useState<IterationCompare | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [activeLight, setActiveLight] = useState<string | null>(null);

  useEffect(() => {
    if (!measurementId) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    // resolve the group off the run's results, then fetch the whole group once
    getMeasurementResults(measurementId)
      .then((results) => {
        const groupId = results.iteration_group_id ?? results.id;
        return compareIterations(groupId);
      })
      .then((compare) => {
        if (cancelled) return;
        setData(compare);
        setSelected(
          new Set(
            compare.iterations
              .map((it) => it.iteration_index)
              .filter((i): i is number => i !== null),
          ),
        );
        setActiveLight(compare.lights[0]?.light_name ?? null);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [measurementId]);

  const selectedIterations = useMemo(
    () =>
      (data?.iterations ?? []).filter(
        (it) => it.iteration_index !== null && selected.has(it.iteration_index),
      ),
    [data, selected],
  );

  function toggleIteration(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  // a cell is shown only when its iteration is selected
  function selectedCells(light: LightComparison) {
    return light.cells.filter(
      (c) => c.iteration_index !== null && selected.has(c.iteration_index),
    );
  }

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-64 text-tv-text-muted"
        data-testid="compare-loading"
      >
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 text-sm text-tv-error" data-testid="compare-error">
        {t("iterationCompare.loadError")}
      </div>
    );
  }

  const activeComparison = data.lights.find((l) => l.light_name === activeLight) ?? null;
  const activeSeries = activeComparison
    ? activeComparison.series.filter(
        (s) => s.iteration_index !== null && selected.has(s.iteration_index),
      )
    : [];

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-y-auto" data-testid="iteration-compare-page">
      {/* iteration selector */}
      <Card>
        <h3 className="text-sm font-medium text-tv-text-primary mb-3">
          {t("iterationCompare.selectIterations")}
        </h3>
        <div className="flex flex-wrap gap-2" data-testid="iteration-selector">
          {data.iterations.map((it) => {
            const index = it.iteration_index;
            const active = index !== null && selected.has(index);
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => index !== null && toggleIteration(index)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-tv-nav-active-bg text-tv-nav-active-text"
                    : "bg-tv-surface-hover text-tv-text-secondary"
                }`}
                data-testid={`iteration-pill-${index}`}
              >
                {it.label || t("iterationCompare.iterationN", { index })}
              </button>
            );
          })}
        </div>
      </Card>

      {/* convergence table */}
      <Card>
        <h3 className="text-sm font-medium text-tv-text-primary mb-3">
          {t("iterationCompare.title")}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="convergence-table">
            <thead>
              <tr className="text-left text-tv-text-secondary border-b border-tv-border">
                <th className="py-2 pr-3 font-medium">{t("iterationCompare.table.light")}</th>
                <th className="py-2 pr-3 font-medium">
                  {t("iterationCompare.table.setpoint")}
                </th>
                <th className="py-2 pr-3 font-medium">
                  {t("iterationCompare.table.tolerance")}
                </th>
                {selectedIterations.map((it) => (
                  <th key={it.id} className="py-2 pr-3 font-medium">
                    {it.label || t("iterationCompare.iterationN", { index: it.iteration_index })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.lights.map((light) => (
                <tr
                  key={light.light_name}
                  className="border-b border-tv-border last:border-0 align-top"
                  data-testid={`compare-row-${light.light_name}`}
                >
                  <td className="py-2 pr-3 text-tv-text-primary font-medium">
                    {light.light_name}
                  </td>
                  <td className="py-2 pr-3 text-tv-text-primary">
                    {fmtAngle(light.setting_angle)}
                  </td>
                  <td className="py-2 pr-3 text-tv-text-primary">
                    {fmtAngle(light.tolerance)}
                  </td>
                  {selectedCells(light).map((cell) => {
                    const verdict = verdictOf(cell.passed);
                    return (
                      <td
                        key={cell.iteration_index}
                        className="py-2 pr-3"
                        data-testid={`compare-cell-${light.light_name}-${cell.iteration_index}`}
                      >
                        <div className="flex flex-col gap-1">
                          <span className="text-tv-text-primary">
                            {fmtAngle(cell.measured_transition_angle)}
                          </span>
                          <span className="text-xs text-tv-text-secondary">
                            {fmtDelta(cell.delta_from_setpoint)}
                          </span>
                          <span className="flex items-center gap-1">
                            <span
                              className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${VERDICT_CLASS[verdict]}`}
                            >
                              {t(`results.verdict.${verdict}`)}
                            </span>
                            {cell.verdict_changed_to_pass && (
                              <span
                                className="text-xs font-semibold text-[var(--tv-status-completed-text)]"
                                data-testid={`fail-to-pass-${light.light_name}-${cell.iteration_index}`}
                              >
                                {t("iterationCompare.failToPass")}
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* overlaid per-light charts */}
      <Card>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-medium text-tv-text-primary">
            {t("iterationCompare.lightPicker")}
          </h3>
          <div className="flex flex-wrap gap-2" data-testid="light-picker">
            {data.lights.map((light) => (
              <button
                key={light.light_name}
                type="button"
                onClick={() => setActiveLight(light.light_name)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  activeLight === light.light_name
                    ? "bg-tv-nav-active-bg text-tv-nav-active-text"
                    : "bg-tv-surface-hover text-tv-text-secondary"
                }`}
                data-testid={`light-pick-${light.light_name}`}
              >
                {light.light_name}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <IterationOverlayChart
            title={t("iterationCompare.charts.angle")}
            series={activeSeries}
            field="angle"
            yLabel={t("results.charts.angleUnit")}
          />
          <IterationOverlayChart
            title={t("iterationCompare.charts.intensity")}
            series={activeSeries}
            field="intensity"
            yLabel={t("results.charts.intensityUnit")}
          />
          <IterationOverlayChart
            title={t("iterationCompare.charts.chromaticity")}
            series={activeSeries}
            field="chromaticity_x"
            yLabel={t("results.charts.chromaticityUnit")}
          />
        </div>
      </Card>
    </div>
  );
}
