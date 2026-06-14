import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { MissionUpdate } from "@/types/mission";
import type { CaptureMode } from "@/types/enums";
import type { CameraPresetResponse } from "@/types/cameraPreset";
import InfoHint from "@/components/common/InfoHint";
import FormSection from "@/components/common/FormSection";
import CameraSettingsFields from "./CameraSettingsFields";

interface MissionCameraSectionProps {
  defaultCaptureMode: CaptureMode | null;
  defaultBufferDistance: number | null;
  cameraMode: "AUTO" | "MANUAL";
  presets: CameraPresetResponse[];
  appliedPresetId: string;
  defaultWhiteBalance: string | null;
  defaultIso: number | null;
  defaultShutterSpeed: string | null;
  defaultFocusMode: "AUTO" | "INFINITY" | null;
  onChange: (update: Partial<MissionUpdate>) => void;
  onCameraModeChange: (mode: "AUTO" | "MANUAL") => void;
  onPresetApply: (presetId: string) => void;
}

/** mission capture-mode + camera-settings form sections. */
export default function MissionCameraSection({
  defaultCaptureMode,
  defaultBufferDistance,
  cameraMode,
  presets,
  appliedPresetId,
  defaultWhiteBalance,
  defaultIso,
  defaultShutterSpeed,
  defaultFocusMode,
  onChange,
  onCameraModeChange,
  onPresetApply,
}: MissionCameraSectionProps) {
  const { t } = useTranslation();
  const captureModeId = useId();
  const bufferDistanceId = useId();
  const cameraModeToggle = useMemo(
    () => (
      <div className="inline-flex rounded-full border border-tv-border bg-tv-surface p-0.5 text-xs" data-testid="mission-camera-mode">
        {(["AUTO", "MANUAL"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onCameraModeChange(m)}
            className={`px-3 py-1 rounded-full transition-colors ${cameraMode === m ? "bg-tv-accent text-white font-medium" : "text-tv-text-secondary hover:text-tv-text-primary"}`}
            data-testid={`mission-camera-mode-${m.toLowerCase()}`}
          >
            {t(m === "AUTO" ? "mission.config.cameraSettings.modeAuto" : "mission.config.cameraSettings.modeManual")}
          </button>
        ))}
      </div>
    ),
    [cameraMode, onCameraModeChange, t],
  );
  return (
    <>
      <FormSection title={t("mission.config.sections.captureMode")} testId="section-capture-mode">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label
            htmlFor={captureModeId}
            className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
          >
            <span>{t("mission.config.captureMode.defaultTitle")}</span>
            <InfoHint
              text={t("mission.config.captureMode.defaultTitleHelp")}
              label={t("mission.config.captureMode.defaultTitle")}
              testId="hint-default-capture-mode"
            />
          </label>
          <select
            id={captureModeId}
            value={defaultCaptureMode ?? "VIDEO_CAPTURE"}
            onChange={(e) =>
              onChange({ default_capture_mode: e.target.value as CaptureMode })
            }
            className="w-full appearance-none pl-3 pr-7 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%23888%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat"
            data-testid="default-capture-mode-select"
          >
            <option value="VIDEO_CAPTURE">{t("mission.config.captureMode.video")}</option>
            <option value="PHOTO_CAPTURE">{t("mission.config.captureMode.photo")}</option>
          </select>
        </div>
        <div>
          <label
            htmlFor={bufferDistanceId}
            className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
          >
            <span>{t("mission.config.defaultBufferDistance")}</span>
            <InfoHint
              text={t("mission.config.defaultBufferDistanceHelp")}
              label={t("mission.config.defaultBufferDistance")}
              testId="hint-default-buffer-distance"
            />
          </label>
          <input
            id={bufferDistanceId}
            type="number"
            step="0.5"
            min="0"
            value={defaultBufferDistance ?? ""}
            onChange={(e) =>
              onChange({ default_buffer_distance: e.target.value ? parseFloat(e.target.value) : null })
            }
            placeholder={t("mission.config.defaultBufferDistanceHint")}
            className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
            data-testid="default-buffer-distance-input"
          />
        </div>
      </div>
      </FormSection>

      <FormSection
        title={t("mission.config.sections.cameraSettings")}
        hint={t("mission.config.sections.cameraSettingsHelp")}
        testId="section-camera-settings"
        meta={cameraModeToggle}
      >
      <div data-testid="mission-camera-settings">
        {cameraMode === "AUTO" && (
          <p className="text-xs text-tv-text-secondary leading-tight mb-1">
            {t("mission.config.cameraSettings.modeAutoHint")}
          </p>
        )}
        {cameraMode === "MANUAL" && presets.length > 0 && (
          <div className="mb-2">
            <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
              <span>{t("mission.config.cameraSettings.presetLabel")}</span>
              <InfoHint
                text={t("mission.config.cameraSettings.presetLabelHelp")}
                label={t("mission.config.cameraSettings.presetLabel")}
                testId="hint-camera-preset"
              />
            </label>
            <select
              value={appliedPresetId}
              onChange={(e) => onPresetApply(e.target.value)}
              className="w-full appearance-none pl-3 pr-7 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%23888%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat"
              data-testid="mission-camera-preset-select"
            >
              <option value="">{t("mission.config.cameraSettings.applyPreset")}</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.is_default ? ` (${t("mission.config.cameraSettings.presetDefault")})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        {cameraMode === "MANUAL" && (
        <div className="grid grid-cols-2 gap-2">
          <CameraSettingsFields
            whiteBalance={{
              value: defaultWhiteBalance ?? "",
              onChange: (raw) => onChange({ default_white_balance: raw || null }),
              emptyOption: t("mission.config.cameraSettings.notSet"),
              hintTestId: "hint-white-balance",
              selectTestId: "default-white-balance-select",
            }}
            iso={{
              value: defaultIso ?? "",
              onChange: (raw) =>
                onChange({ default_iso: raw ? parseInt(raw) : null }),
              emptyOption: t("mission.config.cameraSettings.notSet"),
              hintTestId: "hint-iso",
              selectTestId: "default-iso-input",
            }}
            shutterSpeed={{
              value: defaultShutterSpeed ?? "",
              onChange: (raw) => onChange({ default_shutter_speed: raw || null }),
              emptyOption: t("mission.config.cameraSettings.notSet"),
              hintTestId: "hint-shutter-speed",
              selectTestId: "default-shutter-speed-input",
            }}
            focusMode={{
              value: defaultFocusMode ?? "",
              onChange: (raw) =>
                onChange({ default_focus_mode: (raw || null) as "AUTO" | "INFINITY" | null }),
              emptyOption: t("mission.config.cameraSettings.notSet"),
              hintTestId: "hint-focus-mode",
              selectTestId: "default-focus-mode-select",
            }}
          />
        </div>
        )}
      </div>
      </FormSection>
    </>
  );
}
