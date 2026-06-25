import { useTranslation } from "react-i18next";
import type { LightSummary } from "@/types/measurement";

export type TransitionVerdict = "pass" | "fail" | "unknown";

/** PASS/FAIL of a measured transition angle vs setting_angle +/- tolerance.
 *
 * unknown when any of measured / setting / tolerance is missing - an absent
 * ground truth is not a failure, it's an unscoreable light.
 */
export function transitionVerdict(
  measured: number | null,
  setting: number | null,
  tolerance: number | null,
): TransitionVerdict {
  if (measured === null || setting === null || tolerance === null) {
    return "unknown";
  }
  return Math.abs(measured - setting) <= tolerance ? "pass" : "fail";
}

function fmt(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}°`;
}

// solid pill tones matching the measurement status tags (DONE/ERROR), not faint tints
export const VERDICT_CLASS: Record<TransitionVerdict, string> = {
  pass: "bg-[var(--tv-status-completed-bg)] text-[var(--tv-status-completed-text)]",
  fail: "bg-[var(--tv-status-cancelled-bg)] text-[var(--tv-status-cancelled-text)]",
  unknown: "bg-tv-surface-hover text-tv-text-muted",
};

/** per-light transition-angle table with a PASS/FAIL verdict column. */
export default function TransitionAngleTable({
  summaries,
}: {
  summaries: LightSummary[];
}) {
  const { t } = useTranslation();

  if (summaries.length === 0) {
    return (
      <p className="text-sm text-tv-text-muted py-6 text-center">
        {t("results.table.empty")}
      </p>
    );
  }

  return (
    <table className="w-full text-sm" data-testid="transition-angle-table">
      <thead>
        <tr className="text-left text-tv-text-secondary border-b border-tv-border">
          <th className="py-2 pr-3 font-medium">{t("results.table.light")}</th>
          <th className="py-2 pr-3 font-medium">{t("results.table.setting")}</th>
          <th className="py-2 pr-3 font-medium">
            {t("results.table.tolerance")}
          </th>
          <th className="py-2 pr-3 font-medium">
            {t("results.table.measured")}
          </th>
          <th className="py-2 font-medium">{t("results.table.result")}</th>
        </tr>
      </thead>
      <tbody>
        {summaries.map((s) => {
          const verdict = transitionVerdict(
            s.measured_transition_angle,
            s.setting_angle,
            s.tolerance,
          );
          return (
            <tr
              key={s.light_name}
              className="border-b border-tv-border last:border-0"
            >
              <td className="py-2 pr-3 text-tv-text-primary font-medium">
                {s.light_name}
              </td>
              <td className="py-2 pr-3 text-tv-text-primary">
                {fmt(s.setting_angle)}
              </td>
              <td className="py-2 pr-3 text-tv-text-primary">
                {fmt(s.tolerance)}
              </td>
              <td className="py-2 pr-3 text-tv-text-primary">
                {fmt(s.measured_transition_angle)}
              </td>
              <td className="py-2">
                <span
                  className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${VERDICT_CLASS[verdict]}`}
                >
                  {t(`results.verdict.${verdict}`)}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
