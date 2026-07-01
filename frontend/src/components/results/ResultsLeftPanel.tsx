import { useTranslation } from "react-i18next";
import { Check, Minus, X } from "lucide-react";
import type { InspectionResponse } from "@/types/mission";
import type { InspectionTemplateResponse } from "@/types/inspectionTemplate";
import type {
  LightSummary,
  MeasurementListItem,
  MeasurementResults,
} from "@/types/measurement";
import {
  INSPECTION_LIGHT_COLORS,
  INSPECTION_LIGHT_FALLBACK_COLOR,
} from "@/constants/palette";
import InspectionPicker from "./InspectionPicker";
import InspectionInfoPanel from "./InspectionInfoPanel";
import GlideSlopeToleranceCard from "./GlideSlopeToleranceCard";
import { computeGlidePathAngle } from "./resultsStats";
import { transitionVerdict } from "./TransitionAngleTable";

export type OverallVerdict = "pass" | "fail" | "pending";

/** PASS unless a scored light failed; pending when nothing is scored yet. */
export function overallVerdict(summaries: LightSummary[]): OverallVerdict {
  const scored = summaries.filter((s) => s.passed !== null);
  if (scored.length === 0) return "pending";
  return scored.some((s) => s.passed === false) ? "fail" : "pass";
}

const CARD_CLASS = "bg-tv-surface border border-tv-border rounded-2xl p-4";

interface ResultsLeftPanelProps {
  inspections: InspectionResponse[];
  templates: Map<string, InspectionTemplateResponse>;
  measurementByInspection: Map<string, MeasurementListItem>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onReview: (inspectionId: string) => void;
  // selected inspection's loaded results + run row, null until one is picked
  results: MeasurementResults | null;
  currentRow: MeasurementListItem | null;
}

/** results left panel - inspection picker, inspection info, and per-LHA verdict. */
export default function ResultsLeftPanel({
  inspections,
  templates,
  measurementByInspection,
  selectedId,
  onSelect,
  onReview,
  results,
  currentRow,
}: ResultsLeftPanelProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className={CARD_CLASS}>
        <InspectionPicker
          inspections={inspections}
          templates={templates}
          measurementByInspection={measurementByInspection}
          selectedId={selectedId}
          onSelect={onSelect}
          onReview={onReview}
        />
      </div>

      {results && (
        <div className={CARD_CLASS}>
          <InspectionInfoPanel
            results={results}
            createdAt={currentRow?.created_at ?? null}
            verdict={overallVerdict(results.summaries)}
            glidePathAngle={computeGlidePathAngle(results.lights)}
          />
        </div>
      )}

      {results && (
        <div className={CARD_CLASS}>
          <GlideSlopeToleranceCard
            measured={results.measured_glide_slope_angle}
            configured={results.configured_glide_slope_angle}
            tolerance={results.glide_slope_angle_tolerance}
            withinTolerance={results.glide_slope_within_tolerance}
          />
        </div>
      )}

      {results && (
        <div className={CARD_CLASS} data-testid="results-per-lha">
          <h2 className="text-sm font-semibold text-tv-text-primary mb-3">
            {t("results.perLha.title")}
          </h2>
          {results.lights.length === 0 ? (
            <p className="text-sm text-tv-text-muted">
              {t("results.perLha.empty")}
            </p>
          ) : (
            <ul className="space-y-2">
              {results.lights.map((light) => {
                const summary = results.summaries.find(
                  (s) => s.light_name === light.light_name,
                );
                return (
                  <PerLhaRow
                    key={light.light_name}
                    name={light.light_name}
                    summary={summary ?? null}
                  />
                );
              })}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

function PerLhaRow({
  name,
  summary,
}: {
  name: string;
  summary: LightSummary | null;
}) {
  /** one per-light row - colour dot, measured / nominal angle, and pass icon. */
  const verdict = transitionVerdict(
    summary?.measured_transition_angle ?? null,
    summary?.setting_angle ?? null,
    summary?.tolerance ?? null,
  );
  const measured =
    summary?.measured_transition_angle != null
      ? `${summary.measured_transition_angle.toFixed(2)}°`
      : "—";
  const nominal =
    summary?.setting_angle != null && summary?.tolerance != null
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
