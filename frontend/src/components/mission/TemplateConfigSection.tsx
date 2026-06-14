import { useTranslation } from "react-i18next";
import InfoHint from "@/components/common/InfoHint";
import Input from "@/components/common/Input";
import type { InspectionConfigResponse } from "@/types/inspectionTemplate";
import type { InspectionMethod } from "@/types/enums";
import type { AGLResponse } from "@/types/airport";
import { AGL_AGNOSTIC_METHODS, methodsForAgl } from "@/utils/methodAglCompatibility";
import { formatNumber } from "@/utils/format";
import TemplateAglMethodPicker from "./TemplateAglMethodPicker";
import TemplateVerticalProfileFields from "./TemplateVerticalProfileFields";

type ConfigUpdate = Partial<Omit<InspectionConfigResponse, "id">>;

interface TemplateConfigSectionProps {
  config: Omit<InspectionConfigResponse, "id"> | null;
  method: string;
  onChange: (updates: ConfigUpdate) => void;
  onMethodChange: (method: InspectionMethod) => void;
  allAgls: AGLResponse[];
  selectedAglId: string;
  onAglChange: (aglId: string) => void;
  selectedLhaIds: Set<string>;
  onToggleLha: (lhaId: string) => void;
  onSelectAllLhas: () => void;
  onDeselectAllLhas: () => void;
}

export default function TemplateConfigSection({
  config,
  method,
  onChange,
  onMethodChange,
  allAgls,
  selectedAglId,
  onAglChange,
  selectedLhaIds,
  onToggleLha,
  onSelectAllLhas,
  onDeselectAllLhas,
}: TemplateConfigSectionProps) {
  /** per-method inspection config fields with AGL/LHA selection. */
  const { t } = useTranslation();

  function handleNumber(field: keyof ConfigUpdate, raw: string) {
    const val = raw === "" ? null : parseFloat(raw);
    onChange({ [field]: val } as ConfigUpdate);
  }

  const selectedAgl = allAgls.find((a) => a.id === selectedAglId);
  const allLhasSelected = selectedAgl
    ? selectedAgl.lhas.length > 0 && selectedAgl.lhas.every((lha) => selectedLhaIds.has(lha.id))
    : false;

  // methods compatible with the selected AGL type. AGL-agnostic methods
  // (hover-point-lock, surface-scan) are the options when no AGL is picked yet.
  // legacy templates may carry a method that's no longer compatible - keep
  // it in the list so the select can still display its current value.
  const compatMethods: InspectionMethod[] = selectedAgl
    ? methodsForAgl(selectedAgl.agl_type)
    : [...AGL_AGNOSTIC_METHODS];
  const methodOptions = compatMethods.includes(method as InspectionMethod)
    ? compatMethods
    : [...compatMethods, method as InspectionMethod];
  const methodLocked =
    !selectedAglId && !AGL_AGNOSTIC_METHODS.includes(method as InspectionMethod);

  return (
    <div className="flex flex-col gap-3">
      <TemplateAglMethodPicker
        allAgls={allAgls}
        selectedAglId={selectedAglId}
        onAglChange={onAglChange}
        method={method}
        onMethodChange={onMethodChange}
        methodOptions={methodOptions}
        methodLocked={methodLocked}
        selectedAgl={selectedAgl}
        allLhasSelected={allLhasSelected}
        selectedLhaIds={selectedLhaIds}
        onToggleLha={onToggleLha}
        onSelectAllLhas={onSelectAllLhas}
        onDeselectAllLhas={onDeselectAllLhas}
      />

      <Input
        label={t("coordinator.inspections.altitudeOffset")}
        hint={t("coordinator.inspections.altitudeOffsetHelp")}
        type="number"
        value={config?.altitude_offset ?? ""}
        onChange={(e) => handleNumber("altitude_offset", e.target.value)}
        step="0.1"
      />

      <Input
        label={t("coordinator.inspections.measurementSpeedOverride")}
        hint={t("coordinator.inspections.measurementSpeedOverrideHelp")}
        type="number"
        value={config?.measurement_speed_override ?? ""}
        onChange={(e) => handleNumber("measurement_speed_override", e.target.value)}
        step="0.1"
      />

      <Input
        label={t("coordinator.inspections.measurementDensity")}
        hint={t("coordinator.inspections.measurementDensityHelp")}
        type="number"
        value={config?.measurement_density ?? ""}
        onChange={(e) => handleNumber("measurement_density", e.target.value)}
        step="1"
      />

      <Input
        label={t("coordinator.inspections.customTolerances")}
        hint={t("coordinator.inspections.customTolerancesHelp")}
        type="number"
        value={config?.custom_tolerances?.default ?? ""}
        onChange={(e) => {
          const val = e.target.value === "" ? null : parseFloat(e.target.value);
          const existing = config?.custom_tolerances ?? {};
          if (val == null) {
            const updated = { ...existing };
            delete updated.default;
            onChange({
              custom_tolerances: Object.keys(updated).length > 0 ? updated : null,
            });
            return;
          }
          onChange({ custom_tolerances: { ...existing, default: val } });
        }}
        step="0.01"
      />

      {method === "VERTICAL_PROFILE" && (
        <Input
          label={t("coordinator.inspections.hoverDuration")}
          hint={t("coordinator.inspections.hoverDurationHelp")}
          type="number"
          value={config?.hover_duration ?? ""}
          onChange={(e) => handleNumber("hover_duration", e.target.value)}
          step="0.5"
        />
      )}

      <Input
        label={t("mission.config.horizontalDistance")}
        hint={t("mission.config.horizontalDistanceHelp")}
        type="number"
        value={config?.horizontal_distance ?? ""}
        onChange={(e) => handleNumber("horizontal_distance", e.target.value)}
        step="1"
      />

      {method === "HORIZONTAL_RANGE" && (
        <Input
          label={t("mission.config.sweepAngle")}
          hint={t("mission.config.sweepAngleHelp")}
          type="number"
          value={config?.sweep_angle ?? ""}
          onChange={(e) => handleNumber("sweep_angle", e.target.value)}
          step="0.5"
        />
      )}

      {method === "HORIZONTAL_RANGE" && selectedAgl && selectedAgl.lhas.length > 0 && (
        <div className="relative">
          <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
            <span>{t("mission.config.lhaSettingAngleOverride")}</span>
            <InfoHint
              text={t("mission.config.lhaSettingAngleOverrideHelp")}
              label={t("mission.config.lhaSettingAngleOverride")}
              testId="hint-template-lha-setting-angle-override"
            />
          </label>
          <select
            value={config?.lha_setting_angle_override_id ?? ""}
            onChange={(e) =>
              onChange({ lha_setting_angle_override_id: e.target.value || null })
            }
            className="w-full px-4 py-2.5 pr-10 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors appearance-none"
          >
            <option value="">{t("mission.config.lhaSettingAngleOverrideAuto")}</option>
            {selectedAgl.lhas.map((lha) => (
              <option key={lha.id} value={lha.id}>
                {t("mission.config.unitDesignator")} {lha.unit_designator}
                {lha.setting_angle != null ? ` (${formatNumber(lha.setting_angle, 1)}°)` : ""}
              </option>
            ))}
          </select>
          <svg className="pointer-events-none absolute right-3 top-[2.1rem] h-4 w-4 text-tv-text-secondary" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
          <p className="text-[11px] text-tv-text-muted mt-1">
            {t("mission.config.lhaSettingAngleOverrideHint")}
          </p>
        </div>
      )}

      {method === "VERTICAL_PROFILE" && (
        <TemplateVerticalProfileFields
          config={config}
          onChange={onChange}
          handleNumber={handleNumber}
        />
      )}

      <Input
        label={t("mission.config.bufferDistanceOverride")}
        hint={t("mission.config.bufferDistanceOverrideHelp")}
        type="number"
        value={config?.buffer_distance ?? ""}
        onChange={(e) => handleNumber("buffer_distance", e.target.value)}
        step="0.5"
      />

      {(method === "HORIZONTAL_RANGE" ||
        method === "FLY_OVER" ||
        method === "PARALLEL_SIDE_SWEEP") && (() => {
          const direction = config?.direction ?? null;
          const setMode = (mode: "INHERIT" | "NATURAL" | "REVERSED") => {
            onChange({ direction: mode === "INHERIT" ? null : mode });
          };
          return (
            <div className="flex items-center justify-between gap-3 py-1">
              <label className="flex items-center gap-1 text-xs font-medium text-tv-text-secondary">
                <span>{t("mission.config.direction.label")}</span>
                <InfoHint
                  text={t("mission.config.direction.labelHelp")}
                  label={t("mission.config.direction.label")}
                  testId="hint-template-direction"
                />
              </label>
              <div
                className="inline-flex rounded-full border border-tv-border bg-tv-bg p-0.5 text-[10px]"
                data-testid="template-direction-mode"
              >
                {([
                  { key: "INHERIT", active: direction === null },
                  { key: "NATURAL", active: direction === "NATURAL" },
                  { key: "REVERSED", active: direction === "REVERSED" },
                ] as const).map(({ key, active }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMode(key)}
                    className={`px-3 py-1 rounded-full transition-colors ${
                      active
                        ? "bg-tv-accent text-white font-medium"
                        : "text-tv-text-secondary hover:text-tv-text-primary"
                    }`}
                    data-testid={`template-direction-mode-${key.toLowerCase()}`}
                  >
                    {t(`mission.config.direction.mode.${key.toLowerCase()}`)}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
    </div>
  );
}
