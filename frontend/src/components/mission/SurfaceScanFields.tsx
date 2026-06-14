import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type {
  InspectionConfigOverride,
  InspectionConfigResponse,
} from "@/types/mission";
import type { InspectionConfigResponse as TemplateConfigResponse } from "@/types/inspectionTemplate";
import type { SurfaceResponse } from "@/types/airport";
import type { DroneProfileResponse } from "@/types/droneProfile";
import type { ScanLengthMode, ScanRunOrientation, ScanWidthSide } from "@/types/enums";
import InfoHint from "@/components/common/InfoHint";

interface SurfaceScanFieldsProps {
  surfaces: SurfaceResponse[];
  savedConfig: InspectionConfigResponse | null;
  defaultConfig: TemplateConfigResponse | null;
  droneProfile: DroneProfileResponse | null;
  configOverride: InspectionConfigOverride;
  onChange: (override: InspectionConfigOverride) => void;
  onNumberChange: (field: keyof InspectionConfigOverride, raw: string) => void;
}

const DEFAULT_SCAN_HEIGHT = 10;
const DEFAULT_SCAN_GIMBAL = -70;
const DEFAULT_SCAN_SIDELAP = 20;

const inputClass =
  "w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors disabled:opacity-50";
const labelClass =
  "flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary";

/** computed optimal run count from the FOV footprint, or null when unknown. */
function computeOptimalRuns(
  width: number | null,
  sensorFov: number | null,
  height: number,
  gimbal: number,
  sidelap: number,
): number | null {
  if (!width || width <= 0 || !sensorFov || sensorFov <= 0) return null;
  const theta = ((90 + gimbal) * Math.PI) / 180;
  const cosTheta = Math.cos(theta);
  if (cosTheta <= 0) return null;
  const footprint = 2 * (height / cosTheta) * Math.tan((sensorFov * Math.PI) / 360);
  const effective = footprint * (1 - sidelap / 100);
  if (effective <= 0) return null;
  return Math.max(1, Math.ceil(width / effective));
}

export default function SurfaceScanFields({
  surfaces,
  savedConfig,
  defaultConfig,
  droneProfile,
  configOverride,
  onChange,
  onNumberChange,
}: SurfaceScanFieldsProps) {
  /** surface-scan config: target surface, length/width window, height, run layout. */
  const { t } = useTranslation();
  const surfaceId = useId();
  const heightId = useId();
  const runCountId = useId();
  const sidelapId = useId();
  const gimbalId = useId();
  const widthId = useId();

  // resolve a value: dirty override > saved config > template default.
  function resolveNumber(field: keyof InspectionConfigOverride): number | "" {
    if (field in configOverride) {
      const v = configOverride[field];
      return typeof v === "number" ? v : "";
    }
    const saved = savedConfig?.[field as keyof typeof savedConfig];
    if (typeof saved === "number") return saved;
    const def = defaultConfig?.[field as keyof typeof defaultConfig];
    return typeof def === "number" ? def : "";
  }

  function resolveString<T>(field: keyof InspectionConfigOverride): T | null {
    if (field in configOverride) {
      return (configOverride[field] as T | null) ?? null;
    }
    const saved = savedConfig?.[field as keyof typeof savedConfig];
    if (saved != null) return saved as T;
    const def = defaultConfig?.[field as keyof typeof defaultConfig];
    return def != null ? (def as T) : null;
  }

  const scanSurfaceId = resolveString<string>("scan_surface_id") ?? "";
  const lengthMode = resolveString<ScanLengthMode>("scan_length_mode") ?? "FULL";
  const lengthFrom = resolveNumber("scan_length_from");
  const lengthTo = resolveNumber("scan_length_to");
  const scanWidth = resolveNumber("scan_width");
  const widthSide = resolveString<ScanWidthSide>("scan_width_side") ?? "RIGHT";
  const scanHeight = resolveNumber("scan_height");
  const runCount = resolveNumber("scan_run_count");
  const orientation =
    resolveString<ScanRunOrientation>("scan_run_orientation") ?? "LENGTH_WISE";
  const sidelap = resolveNumber("scan_sidelap_percent");
  const gimbal = resolveNumber("camera_gimbal_angle");

  const selectedSurface = surfaces.find((s) => s.id === scanSurfaceId) ?? null;

  const optimalRuns = useMemo(() => {
    const effectiveWidth =
      typeof scanWidth === "number" ? scanWidth : selectedSurface?.width ?? null;
    return computeOptimalRuns(
      effectiveWidth,
      droneProfile?.sensor_fov ?? null,
      typeof scanHeight === "number" ? scanHeight : DEFAULT_SCAN_HEIGHT,
      typeof gimbal === "number" ? gimbal : DEFAULT_SCAN_GIMBAL,
      typeof sidelap === "number" ? sidelap : DEFAULT_SCAN_SIDELAP,
    );
  }, [scanWidth, selectedSurface, droneProfile, scanHeight, gimbal, sidelap]);

  const lengthModes: ScanLengthMode[] = ["FULL", "MAX_LENGTH", "INTERVAL"];

  return (
    <div className="space-y-3" data-testid="surface-scan-fields">
      {/* target surface */}
      <div>
        <label htmlFor={surfaceId} className={labelClass}>
          <span>{t("mission.config.scanSurface")}</span>
          <InfoHint
            text={t("mission.config.scanSurfaceHelp")}
            label={t("mission.config.scanSurface")}
            testId="hint-scan-surface"
          />
        </label>
        <select
          id={surfaceId}
          value={scanSurfaceId}
          onChange={(e) =>
            onChange({ ...configOverride, scan_surface_id: e.target.value || null })
          }
          className={inputClass}
          data-testid="scan-surface"
        >
          <option value="">{t("mission.config.scanSurfaceSelect")}</option>
          {surfaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.identifier} (
              {s.surface_type === "RUNWAY" ? t("airport.runway") : t("airport.taxiway")})
            </option>
          ))}
        </select>
      </div>

      {/* length mode */}
      <div>
        <label className={labelClass}>
          <span>{t("mission.config.scanLengthMode")}</span>
          <InfoHint
            text={t("mission.config.scanLengthModeHelp")}
            label={t("mission.config.scanLengthMode")}
            testId="hint-scan-length-mode"
          />
        </label>
        <div className="flex gap-1 rounded-full bg-tv-bg border border-tv-border p-0.5">
          {lengthModes.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange({ ...configOverride, scan_length_mode: mode })}
              className={`flex-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                lengthMode === mode
                  ? "bg-tv-accent text-tv-accent-text"
                  : "text-tv-text-secondary hover:text-tv-text-primary"
              }`}
              data-testid={`scan-length-mode-${mode.toLowerCase()}`}
            >
              {t(`mission.config.scanLengthModeOption.${mode}`)}
            </button>
          ))}
        </div>
      </div>

      {(lengthMode === "MAX_LENGTH" || lengthMode === "INTERVAL") && (
        <div className="grid grid-cols-2 gap-2">
          {lengthMode === "INTERVAL" && (
            <div>
              <label className={labelClass}>
                <span>{t("mission.config.scanLengthFrom")}</span>
              </label>
              <input
                type="number"
                step="1"
                min="0"
                value={lengthFrom}
                onChange={(e) => onNumberChange("scan_length_from", e.target.value)}
                className={inputClass}
                data-testid="scan-length-from"
              />
            </div>
          )}
          <div>
            <label className={labelClass}>
              <span>{t("mission.config.scanLengthTo")}</span>
            </label>
            <input
              type="number"
              step="1"
              min="0"
              value={lengthTo}
              onChange={(e) => onNumberChange("scan_length_to", e.target.value)}
              className={inputClass}
              data-testid="scan-length-to"
            />
          </div>
        </div>
      )}

      {/* width + side */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={widthId} className={labelClass}>
            <span>{t("mission.config.scanWidth")}</span>
            <InfoHint
              text={t("mission.config.scanWidthHelp")}
              label={t("mission.config.scanWidth")}
              testId="hint-scan-width"
            />
          </label>
          <input
            id={widthId}
            type="number"
            step="1"
            min="0"
            value={scanWidth}
            onChange={(e) => onNumberChange("scan_width", e.target.value)}
            placeholder={t("mission.config.scanWidthHint")}
            className={inputClass}
            data-testid="scan-width"
          />
        </div>
        <div>
          <label className={labelClass}>
            <span>{t("mission.config.scanWidthSide")}</span>
          </label>
          <div className="flex gap-1 rounded-full bg-tv-bg border border-tv-border p-0.5">
            {(["LEFT", "RIGHT"] as ScanWidthSide[]).map((side) => (
              <button
                key={side}
                type="button"
                disabled={typeof scanWidth !== "number"}
                onClick={() => onChange({ ...configOverride, scan_width_side: side })}
                className={`flex-1 px-3 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-50 ${
                  widthSide === side
                    ? "bg-tv-accent text-tv-accent-text"
                    : "text-tv-text-secondary hover:text-tv-text-primary"
                }`}
                data-testid={`scan-width-side-${side.toLowerCase()}`}
              >
                {t(`mission.config.scanWidthSideOption.${side}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* height + gimbal */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={heightId} className={labelClass}>
            <span>{t("mission.config.scanHeight")}</span>
            <InfoHint
              text={t("mission.config.scanHeightHelp")}
              label={t("mission.config.scanHeight")}
              testId="hint-scan-height"
            />
          </label>
          <input
            id={heightId}
            type="number"
            step="0.5"
            min="0"
            value={scanHeight}
            onChange={(e) => onNumberChange("scan_height", e.target.value)}
            placeholder={String(DEFAULT_SCAN_HEIGHT)}
            className={inputClass}
            data-testid="scan-height"
          />
        </div>
        <div>
          <label htmlFor={gimbalId} className={labelClass}>
            <span>{t("mission.config.cameraGimbalAngle")}</span>
            <InfoHint
              text={t("mission.config.scanGimbalHelp")}
              label={t("mission.config.cameraGimbalAngle")}
              testId="hint-scan-gimbal"
            />
          </label>
          <input
            id={gimbalId}
            type="number"
            step="1"
            min="-90"
            max="-1"
            value={gimbal}
            onChange={(e) => onNumberChange("camera_gimbal_angle", e.target.value)}
            placeholder={String(DEFAULT_SCAN_GIMBAL)}
            className={inputClass}
            data-testid="scan-gimbal"
          />
        </div>
      </div>

      {/* orientation */}
      <div>
        <label className={labelClass}>
          <span>{t("mission.config.scanRunOrientation")}</span>
          <InfoHint
            text={t("mission.config.scanRunOrientationHelp")}
            label={t("mission.config.scanRunOrientation")}
            testId="hint-scan-orientation"
          />
        </label>
        <div className="flex gap-1 rounded-full bg-tv-bg border border-tv-border p-0.5">
          {(["LENGTH_WISE", "WIDTH_WISE"] as ScanRunOrientation[]).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() =>
                onChange({ ...configOverride, scan_run_orientation: opt })
              }
              className={`flex-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                orientation === opt
                  ? "bg-tv-accent text-tv-accent-text"
                  : "text-tv-text-secondary hover:text-tv-text-primary"
              }`}
              data-testid={`scan-orientation-${opt.toLowerCase()}`}
            >
              {t(`mission.config.scanRunOrientationOption.${opt}`)}
            </button>
          ))}
        </div>
      </div>

      {/* run count + sidelap */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={runCountId} className={labelClass}>
            <span>{t("mission.config.scanRunCount")}</span>
            <InfoHint
              text={t("mission.config.scanRunCountHelp")}
              label={t("mission.config.scanRunCount")}
              testId="hint-scan-run-count"
            />
          </label>
          <input
            id={runCountId}
            type="number"
            step="1"
            min="1"
            value={runCount}
            onChange={(e) => onNumberChange("scan_run_count", e.target.value)}
            placeholder={
              optimalRuns != null
                ? t("mission.config.scanRunCountAuto", { count: optimalRuns })
                : t("mission.config.scanRunCountHint")
            }
            className={inputClass}
            data-testid="scan-run-count"
          />
          {optimalRuns != null && (
            <p className="text-[11px] text-tv-text-muted mt-1" data-testid="scan-run-count-hint">
              {t("mission.config.scanRunCountAuto", { count: optimalRuns })}
            </p>
          )}
        </div>
        <div>
          <label htmlFor={sidelapId} className={labelClass}>
            <span>{t("mission.config.scanSidelap")}</span>
            <InfoHint
              text={t("mission.config.scanSidelapHelp")}
              label={t("mission.config.scanSidelap")}
              testId="hint-scan-sidelap"
            />
          </label>
          <input
            id={sidelapId}
            type="number"
            step="1"
            min="0"
            max="80"
            value={sidelap}
            onChange={(e) => onNumberChange("scan_sidelap_percent", e.target.value)}
            placeholder={String(DEFAULT_SCAN_SIDELAP)}
            className={inputClass}
            data-testid="scan-sidelap"
          />
        </div>
      </div>
    </div>
  );
}
