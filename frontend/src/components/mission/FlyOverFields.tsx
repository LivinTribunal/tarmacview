import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { InspectionConfigOverride } from "@/types/mission";
import InfoHint from "@/components/common/InfoHint";

interface FlyOverFieldsProps {
  heightAboveLights: number | "";
  cameraGimbalAngle: number | "";
  onNumberChange: (field: keyof InspectionConfigOverride, raw: string) => void;
}

export default function FlyOverFields({
  heightAboveLights,
  cameraGimbalAngle,
  onNumberChange,
}: FlyOverFieldsProps) {
  /** fly-over height + gimbal angle fields. */
  const { t } = useTranslation();
  const heightId = useId();
  const gimbalId = useId();
  return (
    <div className="grid grid-cols-2 gap-3" data-testid="fly-over-fields">
      <div>
        <label
          htmlFor={heightId}
          className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
        >
          <span>{t("mission.config.heightAboveLights")}</span>
          <InfoHint
            text={t("mission.config.heightAboveLightsHelp")}
            label={t("mission.config.heightAboveLights")}
            testId="hint-inspection-fly-over-height-above-lights"
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
      <div>
        <label
          htmlFor={gimbalId}
          className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
        >
          <span>{t("mission.config.cameraGimbalAngle")}</span>
          <InfoHint
            text={t("mission.config.cameraSettings.gimbalAngleHelp")}
            label={t("mission.config.cameraGimbalAngle")}
            testId="hint-inspection-fly-over-gimbal-angle"
          />
        </label>
        <input
          id={gimbalId}
          type="number"
          step="1"
          min="-90"
          max="0"
          value={cameraGimbalAngle}
          onChange={(e) =>
            onNumberChange("camera_gimbal_angle", e.target.value)
          }
          placeholder={t("mission.config.cameraGimbalAngleHint")}
          className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
          data-testid="inspection-camera-gimbal-angle"
        />
      </div>
    </div>
  );
}
