import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { AGLResponse } from "@/types/airport";
import type { InspectionConfigOverride } from "@/types/mission";
import InfoHint from "@/components/common/InfoHint";
import ReadOnlyField from "@/components/common/ReadOnlyField";
import { formatNumber } from "@/utils/format";

interface HorizontalRangeGeometryProps {
  sweepAngle: number | "";
  angleOffsetAbove: number | "";
  bufferDistance: number | "";
  lhaSettingAngleOverrideId: string | null;
  computedObservationAngle: number | null;
  targetAgls: AGLResponse[];
  configOverride: InspectionConfigOverride;
  onChange: (override: InspectionConfigOverride) => void;
  onNumberChange: (field: keyof InspectionConfigOverride, raw: string) => void;
}

export default function HorizontalRangeGeometry({
  sweepAngle,
  angleOffsetAbove,
  bufferDistance,
  lhaSettingAngleOverrideId,
  computedObservationAngle,
  targetAgls,
  configOverride,
  onChange,
  onNumberChange,
}: HorizontalRangeGeometryProps) {
  /** horizontal-range geometry overrides: sweep, offset, buffer, setting-angle. */
  const { t } = useTranslation();
  const sweepId = useId();
  const offsetId = useId();
  const bufferId = useId();
  const settingAngleId = useId();
  return (
    <>
      <div>
        <label
          htmlFor={sweepId}
          className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
        >
          <span>{t("mission.config.sweepAngle")}</span>
          <InfoHint
            text={t("mission.config.sweepAngleHelp")}
            label={t("mission.config.sweepAngle")}
            testId="hint-inspection-sweep-angle"
          />
        </label>
        <input
          id={sweepId}
          type="number"
          step="0.5"
          min="1"
          max="180"
          value={sweepAngle}
          onChange={(e) =>
            onNumberChange("sweep_angle", e.target.value)
          }
          placeholder={t("mission.config.sweepAngleHint")}
          className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
          data-testid="inspection-sweep-angle"
        />
      </div>
      <div>
        <label
          htmlFor={offsetId}
          className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
        >
          <span>{t("mission.config.angleOffset")}</span>
          <InfoHint
            text={t("mission.config.angleOffsetHelp")}
            label={t("mission.config.angleOffset")}
            testId="hint-inspection-angle-offset"
          />
        </label>
        <input
          id={offsetId}
          type="number"
          step="0.1"
          min="0"
          max="10"
          value={angleOffsetAbove}
          onChange={(e) =>
            onNumberChange("angle_offset_above", e.target.value)
          }
          placeholder={t("mission.config.angleOffsetHint")}
          className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
          data-testid="inspection-angle-offset"
        />
      </div>
      <div>
        <label
          htmlFor={bufferId}
          className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
        >
          <span>{t("mission.config.bufferDistanceOverride")}</span>
          <InfoHint
            text={t("mission.config.bufferDistanceOverrideHelp")}
            label={t("mission.config.bufferDistanceOverride")}
            testId="hint-inspection-buffer-distance-hr"
          />
        </label>
        <input
          id={bufferId}
          type="number"
          step="0.5"
          min="0"
          value={bufferDistance}
          onChange={(e) =>
            onNumberChange("buffer_distance", e.target.value)
          }
          placeholder={t("mission.config.bufferDistanceOverrideHint")}
          className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
          data-testid="inspection-buffer-distance"
        />
      </div>
      <div>
        <label
          htmlFor={settingAngleId}
          className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
        >
          <span>{t("mission.config.lhaSettingAngleOverride")}</span>
          <InfoHint
            text={t("mission.config.lhaSettingAngleOverrideHelp")}
            label={t("mission.config.lhaSettingAngleOverride")}
            testId="hint-inspection-lha-setting-angle-override"
          />
        </label>
        <select
          id={settingAngleId}
          value={lhaSettingAngleOverrideId ?? ""}
          onChange={(e) => {
            const v = e.target.value || null;
            onChange({ ...configOverride, lha_setting_angle_override_id: v });
          }}
          className="w-full appearance-none pl-3 pr-7 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%23888%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat"
          data-testid="inspection-lha-setting-angle-override"
        >
          <option value="">{t("mission.config.lhaSettingAngleOverrideAuto")}</option>
          {targetAgls.flatMap((agl) =>
            agl.lhas.map((lha) => (
              <option key={lha.id} value={lha.id}>
                {t("mission.config.unitDesignator")} {lha.unit_designator}
                {lha.setting_angle != null ? ` (${formatNumber(lha.setting_angle, 1)}°)` : ""}
              </option>
            )),
          )}
        </select>
        <p className="text-xs text-tv-text-secondary mt-1">
          {t("mission.config.lhaSettingAngleOverrideHint")}
        </p>
      </div>
      {computedObservationAngle != null && (
        <ReadOnlyField
          label={t("mission.config.computedObservationAngle")}
          hint={t("mission.config.computedObservationAngleHelp")}
          value={`${computedObservationAngle}°`}
          testId="computed-observation-angle"
        />
      )}
    </>
  );
}
