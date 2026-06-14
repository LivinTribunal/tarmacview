import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { InspectionConfigOverride } from "@/types/mission";
import InfoHint from "@/components/common/InfoHint";

interface ParallelSideSweepFieldsProps {
  lateralOffset: number | "";
  heightAboveLights: number | "";
  onNumberChange: (field: keyof InspectionConfigOverride, raw: string) => void;
}

export default function ParallelSideSweepFields({
  lateralOffset,
  heightAboveLights,
  onNumberChange,
}: ParallelSideSweepFieldsProps) {
  /** parallel-side-sweep lateral offset + height fields. */
  const { t } = useTranslation();
  const lateralOffsetId = useId();
  const heightId = useId();
  return (
    <div
      className="grid grid-cols-2 gap-3"
      data-testid="parallel-side-sweep-fields"
    >
      <div>
        <label
          htmlFor={lateralOffsetId}
          className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
        >
          <span>{t("mission.config.lateralOffset")}</span>
          <InfoHint
            text={t("mission.config.lateralOffsetHelp")}
            label={t("mission.config.lateralOffset")}
            testId="hint-inspection-lateral-offset"
          />
        </label>
        <input
          id={lateralOffsetId}
          type="number"
          step="0.5"
          min="0"
          value={lateralOffset}
          onChange={(e) =>
            onNumberChange("lateral_offset", e.target.value)
          }
          placeholder={t("mission.config.lateralOffsetHint")}
          className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
          data-testid="inspection-lateral-offset"
        />
      </div>
      <div>
        <label
          htmlFor={heightId}
          className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
        >
          <span>{t("mission.config.heightAboveLights")}</span>
          <InfoHint
            text={t("mission.config.heightAboveLightsHelp")}
            label={t("mission.config.heightAboveLights")}
            testId="hint-inspection-pss-height-above-lights"
          />
        </label>
        <input
          id={heightId}
          type="number"
          step="0.5"
          min="0"
          value={heightAboveLights}
          onChange={(e) =>
            onNumberChange("height_above_lights", e.target.value)
          }
          placeholder={t("mission.config.heightAboveLightsHint")}
          className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
          data-testid="inspection-height-above-lights"
        />
      </div>
    </div>
  );
}
