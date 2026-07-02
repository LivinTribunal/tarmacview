import { useTranslation } from "react-i18next";
import type { DeviceEvaluation } from "@/types/measurement";

// solid PASS/FAIL tones matching the run status tags; pending/not-measured stay muted
// so a placeholder never reads as a real FAIL
export const EVALUATION_CLASS: Record<DeviceEvaluation, string> = {
  PASS: "bg-[var(--tv-status-completed-bg)] text-[var(--tv-status-completed-text)]",
  FAIL: "bg-[var(--tv-status-cancelled-bg)] text-[var(--tv-status-cancelled-text)]",
  PENDING: "bg-tv-surface-hover text-tv-text-muted",
  NOT_MEASURED: "bg-tv-surface-hover text-tv-text-muted",
};

/** device-evaluation pill (PASS/FAIL/PENDING/NOT_MEASURED). */
export default function EvaluationPill({
  result,
}: {
  result: DeviceEvaluation;
}) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${EVALUATION_CLASS[result]}`}
      data-testid={`evaluation-${result}`}
    >
      {t(`results.overview.evaluation.${result}`)}
    </span>
  );
}
