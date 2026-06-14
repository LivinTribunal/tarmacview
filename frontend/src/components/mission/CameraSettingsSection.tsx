import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, RotateCcw, Save } from "lucide-react";
import type { InspectionConfigOverride, MissionDetailResponse } from "@/types/mission";
import type { DroneProfileResponse } from "@/types/droneProfile";
import type { CameraPresetResponse } from "@/types/cameraPreset";
import InfoHint from "@/components/common/InfoHint";
import ZoomSlider from "@/components/common/ZoomSlider";
import FormSection from "@/components/common/FormSection";
import { WHITE_BALANCE_OPTIONS, OPTICAL_ZOOM_MIN } from "@/constants/camera";
import CameraSettingsFields from "./CameraSettingsFields";
import { isZoomOverOptical } from "@/utils/cameraAutoCalc";

interface CameraSettingsSectionProps {
  effectiveCameraMode: "AUTO" | "MANUAL";
  cameraMode: "AUTO" | "MANUAL" | null;
  onCameraModeChange: (mode: "INHERIT" | "AUTO" | "MANUAL") => void;
  selectedPresetId: string;
  onPresetSelect: (presetId: string) => void;
  presets: CameraPresetResponse[];
  whiteBalance: string | null;
  isoValue: number | "";
  shutterSpeed: string | null;
  focusMode: "AUTO" | "INFINITY" | null;
  opticalZoom: number | "";
  zoomTouched: boolean;
  onZoomTouchedChange: (touched: boolean) => void;
  computedOpticalZoom: number | null;
  configOverride: InspectionConfigOverride;
  onChange: (override: InspectionConfigOverride) => void;
  onNumberChange: (field: keyof InspectionConfigOverride, raw: string) => void;
  mission: MissionDetailResponse;
  droneProfile: DroneProfileResponse | null;
  showSavePreset: boolean;
  onShowSavePresetChange: (show: boolean) => void;
  presetName: string;
  onPresetNameChange: (name: string) => void;
  savingPreset: boolean;
  onSaveAsPreset: () => void;
}

export default function CameraSettingsSection({
  effectiveCameraMode,
  cameraMode,
  onCameraModeChange,
  selectedPresetId,
  onPresetSelect,
  presets,
  whiteBalance,
  isoValue,
  shutterSpeed,
  focusMode,
  opticalZoom,
  zoomTouched,
  onZoomTouchedChange,
  computedOpticalZoom,
  configOverride,
  onChange,
  onNumberChange,
  mission,
  droneProfile,
  showSavePreset,
  onShowSavePresetChange,
  presetName,
  onPresetNameChange,
  savingPreset,
  onSaveAsPreset,
}: CameraSettingsSectionProps) {
  /** per-inspection camera mode, preset picker, WB/ISO/shutter/focus/zoom controls. */
  const { t } = useTranslation();
  const cameraModeToggle = useMemo(
    () => (
      <div className="inline-flex rounded-full border border-tv-border bg-tv-surface p-0.5 text-xs" data-testid="inspection-camera-mode">
        {([
          { key: "INHERIT", active: cameraMode === null },
          { key: "AUTO", active: cameraMode === "AUTO" },
          { key: "MANUAL", active: cameraMode === "MANUAL" },
        ] as const).map(({ key, active }) => (
          <button
            key={key}
            type="button"
            onClick={() => onCameraModeChange(key)}
            className={`px-3 py-1 rounded-full transition-colors ${active ? "bg-tv-accent text-white font-medium" : "text-tv-text-secondary hover:text-tv-text-primary"}`}
            data-testid={`inspection-camera-mode-${key.toLowerCase()}`}
          >
            {t(
              key === "INHERIT"
                ? "mission.config.cameraSettings.modeInherit"
                : key === "AUTO"
                  ? "mission.config.cameraSettings.modeAuto"
                  : "mission.config.cameraSettings.modeManual",
            )}
          </button>
        ))}
      </div>
    ),
    [cameraMode, onCameraModeChange, t],
  );
  return (
    <FormSection
      title={t("mission.config.sections.cameraSettings")}
      hint={t("mission.config.cameraSettings.titleHelp")}
      testId="section-camera-settings"
      meta={cameraModeToggle}
    >
      <div data-testid="camera-settings-section">
        {effectiveCameraMode === "AUTO" && (
          <p className="text-xs text-tv-text-secondary leading-tight mb-2">
            {t("mission.config.cameraSettings.modeAutoHint")}
          </p>
        )}

        {effectiveCameraMode === "MANUAL" && (<>
        {/* preset picker */}
        <div className="mb-3" data-testid="camera-preset-picker">
          <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
            <span>{t("mission.config.cameraSettings.presetLabel")}</span>
            <InfoHint
              text={t("mission.config.cameraSettings.presetLabelHelp")}
              label={t("mission.config.cameraSettings.presetLabel")}
              testId="hint-inspection-camera-preset"
            />
          </label>
          <select
            value={selectedPresetId}
            onChange={(e) => onPresetSelect(e.target.value)}
            className="w-full appearance-none pl-3 pr-7 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%23888%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat"
            data-testid="camera-preset-select"
          >
            <option value="">{t("mission.config.cameraSettings.presetNone")}</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.is_default ? ` (${t("mission.config.cameraSettings.presetDefault")})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <CameraSettingsFields
            whiteBalance={{
              value: whiteBalance ?? "",
              onChange: (raw) =>
                onChange({ ...configOverride, white_balance: raw || null }),
              emptyOption: mission.default_white_balance
                ? `${t("mission.config.cameraSettings.missionDefault")}: ${WHITE_BALANCE_OPTIONS.find((o) => o.value === mission.default_white_balance)?.label ?? mission.default_white_balance}`
                : t("mission.config.cameraSettings.notSet"),
              hintTestId: "hint-inspection-white-balance",
              selectTestId: "inspection-white-balance",
            }}
            iso={{
              value: isoValue,
              onChange: (raw) =>
                onChange({ ...configOverride, iso: raw ? parseInt(raw) : null }),
              emptyOption:
                mission.default_iso != null
                  ? `${t("mission.config.cameraSettings.missionDefault")}: ${mission.default_iso}`
                  : t("mission.config.cameraSettings.notSet"),
              hintTestId: "hint-inspection-iso",
              selectTestId: "inspection-iso",
            }}
            shutterSpeed={{
              value: shutterSpeed ?? "",
              onChange: (raw) =>
                onChange({ ...configOverride, shutter_speed: raw || null }),
              emptyOption: mission.default_shutter_speed
                ? `${t("mission.config.cameraSettings.missionDefault")}: ${mission.default_shutter_speed}`
                : t("mission.config.cameraSettings.notSet"),
              hintTestId: "hint-inspection-shutter-speed",
              selectTestId: "inspection-shutter-speed",
            }}
            focusMode={{
              value: focusMode ?? "",
              onChange: (raw) =>
                onChange({
                  ...configOverride,
                  focus_mode: (raw || null) as "AUTO" | "INFINITY" | null,
                }),
              emptyOption: mission.default_focus_mode
                ? `${t("mission.config.cameraSettings.missionDefault")}: ${t(`mission.config.cameraSettings.fm.${{ AUTO: "auto", INFINITY: "infinity" }[mission.default_focus_mode] ?? mission.default_focus_mode}`, mission.default_focus_mode)}`
                : t("mission.config.cameraSettings.notSet"),
              hintTestId: "hint-inspection-focus-mode",
              selectTestId: "inspection-focus-mode",
            }}
          />
          <div className="col-span-2">
            <div className="flex items-center justify-between mb-1">
              <label className="flex items-center gap-1 text-xs font-medium text-tv-text-secondary">
                <span>{t("mission.config.cameraSettings.opticalZoom")}</span>
                <InfoHint
                  text={t("mission.config.cameraSettings.opticalZoomHelp")}
                  label={t("mission.config.cameraSettings.opticalZoom")}
                  testId="hint-inspection-optical-zoom"
                />
              </label>
              <div className="flex items-center gap-1.5">
                {!zoomTouched && computedOpticalZoom != null && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-tv-accent/10 text-tv-accent font-medium">
                    {t("mission.config.cameraSettings.auto")}
                  </span>
                )}
                {zoomTouched && computedOpticalZoom != null && (
                  <button
                    type="button"
                    onClick={() => {
                      onZoomTouchedChange(false);
                      onChange({ ...configOverride, optical_zoom: computedOpticalZoom });
                    }}
                    className="flex items-center gap-0.5 text-[10px] text-tv-text-secondary hover:text-tv-accent transition-colors"
                    data-testid="optical-zoom-reset"
                    title={t("mission.config.cameraSettings.resetToAuto")}
                  >
                    <RotateCcw className="h-3 w-3" />
                    {t("mission.config.cameraSettings.resetToAuto")}
                  </button>
                )}
                <span className="text-xs text-tv-text-secondary">{typeof opticalZoom === "number" ? `${opticalZoom}x` : ""}</span>
              </div>
            </div>
            <ZoomSlider
              value={typeof opticalZoom === "number" ? opticalZoom : OPTICAL_ZOOM_MIN}
              onChange={(v) => {
                onZoomTouchedChange(true);
                onNumberChange("optical_zoom", String(v));
              }}
              maxOpticalZoom={droneProfile?.max_optical_zoom}
              testId="inspection-optical-zoom"
            />
            {isZoomOverOptical(
              typeof opticalZoom === "number" ? opticalZoom : null,
              droneProfile?.max_optical_zoom ?? null,
            ) && (
              <div
                className="mt-1 flex items-start gap-1 text-xs text-tv-warning"
                data-testid="zoom-over-optical-warning"
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  {t("mission.config.cameraSettings.zoomOverOpticalWarning", {
                    max: droneProfile?.max_optical_zoom,
                  })}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* save as preset */}
        {!showSavePreset ? (
          <button
            type="button"
            onClick={() => onShowSavePresetChange(true)}
            className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border border-tv-border text-tv-text-secondary hover:bg-tv-surface-hover transition-colors"
            data-testid="save-as-preset-btn"
          >
            <Save className="h-3 w-3" />
            {t("mission.config.cameraSettings.saveAsPreset")}
          </button>
        ) : (
          <div className="mt-2 flex items-center gap-2" data-testid="save-preset-form">
            <input
              type="text"
              value={presetName}
              onChange={(e) => onPresetNameChange(e.target.value)}
              placeholder={t("mission.config.cameraSettings.presetNamePlaceholder")}
              aria-label={t("mission.config.cameraSettings.presetNamePlaceholder")}
              className="flex-1 px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
              data-testid="preset-name-input"
            />
            <button
              type="button"
              onClick={onSaveAsPreset}
              disabled={savingPreset || !presetName.trim()}
              className="px-3 py-1.5 rounded-full text-xs bg-tv-accent text-tv-accent-text hover:opacity-90 transition-opacity disabled:opacity-50"
              data-testid="preset-save-confirm"
            >
              {t("mission.config.cameraSettings.presetSave")}
            </button>
            <button
              type="button"
              onClick={() => { onShowSavePresetChange(false); onPresetNameChange(""); }}
              className="px-3 py-1.5 rounded-full text-xs border border-tv-border text-tv-text-secondary hover:bg-tv-surface-hover transition-colors"
            >
              {t("mission.config.cameraSettings.presetCancel")}
            </button>
          </div>
        )}
        </>)}
      </div>
    </FormSection>
  );
}
