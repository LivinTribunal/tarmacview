import { useTranslation } from "react-i18next";
import type { DeviceEvaluationRow } from "@/types/measurement";
import EvaluationPill from "./EvaluationPill";

/** mission-level evaluation table - one row per device (result / restrictions / recs). */
export default function MissionEvaluationTable({
  evaluation,
}: {
  evaluation: DeviceEvaluationRow[];
}) {
  const { t } = useTranslation();

  if (evaluation.length === 0) {
    return (
      <p className="text-sm text-tv-text-muted py-6 text-center">
        {t("results.overview.evaluation.empty")}
      </p>
    );
  }

  return (
    <table className="w-full text-sm" data-testid="mission-evaluation-table">
      <thead>
        <tr className="text-left text-tv-text-secondary border-b border-tv-border">
          <th className="py-2 pr-3 font-medium">
            {t("results.overview.evaluation.device")}
          </th>
          <th className="py-2 pr-3 font-medium">
            {t("results.overview.evaluation.result")}
          </th>
          <th className="py-2 pr-3 font-medium">
            {t("results.overview.evaluation.restrictions")}
          </th>
          <th className="py-2 font-medium">
            {t("results.overview.evaluation.recommendations")}
          </th>
        </tr>
      </thead>
      <tbody>
        {evaluation.map((row, idx) => (
          <tr
            key={`${row.device_label}-${idx}`}
            className="border-b border-tv-border last:border-0"
          >
            <td className="py-2 pr-3 text-tv-text-primary font-medium">
              {row.device_label}
            </td>
            <td className="py-2 pr-3">
              <EvaluationPill result={row.result} />
            </td>
            <td className="py-2 pr-3 text-tv-text-muted">
              {row.restrictions ?? "—"}
            </td>
            <td className="py-2 text-tv-text-muted">
              {row.recommendations ?? "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
