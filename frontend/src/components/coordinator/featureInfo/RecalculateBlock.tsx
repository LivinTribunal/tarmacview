import { useTranslation } from "react-i18next";
import { Calculator } from "lucide-react";
import type {
  SurfaceRecalculateResponse,
  ObstacleRecalculateResponse,
} from "@/types/airport";

export type RecalcPreview =
  | { kind: "surface"; data: SurfaceRecalculateResponse }
  | { kind: "obstacle"; data: ObstacleRecalculateResponse };

function fmtDim(v: number | null | undefined, unit: string) {
  /** format a dimension number with unit, dash if missing. */
  if (v == null) return "—";
  return `${v.toFixed(2)}${unit}`;
}

export default function RecalculateBlock({
  loading,
  error,
  preview,
  onRecalculate,
  onApply,
  onCancel,
}: {
  loading: boolean;
  error: string | null;
  preview: RecalcPreview | null;
  onRecalculate: () => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  /** recalculate dimensions button + side-by-side preview. */
  const { t } = useTranslation();

  if (preview) {
    const { current, recalculated } = preview.data;
    const m = t("common.units.m");
    return (
      <div
        className="mt-2 rounded-lg border border-tv-border bg-tv-bg p-2 space-y-1.5"
        data-testid="recalculate-preview"
      >
        <div className="grid grid-cols-3 gap-1 text-[10px] text-tv-text-muted">
          <span></span>
          <span className="text-right">{t("coordinator.detail.currentValues")}</span>
          <span className="text-right">{t("coordinator.detail.recalculatedValues")}</span>
        </div>
        <div className="grid grid-cols-3 gap-1 text-xs">
          <span className="text-tv-text-muted">{t("coordinator.detail.surfaceLength")}</span>
          <span className="text-right text-tv-text-secondary">{fmtDim(current.length, m)}</span>
          <span className="text-right text-tv-text-primary font-medium">
            {fmtDim(recalculated.length, m)}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1 text-xs">
          <span className="text-tv-text-muted">{t("coordinator.detail.surfaceWidth")}</span>
          <span className="text-right text-tv-text-secondary">{fmtDim(current.width, m)}</span>
          <span className="text-right text-tv-text-primary font-medium">
            {fmtDim(recalculated.width, m)}
          </span>
        </div>
        {preview.kind === "surface" && (
          <div className="grid grid-cols-3 gap-1 text-xs">
            <span className="text-tv-text-muted">{t("coordinator.detail.surfaceHeading")}</span>
            <span className="text-right text-tv-text-secondary">
              {fmtDim(preview.data.current.heading, "°")}
            </span>
            <span className="text-right text-tv-text-primary font-medium">
              {fmtDim(preview.data.recalculated.heading, "°")}
            </span>
          </div>
        )}
        <div className="flex gap-1.5 pt-1">
          {preview.kind === "surface" ? (
            <>
              <button
                type="button"
                onClick={onApply}
                className="flex-1 rounded-full px-3 py-1.5 text-xs font-semibold border border-tv-accent text-tv-accent hover:bg-tv-surface-hover transition-colors"
                data-testid="recalculate-apply"
              >
                {t("coordinator.detail.applyRecalculated")}
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 rounded-full px-3 py-1.5 text-xs font-semibold border border-tv-border text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
                data-testid="recalculate-cancel"
              >
                {t("coordinator.detail.cancelRecalculated")}
              </button>
            </>
          ) : (
            // obstacle preview is informational only - no writable dimension columns
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-full px-3 py-1.5 text-xs font-semibold border border-tv-border text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
              data-testid="recalculate-close"
            >
              {t("common.close")}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={onRecalculate}
        disabled={loading}
        title={t("coordinator.detail.recalculateDescription")}
        className="flex items-center justify-center gap-1.5 w-full mt-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-tv-border text-tv-text-primary hover:bg-tv-surface-hover transition-colors disabled:opacity-50"
        data-testid="recalculate-button"
      >
        <Calculator className="h-3 w-3" />
        {t("coordinator.detail.recalculate")}
      </button>
      {error && <p className="text-[10px] text-tv-error pl-1">{error}</p>}
    </div>
  );
}
