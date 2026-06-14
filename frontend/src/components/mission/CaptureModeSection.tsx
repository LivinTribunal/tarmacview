import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { InspectionConfigOverride } from "@/types/mission";
import type { CaptureMode } from "@/types/enums";
import InfoHint from "@/components/common/InfoHint";
import FormSection from "@/components/common/FormSection";

interface CaptureModeSectionProps {
  captureMode: CaptureMode | null;
  effectiveCaptureMode: string;
  recordingSetupDuration: number | "";
  configOverride: InspectionConfigOverride;
  onChange: (override: InspectionConfigOverride) => void;
  onNumberChange: (field: keyof InspectionConfigOverride, raw: string) => void;
}

export default function CaptureModeSection({
  captureMode,
  effectiveCaptureMode,
  recordingSetupDuration,
  configOverride,
  onChange,
  onNumberChange,
}: CaptureModeSectionProps) {
  /** capture-mode section: video/photo override + recording setup duration (video only). */
  const { t } = useTranslation();
  const recordingSetupDurationId = useId();
  return (
    <FormSection title={t("mission.config.sections.captureMode")} testId="section-capture-mode">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
            <span>{t("mission.config.captureMode.title")}</span>
            <InfoHint
              text={t("mission.config.captureMode.titleHelp")}
              label={t("mission.config.captureMode.title")}
              testId="hint-inspection-capture-mode"
            />
          </label>
          <select
            value={captureMode ?? ""}
            onChange={(e) => {
              const val = e.target.value || null;
              onChange({ ...configOverride, capture_mode: val as CaptureMode | null });
            }}
            className="w-full appearance-none pl-3 pr-7 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%23888%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat"
            data-testid="inspection-capture-mode"
          >
            <option value="">{t("mission.config.captureMode.useMissionDefault")}</option>
            <option value="VIDEO_CAPTURE">{t("mission.config.captureMode.video")}</option>
            <option value="PHOTO_CAPTURE">{t("mission.config.captureMode.photo")}</option>
          </select>
        </div>
        {effectiveCaptureMode === "VIDEO_CAPTURE" && (
          <div>
            <label
              htmlFor={recordingSetupDurationId}
              className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
            >
              <span>{t("mission.config.captureMode.recordingSetupDuration")}</span>
              <InfoHint
                text={t("mission.config.captureMode.recordingSetupDurationHelp")}
                label={t("mission.config.captureMode.recordingSetupDuration")}
                testId="hint-inspection-recording-setup-duration"
              />
            </label>
            <input
              id={recordingSetupDurationId}
              type="number"
              step="0.5"
              min="0"
              value={recordingSetupDuration}
              onChange={(e) =>
                onNumberChange("recording_setup_duration", e.target.value)
              }
              placeholder={t("mission.config.captureMode.recordingSetupDurationHint")}
              className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
              data-testid="inspection-recording-setup-duration"
            />
          </div>
        )}
      </div>
    </FormSection>
  );
}
