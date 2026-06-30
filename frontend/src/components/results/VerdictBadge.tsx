import { useTranslation } from "react-i18next";
import { VERDICT_CLASS } from "./TransitionAngleTable";
import type { TransitionVerdict } from "./TransitionAngleTable";

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
