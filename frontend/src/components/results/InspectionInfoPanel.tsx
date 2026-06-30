import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type { MeasurementResults } from "@/types/measurement";
import { formatDate } from "@/utils/format";
import MeasurementStatusChip from "./MeasurementStatusChip";
import type { OverallVerdict } from "./ResultsLeftPanel";

// solid pill tones matching the per-light verdict + measurement status tags
const OVERALL_CLASS: Record<OverallVerdict, string> = {
  pass: "bg-[var(--tv-status-completed-bg)] text-[var(--tv-status-completed-text)]",
  fail: "bg-[var(--tv-status-cancelled-bg)] text-[var(--tv-status-cancelled-text)]",
  pending: "bg-tv-surface-hover text-tv-text-muted",
};

interface InspectionInfoPanelProps {
  results: MeasurementResults;
  // selected run's processed timestamp
  createdAt: string | null;
  verdict: OverallVerdict;
  glidePathAngle: number | null;
}

/** read-only inspection summary collapsible card with overall verdict and glide path. */
export default function InspectionInfoPanel({
  results,
  createdAt,
  verdict,
  glidePathAngle,
}: InspectionInfoPanelProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div data-testid="results-inspection-info">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-between w-full text-sm font-semibold text-tv-text-primary"
      >
        <span className="rounded-full px-3 py-1 bg-tv-bg border border-tv-border">
          {t("results.inspectionInfo")}
        </span>
        <ChevronDown
          className={`h-4 w-4 transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`}
        />
      </button>
      {!collapsed && <div className="border-b border-tv-border -mx-4 mt-3" />}

      {!collapsed && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <InfoCell
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
          <InfoCell
            label={t("results.summary.sequence")}
            value={
              results.inspection_sequence_order != null
                ? String(results.inspection_sequence_order)
                : "—"
            }
          />
          <InfoCell
            label={t("results.summary.runwayHeading")}
            value={
              results.runway_heading != null
                ? `${results.runway_heading.toFixed(0)}°`
                : "—"
            }
          />
          <InfoCell
            label={t("results.summary.processed")}
            value={createdAt ? formatDate(createdAt) : "—"}
          />
          <div className="p-2 rounded-xl bg-tv-bg">
            <p className="text-xs text-tv-text-muted truncate">
              {t("measurementsList.columns.status")}:
            </p>
            <MeasurementStatusChip status={results.status} size="sm" />
          </div>
          <div className={`p-2 rounded-xl ${OVERALL_CLASS[verdict]}`}>
            <p className="text-xs opacity-75 truncate">
              {t("results.verdictRollup.title")}:
            </p>
            <p className="text-sm font-semibold">
              {t(`results.verdictRollup.${verdict}`)}
            </p>
          </div>
          <div className="col-span-2 p-2 rounded-xl bg-tv-bg">
            <p className="text-xs text-tv-text-muted truncate">
              {t("results.glidePath.title")}:
            </p>
            <p className="text-sm font-semibold text-tv-text-primary">
              {glidePathAngle !== null
                ? `${glidePathAngle.toFixed(2)}°`
                : t("results.glidePath.unavailable")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  /** single cell in the two-column grid. */
  return (
    <div className="p-2 rounded-xl bg-tv-bg">
      <p className="text-xs text-tv-text-muted truncate">{label}:</p>
      <p className="text-sm font-semibold text-tv-text-primary">{value}</p>
    </div>
  );
}
