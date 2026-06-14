import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { InspectionConfigOverride } from "@/types/mission";
import InfoHint from "@/components/common/InfoHint";

interface ApproachDescentFieldsProps {
  descentStartDistance: number | "";
  descentGlideSlopeOverride: number | "";
  onNumberChange: (field: keyof InspectionConfigOverride, raw: string) => void;
}

export default function ApproachDescentFields({
  descentStartDistance,
  descentGlideSlopeOverride,
  onNumberChange,
}: ApproachDescentFieldsProps) {
  /** approach-descent start distance + glide-slope override fields. */
  const { t } = useTranslation();
  const startDistanceId = useId();
  const glideSlopeId = useId();
  return (
    <div className="grid grid-cols-2 gap-3" data-testid="approach-descent-fields">
      <div>
        <label
          htmlFor={startDistanceId}
          className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
        >
          <span>{t("mission.config.descentStartDistance")}</span>
          <InfoHint
            text={t("mission.config.descentStartDistanceHelp")}
            label={t("mission.config.descentStartDistance")}
            testId="hint-inspection-descent-start-distance"
          />
        </label>
        <input
          id={startDistanceId}
          type="number"
          step="50"
          min="1"
          value={descentStartDistance}
          onChange={(e) =>
            onNumberChange("descent_start_distance", e.target.value)
          }
          placeholder={t("mission.config.descentStartDistanceHint")}
          className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
          data-testid="inspection-descent-start-distance"
        />
      </div>
      <div>
        <label
          htmlFor={glideSlopeId}
          className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
        >
          <span>{t("mission.config.descentGlideSlopeOverride")}</span>
          <InfoHint
            text={t("mission.config.descentGlideSlopeOverrideHelp")}
            label={t("mission.config.descentGlideSlopeOverride")}
            testId="hint-inspection-descent-glide-slope-override"
          />
        </label>
        <input
          id={glideSlopeId}
          type="number"
          step="0.1"
          min="0"
          max="10"
          value={descentGlideSlopeOverride}
          onChange={(e) =>
            onNumberChange("descent_glide_slope_override", e.target.value)
          }
          placeholder={t("mission.config.descentGlideSlopeOverrideHint")}
          className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
          data-testid="inspection-descent-glide-slope-override"
        />
      </div>
    </div>
  );
}
