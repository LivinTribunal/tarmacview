import { useTranslation } from "react-i18next";
import type { TransitionVerdict } from "./TransitionAngleTable";

// solid pill tones matching the transition-angle table verdict column
const VERDICT_CLASS: Record<TransitionVerdict, string> = {
  pass: "bg-[var(--tv-status-completed-bg)] text-[var(--tv-status-completed-text)]",
  fail: "bg-[var(--tv-status-cancelled-bg)] text-[var(--tv-status-cancelled-text)]",
  unknown: "bg-tv-surface-hover text-tv-text-muted",
};

/** pass/fail/unknown pill for a per-light chart header. */
export default function VerdictBadge({
  verdict,
}: {
  verdict: TransitionVerdict;
}) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${VERDICT_CLASS[verdict]}`}
      data-testid={`verdict-${verdict}`}
    >
      {t(`results.verdict.${verdict}`)}
    </span>
  );
}
