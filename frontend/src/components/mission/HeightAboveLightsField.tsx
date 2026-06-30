import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { InspectionConfigOverride } from "@/types/mission";
import InfoHint from "@/components/common/InfoHint";

interface HeightAboveLightsFieldProps {
  heightAboveLights: number | "";
  onNumberChange: (field: keyof InspectionConfigOverride, raw: string) => void;
  hintTestId: string;
}

/** shared height-above-lights number field for the fly-over / parallel-side-sweep forms. */
export default function HeightAboveLightsField({
  heightAboveLights,
  onNumberChange,
  hintTestId,
}: HeightAboveLightsFieldProps) {
  const { t } = useTranslation();
  const heightId = useId();
  return (
    <div>
      <label
        htmlFor={heightId}
        className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
      >
        <span>{t("mission.config.heightAboveLights")}</span>
        <InfoHint
          text={t("mission.config.heightAboveLightsHelp")}
          label={t("mission.config.heightAboveLights")}
          testId={hintTestId}
        />
      </label>
      <input
        id={heightId}
        type="number"
        step="0.5"
        min="0"
        value={heightAboveLights}
        onChange={(e) => onNumberChange("height_above_lights", e.target.value)}
        placeholder={t("mission.config.heightAboveLightsHint")}
        className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
        data-testid="inspection-height-above-lights"
      />
    </div>
  );
}
