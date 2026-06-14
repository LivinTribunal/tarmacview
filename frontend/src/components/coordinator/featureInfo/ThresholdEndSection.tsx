import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Repeat } from "lucide-react";
import InfoHint from "@/components/common/InfoHint";
import type { PointZ } from "@/types/common";
import { distanceFromCenterline } from "@/utils/geo";
import PositionBlock from "./PositionBlock";

export default function ThresholdEndSection({
  data,
  onUpdate,
  centerline,
  pickingThreshold,
  onPickThresholdToggle,
  pickingEnd,
  onPickEndToggle,
}: {
  data: Record<string, unknown>;
  onUpdate: (data: Record<string, unknown>) => void;
  centerline?: number[][];
  pickingThreshold?: boolean;
  onPickThresholdToggle?: () => void;
  pickingEnd?: boolean;
  onPickEndToggle?: () => void;
}) {
  /** threshold and end position editors for a runway surface. */
  const { t } = useTranslation();
  const thrPos = data.threshold_position as PointZ | null | undefined;
  const endPos = data.end_position as PointZ | null | undefined;

  const thrDist = useMemo(() => {
    if (!thrPos?.coordinates || !centerline || centerline.length < 2) return null;
    return distanceFromCenterline(
      [thrPos.coordinates[0], thrPos.coordinates[1]],
      centerline,
    );
  }, [thrPos, centerline]);

  const endDist = useMemo(() => {
    if (!endPos?.coordinates || !centerline || centerline.length < 2) return null;
    return distanceFromCenterline(
      [endPos.coordinates[0], endPos.coordinates[1]],
      centerline,
    );
  }, [endPos, centerline]);

  const canSwap = Boolean(thrPos) && Boolean(endPos);

  function handleSwap() {
    /** swap threshold and end positions via a single staged patch. */
    if (!canSwap) return;
    onUpdate({ threshold_position: endPos ?? null, end_position: thrPos ?? null });
  }

  return (
    <div
      className="mt-1 rounded-lg border border-tv-border bg-tv-bg p-2 space-y-1.5"
      data-testid="surface-threshold-end-section"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <p className="text-[10px] font-semibold text-tv-text-secondary uppercase tracking-wide">
            {t("coordinator.detail.thresholdEnd")}
          </p>
          <InfoHint
            text={t("coordinator.detail.thresholdEndHelp")}
            label={t("coordinator.detail.thresholdEnd")}
            testId="hint-feat-threshold-end"
          />
        </div>
        <button
          type="button"
          onClick={handleSwap}
          disabled={!canSwap}
          title={t("coordinator.detail.swapThresholdEndHelp")}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
            canSwap
              ? "border-tv-accent text-tv-accent hover:bg-tv-accent hover:text-tv-accent-text"
              : "border-tv-border text-tv-text-muted cursor-not-allowed"
          }`}
          data-testid="feature-threshold-end-swap"
        >
          <Repeat className="h-3 w-3" />
          {t("coordinator.detail.swapThresholdEnd")}
        </button>
      </div>
      <PositionBlock
        id="threshold"
        label={t("coordinator.creation.thresholdLabel")}
        position={thrPos ?? null}
        picking={pickingThreshold}
        onPickToggle={onPickThresholdToggle}
        centerlineWarningDist={thrDist}
        nested
        onChange={(pos) => {
          onUpdate({ threshold_position: pos });
        }}
      />
      <PositionBlock
        id="end-position"
        label={t("coordinator.creation.endpointLabel")}
        position={endPos ?? null}
        picking={pickingEnd}
        onPickToggle={onPickEndToggle}
        centerlineWarningDist={endDist}
        nested
        onChange={(pos) => {
          onUpdate({ end_position: pos });
        }}
      />
    </div>
  );
}
