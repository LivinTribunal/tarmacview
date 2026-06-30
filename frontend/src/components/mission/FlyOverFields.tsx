import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { InspectionConfigOverride } from "@/types/mission";
import InfoHint from "@/components/common/InfoHint";
import HeightAboveLightsField from "./HeightAboveLightsField";

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
  const gimbalId = useId();
  return (
    <div className="grid grid-cols-2 gap-3" data-testid="fly-over-fields">
      <HeightAboveLightsField
        heightAboveLights={heightAboveLights}
        onNumberChange={onNumberChange}
        hintTestId="hint-inspection-fly-over-height-above-lights"
      />
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
