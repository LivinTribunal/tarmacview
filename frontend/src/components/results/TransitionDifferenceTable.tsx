import { useTranslation } from "react-i18next";
import type { LightSeries } from "@/types/measurement";
import { type TransitionVerdict } from "./TransitionAngleTable";
import VerdictBadge from "./VerdictBadge";

function fmtDeg(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}°`;
}

// passed is a tri-state boolean - null means the light was unscoreable
function verdictOf(passed: boolean | null): TransitionVerdict {
  if (passed === null) return "unknown";
  return passed ? "pass" : "fail";
}

// difference helper - null when either operand is missing
function diff(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
}

/** per-light transition-angle start/middle/end + width/nominal/correction + pairwise diffs. */
export default function TransitionDifferenceTable({
  lights,
}: {
  lights: LightSeries[];
}) {
  const { t } = useTranslation();

  if (lights.length === 0) {
    return (
      <>
        <h3 className="text-sm font-medium text-tv-text-primary mb-3">
          {t("results.transitionDiff.title")}
        </h3>
        <p className="text-sm text-tv-text-muted py-6 text-center">
          {t("results.transitionDiff.empty")}
        </p>
      </>
    );
  }

  return (
    <>
      <h3 className="text-sm font-medium text-tv-text-primary mb-3">
        {t("results.transitionDiff.title")}
      </h3>
      <table className="w-full text-sm" data-testid="transition-difference-table">
        <thead>
          <tr className="text-left text-tv-text-secondary border-b border-tv-border">
            <th className="py-2 pr-3 font-medium">{t("results.table.light")}</th>
            <th className="py-2 pr-3 font-medium">
              {t("results.transitionDiff.start")}
            </th>
            <th className="py-2 pr-3 font-medium">
              {t("results.transitionDiff.middle")}
            </th>
            <th className="py-2 pr-3 font-medium">
              {t("results.transitionDiff.vsTouchPoint")}
            </th>
            <th className="py-2 pr-3 font-medium">
              {t("results.transitionDiff.end")}
            </th>
            <th className="py-2 pr-3 font-medium">
              {t("results.transitionDiff.width")}
            </th>
            <th className="py-2 pr-3 font-medium">
              {t("results.transitionDiff.nominal")}
            </th>
            <th className="py-2 pr-3 font-medium">
              {t("results.transitionDiff.correction")}
            </th>
            <th className="py-2 font-medium">
              {t("results.transitionDiff.result")}
            </th>
          </tr>
        </thead>
        <tbody>
          {lights.map((l) => {
            const verdict = verdictOf(l.passed);
            return (
              <tr
                key={l.light_name}
                className="border-b border-tv-border last:border-0"
              >
                <td className="py-2 pr-3 text-tv-text-primary font-medium">
                  {l.light_name}
                </td>
                <td className="py-2 pr-3 text-tv-text-primary">
                  {fmtDeg(l.transition_angle_min)}
                </td>
                <td className="py-2 pr-3 text-tv-text-primary">
                  {fmtDeg(l.transition_angle_middle)}
                </td>
                <td className="py-2 pr-3 text-tv-text-primary">
                  {fmtDeg(l.transition_angle_middle_touchpoint)}
                </td>
                <td className="py-2 pr-3 text-tv-text-primary">
                  {fmtDeg(l.transition_angle_max)}
                </td>
                <td className="py-2 pr-3 text-tv-text-primary">
                  {fmtDeg(diff(l.transition_angle_max, l.transition_angle_min))}
                </td>
                <td className="py-2 pr-3 text-tv-text-primary">
                  {fmtDeg(l.setting_angle)}
                </td>
                <td className="py-2 pr-3 text-tv-text-primary">
                  {fmtDeg(diff(l.transition_angle_middle, l.setting_angle))}
                </td>
                <td className="py-2">
                  <VerdictBadge verdict={verdict} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {lights.length > 1 && (
        <div className="mt-4" data-testid="transition-pairwise">
          <h4 className="text-xs font-medium text-tv-text-secondary mb-2">
            {t("results.transitionDiff.pairwiseTitle")}
          </h4>
          <table className="w-full text-sm">
            <tbody>
              {lights.slice(0, -1).map((l, i) => {
                const next = lights[i + 1];
                const d = diff(
                  l.transition_angle_middle,
                  next.transition_angle_middle,
                );
                return (
                  <tr
                    key={`${l.light_name}-${next.light_name}`}
                    className="border-b border-tv-border last:border-0"
                  >
                    <td className="py-2 pr-3 text-tv-text-primary">
                      {t("results.transitionDiff.pairwiseLabel", {
                        from: l.light_name,
                        to: next.light_name,
                      })}
                    </td>
                    <td className="py-2 text-tv-text-primary">{fmtDeg(d)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
