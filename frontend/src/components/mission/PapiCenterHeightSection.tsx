import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { InspectionConfigOverride } from "@/types/mission";
import type { PapiCenterHeightReference } from "@/types/enums";
import InfoHint from "@/components/common/InfoHint";
import FormSection from "@/components/common/FormSection";

interface PapiCenterHeightSectionProps {
  papiCenterHeightReference: PapiCenterHeightReference;
  papiCenterHeightCustomM: number | "";
  configOverride: InspectionConfigOverride;
  onChange: (override: InspectionConfigOverride) => void;
  onNumberChange: (field: keyof InspectionConfigOverride, raw: string) => void;
}

export default function PapiCenterHeightSection({
  papiCenterHeightReference,
  papiCenterHeightCustomM,
  configOverride,
  onChange,
  onNumberChange,
}: PapiCenterHeightSectionProps) {
  /** PAPI center-height reference selector + conditional custom-height input. */
  const { t } = useTranslation();
  const customHeightId = useId();
  return (
    <FormSection
      title={t("mission.config.papiCenterHeight.label")}
      testId="papi-center-height-section"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
            <span>{t("mission.config.papiCenterHeight.label")}</span>
            <InfoHint
              text={t("mission.config.papiCenterHeight.help")}
              label={t("mission.config.papiCenterHeight.label")}
              testId="hint-inspection-papi-center-height"
            />
          </label>
          <select
            value={papiCenterHeightReference}
            onChange={(e) =>
              onChange({
                ...configOverride,
                papi_center_height_reference: e.target
                  .value as PapiCenterHeightReference,
              })
            }
            className="w-full appearance-none pl-3 pr-7 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%23888%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat"
            data-testid="inspection-papi-center-height-reference"
          >
            <option value="GROUND">{t("mission.config.papiCenterHeight.ground")}</option>
            <option value="LENS">{t("mission.config.papiCenterHeight.lens")}</option>
            <option value="CUSTOM">{t("mission.config.papiCenterHeight.custom")}</option>
          </select>
        </div>
        {papiCenterHeightReference === "CUSTOM" && (
          <div>
            <label
              htmlFor={customHeightId}
              className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
            >
              <span>{t("mission.config.papiCenterHeight.customHeight")}</span>
              <InfoHint
                text={t("mission.config.papiCenterHeight.customHeightHelp")}
                label={t("mission.config.papiCenterHeight.customHeight")}
                testId="hint-inspection-papi-center-height-custom"
              />
            </label>
            <input
              id={customHeightId}
              type="number"
              step="0.1"
              min="0"
              value={papiCenterHeightCustomM}
              onChange={(e) =>
                onNumberChange("papi_center_height_custom_m", e.target.value)
              }
              placeholder={t("mission.config.papiCenterHeight.customHeightHint")}
              className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
              data-testid="inspection-papi-center-height-custom"
            />
          </div>
        )}
      </div>
    </FormSection>
  );
}
