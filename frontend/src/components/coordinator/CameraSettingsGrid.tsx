import { useTranslation } from "react-i18next";
import {
  WHITE_BALANCE_OPTIONS,
  ISO_OPTIONS,
  SHUTTER_SPEED_OPTIONS,
} from "@/constants/camera";

// shared select styling for the preset-panel grid - kept verbatim so the
// edit and create grids render identical DOM.
const SELECT_CLASS =
  "w-full appearance-none pl-3 pr-7 py-1.5 rounded-full text-xs border border-tv-border bg-tv-surface text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%23888%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat";

interface CameraSettingsGridProps {
  whiteBalance: string | number;
  iso: string | number;
  shutterSpeed: string | number;
  focusMode: string | number;
  onWhiteBalanceChange: (raw: string) => void;
  onIsoChange: (raw: string) => void;
  onShutterSpeedChange: (raw: string) => void;
  onFocusModeChange: (raw: string) => void;
  // when set, each select gets `${testIdPrefix}-<field>` (create grid only)
  testIdPrefix?: string;
}

/** the four WB/ISO/shutter/focus selects shared by the preset edit and create forms. */
export default function CameraSettingsGrid({
  whiteBalance,
  iso,
  shutterSpeed,
  focusMode,
  onWhiteBalanceChange,
  onIsoChange,
  onShutterSpeedChange,
  onFocusModeChange,
  testIdPrefix,
}: CameraSettingsGridProps) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label className="block text-[10px] font-medium mb-0.5 text-tv-text-secondary">
          {t("mission.config.cameraSettings.whiteBalance")}
        </label>
        <select
          value={whiteBalance}
          onChange={(e) => onWhiteBalanceChange(e.target.value)}
          className={SELECT_CLASS}
          data-testid={testIdPrefix ? `${testIdPrefix}-white-balance` : undefined}
        >
          <option value="">{t("mission.config.cameraSettings.notSet")}</option>
          {WHITE_BALANCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-medium mb-0.5 text-tv-text-secondary">
          {t("mission.config.cameraSettings.iso")}
        </label>
        <select
          value={iso}
          onChange={(e) => onIsoChange(e.target.value)}
          className={SELECT_CLASS}
          data-testid={testIdPrefix ? `${testIdPrefix}-iso` : undefined}
        >
          <option value="">{t("mission.config.cameraSettings.notSet")}</option>
          {ISO_OPTIONS.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-medium mb-0.5 text-tv-text-secondary">
          {t("mission.config.cameraSettings.shutterSpeed")}
        </label>
        <select
          value={shutterSpeed}
          onChange={(e) => onShutterSpeedChange(e.target.value)}
          className={SELECT_CLASS}
          data-testid={testIdPrefix ? `${testIdPrefix}-shutter-speed` : undefined}
        >
          <option value="">{t("mission.config.cameraSettings.notSet")}</option>
          {SHUTTER_SPEED_OPTIONS.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-medium mb-0.5 text-tv-text-secondary">
          {t("mission.config.cameraSettings.focusMode")}
        </label>
        <select
          value={focusMode}
          onChange={(e) => onFocusModeChange(e.target.value)}
          className={SELECT_CLASS}
          data-testid={testIdPrefix ? `${testIdPrefix}-focus-mode` : undefined}
        >
          <option value="">{t("mission.config.cameraSettings.notSet")}</option>
          <option value="AUTO">{t("mission.config.cameraSettings.fm.auto")}</option>
          <option value="INFINITY">{t("mission.config.cameraSettings.fm.infinity")}</option>
        </select>
      </div>
    </div>
  );
}
