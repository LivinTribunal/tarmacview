import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import InfoHint from "@/components/common/InfoHint";
import {
  WHITE_BALANCE_OPTIONS,
  ISO_OPTIONS,
  SHUTTER_SPEED_OPTIONS,
} from "@/constants/camera";

// shared select styling - identical across the mission-default and
// per-inspection camera grids; kept verbatim so the rendered DOM is unchanged.
const SELECT_CLASS =
  "w-full appearance-none pl-3 pr-7 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%23888%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat";

interface FieldConfig {
  value: string | number;
  onChange: (raw: string) => void;
  emptyOption: ReactNode;
  hintTestId: string;
  selectTestId: string;
}

interface CameraSettingsFieldsProps {
  whiteBalance: FieldConfig;
  iso: FieldConfig;
  shutterSpeed: FieldConfig;
  focusMode: FieldConfig;
}

/** the four WB/ISO/shutter/focus selects shared by the mission and inspection camera grids. */
export default function CameraSettingsFields({
  whiteBalance,
  iso,
  shutterSpeed,
  focusMode,
}: CameraSettingsFieldsProps) {
  const { t } = useTranslation();
  return (
    <>
      <div>
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t("mission.config.cameraSettings.whiteBalance")}</span>
          <InfoHint
            text={t("mission.config.cameraSettings.whiteBalanceHelp")}
            label={t("mission.config.cameraSettings.whiteBalance")}
            testId={whiteBalance.hintTestId}
          />
        </label>
        <select
          value={whiteBalance.value}
          onChange={(e) => whiteBalance.onChange(e.target.value)}
          className={SELECT_CLASS}
          data-testid={whiteBalance.selectTestId}
        >
          <option value="">{whiteBalance.emptyOption}</option>
          {WHITE_BALANCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t("mission.config.cameraSettings.iso")}</span>
          <InfoHint
            text={t("mission.config.cameraSettings.isoHelp")}
            label={t("mission.config.cameraSettings.iso")}
            testId={iso.hintTestId}
          />
        </label>
        <select
          value={iso.value}
          onChange={(e) => iso.onChange(e.target.value)}
          className={SELECT_CLASS}
          data-testid={iso.selectTestId}
        >
          <option value="">{iso.emptyOption}</option>
          {ISO_OPTIONS.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t("mission.config.cameraSettings.shutterSpeed")}</span>
          <InfoHint
            text={t("mission.config.cameraSettings.shutterSpeedHelp")}
            label={t("mission.config.cameraSettings.shutterSpeed")}
            testId={shutterSpeed.hintTestId}
          />
        </label>
        <select
          value={shutterSpeed.value}
          onChange={(e) => shutterSpeed.onChange(e.target.value)}
          className={SELECT_CLASS}
          data-testid={shutterSpeed.selectTestId}
        >
          <option value="">{shutterSpeed.emptyOption}</option>
          {SHUTTER_SPEED_OPTIONS.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t("mission.config.cameraSettings.focusMode")}</span>
          <InfoHint
            text={t("mission.config.cameraSettings.focusModeHelp")}
            label={t("mission.config.cameraSettings.focusMode")}
            testId={focusMode.hintTestId}
          />
        </label>
        <select
          value={focusMode.value}
          onChange={(e) => focusMode.onChange(e.target.value)}
          className={SELECT_CLASS}
          data-testid={focusMode.selectTestId}
        >
          <option value="">{focusMode.emptyOption}</option>
          <option value="AUTO">{t("mission.config.cameraSettings.fm.auto")}</option>
          <option value="INFINITY">{t("mission.config.cameraSettings.fm.infinity")}</option>
        </select>
      </div>
    </>
  );
}
