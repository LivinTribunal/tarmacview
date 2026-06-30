import { useTranslation } from "react-i18next";
import { VERDICT_CLASS } from "./TransitionAngleTable";

interface GlideSlopeToleranceCardProps {
  measured: number | null;
  configured: number | null;
  tolerance: number | null;
  withinTolerance: boolean | null;
}

// reuse the per-light verdict tones (ok=pass, out=fail, unavailable=unknown)
const STATUS_CLASS: Record<"ok" | "out" | "unavailable", string> = {
  ok: VERDICT_CLASS.pass,
  out: VERDICT_CLASS.fail,
  unavailable: VERDICT_CLASS.unknown,
};

/** measured glidepath vs the configured glide slope ± tolerance, with an OK / out-of-tolerance pill. */
export default function GlideSlopeToleranceCard({
  measured,
  configured,
  tolerance,
  withinTolerance,
}: GlideSlopeToleranceCardProps) {
  const { t } = useTranslation();

  const measuredLabel = measured != null ? `${measured.toFixed(2)}°` : "—";
  const configuredLabel =
    configured != null && tolerance != null
      ? `${configured.toFixed(2)}±${tolerance.toFixed(2)}°`
      : "—";

  const status =
    withinTolerance === true ? "ok" : withinTolerance === false ? "out" : "unavailable";
  const statusText =
    status === "ok"
      ? t("results.glideSlopeTolerance.ok")
      : status === "out"
        ? t("results.glideSlopeTolerance.outOfTolerance")
        : t("results.glideSlopeTolerance.unavailable");

  return (
    <div data-testid="results-glide-slope-tolerance">
      <h2 className="text-sm font-semibold text-tv-text-primary mb-3">
        {t("results.glideSlopeTolerance.title")}
      </h2>
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 rounded-xl bg-tv-bg">
          <p className="text-xs text-tv-text-muted truncate">
            {t("results.glideSlopeTolerance.measured")}:
          </p>
          <p className="text-sm font-semibold text-tv-text-primary">{measuredLabel}</p>
        </div>
        <div className="p-2 rounded-xl bg-tv-bg">
          <p className="text-xs text-tv-text-muted truncate">
            {t("results.glideSlopeTolerance.configured")}:
          </p>
          <p className="text-sm font-semibold text-tv-text-primary">{configuredLabel}</p>
        </div>
        <div className={`col-span-2 p-2 rounded-xl ${STATUS_CLASS[status]}`}>
          <p className="text-sm font-semibold">{statusText}</p>
        </div>
      </div>
    </div>
  );
}
