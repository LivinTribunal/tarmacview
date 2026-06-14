import { useTranslation } from "react-i18next";
import InfoHint from "@/components/common/InfoHint";
import type { InspectionMethod } from "@/types/enums";
import type { AGLResponse } from "@/types/airport";
import { formatAglDisplayName } from "@/utils/agl";
import { AGL_AGNOSTIC_METHODS } from "@/utils/methodAglCompatibility";

interface TemplateAglMethodPickerProps {
  allAgls: AGLResponse[];
  selectedAglId: string;
  onAglChange: (aglId: string) => void;
  method: string;
  onMethodChange: (method: InspectionMethod) => void;
  methodOptions: InspectionMethod[];
  methodLocked: boolean;
  selectedAgl: AGLResponse | undefined;
  allLhasSelected: boolean;
  selectedLhaIds: Set<string>;
  onToggleLha: (lhaId: string) => void;
  onSelectAllLhas: () => void;
  onDeselectAllLhas: () => void;
}

/** AGL system + method dropdowns and the LHA-units checklist for a template. */
export default function TemplateAglMethodPicker({
  allAgls,
  selectedAglId,
  onAglChange,
  method,
  onMethodChange,
  methodOptions,
  methodLocked,
  selectedAgl,
  allLhasSelected,
  selectedLhaIds,
  onToggleLha,
  onSelectAllLhas,
  onDeselectAllLhas,
}: TemplateAglMethodPickerProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* agl system dropdown */}
      <div className="relative">
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t("coordinator.inspections.selectAglSystem")}</span>
          <InfoHint
            text={t("coordinator.inspections.selectAglSystemHelp")}
            label={t("coordinator.inspections.selectAglSystem")}
            testId="hint-template-agl-system"
          />
        </label>
        <select
          value={selectedAglId}
          onChange={(e) => onAglChange(e.target.value)}
          className="w-full px-4 py-2.5 pr-10 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors appearance-none"
        >
          <option value="">{t("coordinator.inspections.selectAgl")}</option>
          {allAgls.map((agl) => (
            <option key={agl.id} value={agl.id}>
              {formatAglDisplayName(agl)}
            </option>
          ))}
        </select>
        <svg className="pointer-events-none absolute right-3 top-[2.1rem] h-4 w-4 text-tv-text-secondary" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </div>

      {/* method dropdown - hidden for AGL-agnostic methods since it's implicit */}
      {!AGL_AGNOSTIC_METHODS.includes(method as InspectionMethod) && (
      <div className="relative">
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t("coordinator.inspections.method")}</span>
          <InfoHint
            text={t("coordinator.inspections.methodHelp")}
            label={t("coordinator.inspections.method")}
            testId="hint-template-method"
          />
        </label>
        <select
          value={method}
          onChange={(e) => onMethodChange(e.target.value as InspectionMethod)}
          disabled={methodLocked}
          className="w-full px-4 py-2.5 pr-10 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {methodOptions.map((m) => (
            <option key={m} value={m}>
              {t(`map.inspectionMethod.${m}`, m)}
            </option>
          ))}
        </select>
        {methodLocked && (
          <p className="text-[11px] text-tv-text-muted mt-1">
            {t("coordinator.inspections.selectAglFirst")}
          </p>
        )}
        <svg className="pointer-events-none absolute right-3 top-[2.1rem] h-4 w-4 text-tv-text-secondary" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </div>
      )}

      {/* lha units */}
      <div>
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t("coordinator.inspections.lhaUnits")}</span>
          <InfoHint
            text={t("coordinator.inspections.lhaUnitsHelp")}
            label={t("coordinator.inspections.lhaUnits")}
            testId="hint-template-lha-units"
          />
        </label>
        {!selectedAglId ? (
          <p className="text-sm text-tv-text-muted">
            {t("coordinator.inspections.selectAglFirst")}
          </p>
        ) : selectedAgl && selectedAgl.lhas.length > 0 ? (
          <div className="ml-1">
            {selectedAgl.lhas.length > 1 && (
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={allLhasSelected ? onDeselectAllLhas : onSelectAllLhas}
                  className="text-xs text-tv-accent hover:underline"
                >
                  {allLhasSelected
                    ? t("coordinator.inspections.deselectAll")
                    : t("coordinator.inspections.selectAll")}
                </button>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              {selectedAgl.lhas.map((lha) => (
                <label
                  key={lha.id}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedLhaIds.has(lha.id)}
                    onChange={() => onToggleLha(lha.id)}
                    className="rounded accent-tv-accent"
                  />
                  <span className="text-tv-text-primary">
                    {t("coordinator.inspections.lhaUnit", { designator: lha.unit_designator })}
                  </span>
                  <span className="text-tv-text-muted text-xs">
                    {lha.setting_angle?.toFixed(2) ?? "—"}&deg;
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-tv-text-muted">
            {t("coordinator.inspections.noAglSystems")}
          </p>
        )}
      </div>
    </>
  );
}
