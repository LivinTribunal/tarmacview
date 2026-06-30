import { useTranslation } from "react-i18next";
import { Check, Minus, X } from "lucide-react";
import type {
  LightSummary,
  MeasurementListItem,
  MeasurementResults,
} from "@/types/measurement";
import {
  INSPECTION_LIGHT_COLORS,
  INSPECTION_LIGHT_FALLBACK_COLOR,
} from "@/constants/palette";
import { formatDate } from "@/utils/format";
import MeasurementStatusChip from "./MeasurementStatusChip";
import { measurementDisplayName } from "./MeasurementListTable";
import { computeGlidePathAngle } from "./resultsStats";
import { transitionVerdict } from "./TransitionAngleTable";

const PAPI_NAMES = ["PAPI_A", "PAPI_B", "PAPI_C", "PAPI_D"] as const;

export type OverallVerdict = "pass" | "fail" | "pending";

/** PASS unless a scored light failed; pending when nothing is scored yet. */
export function overallVerdict(summaries: LightSummary[]): OverallVerdict {
  const scored = summaries.filter((s) => s.passed !== null);
  if (scored.length === 0) return "pending";
  return scored.some((s) => s.passed === false) ? "fail" : "pass";
}

/** nominal glide path = midpoint of PAPI_B upper transition and PAPI_C lower transition. */
// solid pill tones matching TransitionAngleTable / the measurement status tags
const OVERALL_CLASS: Record<OverallVerdict, string> = {
  pass: "bg-[var(--tv-status-completed-bg)] text-[var(--tv-status-completed-text)]",
  fail: "bg-[var(--tv-status-cancelled-bg)] text-[var(--tv-status-cancelled-text)]",
  pending: "bg-tv-surface-hover text-tv-text-muted",
};

const CARD_CLASS = "bg-tv-surface border border-tv-border rounded-2xl p-4";

interface ResultsLeftPanelProps {
  results: MeasurementResults;
  currentRow: MeasurementListItem | null;
  sections: ReadonlyArray<{ id: string; labelKey: string }>;
}

/** stacked summary / verdict / glide-path / section-nav cards for the results page. */
export default function ResultsLeftPanel({
  results,
  currentRow,
  sections,
}: ResultsLeftPanelProps) {
  const { t } = useTranslation();

  const verdict = overallVerdict(results.summaries);
  const glidePath = computeGlidePathAngle(results.lights);
  const summariesByName = new Map(results.summaries.map((s) => [s.light_name, s]));

  // the run's display name - prefer the list row (carries the non-null inspection
  // context measurementDisplayName needs), else the operator label
  const title = currentRow
    ? measurementDisplayName(currentRow, t)
    : results.label || t("results.summary.title");

  return (
    <>
      {/* measurement summary */}
      <div className={CARD_CLASS} data-testid="results-summary-card">
        <h2 className="text-sm font-semibold text-tv-text-primary mb-3">
          {title}
        </h2>
        <dl className="space-y-2 text-sm">
          <SummaryRow
            label={t("results.summary.method")}
            value={
              results.inspection_method
                ? t(
                    `map.inspectionMethod.${results.inspection_method}`,
                    results.inspection_method,
                  )
                : "—"
            }
          />
          <SummaryRow
            label={t("results.summary.sequence")}
            value={results.inspection_sequence_order ?? "—"}
          />
          <SummaryRow
            label={t("results.summary.runwayHeading")}
            value={
              results.runway_heading != null
                ? `${results.runway_heading.toFixed(0)}°`
                : "—"
            }
          />
          <div className="flex items-center justify-between gap-2">
            <dt className="text-tv-text-secondary">
              {t("measurementsList.columns.status")}
            </dt>
            <dd>
              <MeasurementStatusChip status={results.status} size="sm" />
            </dd>
          </div>
          <SummaryRow
            label={t("results.summary.processed")}
            value={currentRow?.created_at ? formatDate(currentRow.created_at) : "—"}
          />
        </dl>
      </div>

      {/* overall verdict */}
      <div className={CARD_CLASS} data-testid="results-overall-verdict">
        <h2 className="text-sm font-semibold text-tv-text-primary mb-3">
          {t("results.verdictRollup.title")}
        </h2>
        <span
          className={`inline-block rounded-md px-3 py-1 text-sm font-semibold ${OVERALL_CLASS[verdict]}`}
        >
          {t(`results.verdictRollup.${verdict}`)}
        </span>
      </div>

      {/* per-PAPI verdict list */}
      <div className={CARD_CLASS} data-testid="results-per-papi">
        <h2 className="text-sm font-semibold text-tv-text-primary mb-3">
          {t("results.perPapi.title")}
        </h2>
        {results.summaries.length === 0 ? (
          <p className="text-sm text-tv-text-muted">
            {t("results.perPapi.empty")}
          </p>
        ) : (
          <ul className="space-y-2">
            {PAPI_NAMES.map((name) => {
              const s = summariesByName.get(name);
              if (!s) return null;
              return <PerPapiRow key={name} name={name} summary={s} />;
            })}
          </ul>
        )}
      </div>

      {/* glide-path angle */}
      <div className={CARD_CLASS} data-testid="results-glide-path">
        <h2 className="text-sm font-semibold text-tv-text-primary mb-3">
          {t("results.glidePath.title")}
        </h2>
        <p className="text-lg font-semibold text-tv-text-primary">
          {glidePath !== null
            ? `${glidePath.toFixed(2)}°`
            : t("results.glidePath.unavailable")}
        </p>
      </div>

      {/* section navigation */}
      <div className={CARD_CLASS} data-testid="results-section-nav">
        <h2 className="text-sm font-semibold text-tv-text-primary mb-3">
          {t("results.sections.navTitle")}
        </h2>
        <nav className="flex flex-col gap-1">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() =>
                document
                  .getElementById(section.id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className="text-left text-sm text-tv-text-secondary hover:text-tv-text-primary transition-colors"
            >
              {t(section.labelKey)}
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}

function SummaryRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-tv-text-secondary">{label}</dt>
      <dd className="text-tv-text-primary font-medium">{value}</dd>
    </div>
  );
}

function PerPapiRow({ name, summary }: { name: string; summary: LightSummary }) {
  const verdict = transitionVerdict(
    summary.measured_transition_angle,
    summary.setting_angle,
    summary.tolerance,
  );
  const measured =
    summary.measured_transition_angle !== null
      ? `${summary.measured_transition_angle.toFixed(2)}°`
      : "—";
  const nominal =
    summary.setting_angle !== null && summary.tolerance !== null
      ? `${summary.setting_angle.toFixed(1)}±${summary.tolerance.toFixed(1)}°`
      : "—";
  const Icon = verdict === "pass" ? Check : verdict === "fail" ? X : Minus;
  const iconClass =
    verdict === "pass"
      ? "text-[var(--tv-status-completed-text)]"
      : verdict === "fail"
        ? "text-[var(--tv-status-cancelled-text)]"
        : "text-tv-text-muted";

  return (
    <li className="flex items-center gap-2 text-sm">
      <span
        className="h-2.5 w-2.5 rounded-full flex-shrink-0"
        style={{
          backgroundColor:
            INSPECTION_LIGHT_COLORS[name] ?? INSPECTION_LIGHT_FALLBACK_COLOR,
        }}
      />
      <span className="font-medium text-tv-text-primary">{name}</span>
      <span className="ml-auto text-tv-text-secondary">
        {measured} / {nominal}
      </span>
      <Icon className={`h-4 w-4 flex-shrink-0 ${iconClass}`} />
    </li>
  );
}
