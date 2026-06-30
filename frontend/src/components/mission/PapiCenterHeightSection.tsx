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

const REFERENCE_OPTIONS = [
  { key: "GROUND", labelKey: "mission.config.papiCenterHeight.ground" },
  { key: "LENS", labelKey: "mission.config.papiCenterHeight.lens" },
  { key: "CUSTOM", labelKey: "mission.config.papiCenterHeight.custom" },
] as const;

export default function PapiCenterHeightSection({
  papiCenterHeightReference,
  papiCenterHeightCustomM,
  configOverride,
  onChange,
  onNumberChange,
}: PapiCenterHeightSectionProps) {
  /** PAPI center-height reference toggle + conditional custom-height input. */
  const { t } = useTranslation();
  const customHeightId = useId();
  const referenceToggle = (
    <div
      className="inline-flex rounded-full border border-tv-border bg-tv-surface p-0.5 text-xs"
      data-testid="inspection-papi-center-height-reference"
    >
      {REFERENCE_OPTIONS.map(({ key, labelKey }) => {
        const active = papiCenterHeightReference === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() =>
              onChange({ ...configOverride, papi_center_height_reference: key })
            }
            className={`px-3 py-1 rounded-full transition-colors ${active ? "bg-tv-accent text-white font-medium" : "text-tv-text-secondary hover:text-tv-text-primary"}`}
            data-testid={`inspection-papi-center-height-reference-${key.toLowerCase()}`}
          >
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
  return (
    <FormSection
      title={t("mission.config.papiCenterHeight.label")}
      hint={t("mission.config.papiCenterHeight.help")}
      testId="papi-center-height-section"
      meta={referenceToggle}
    >
      {papiCenterHeightReference === "CUSTOM" && (
        <div className="grid grid-cols-2 gap-3">
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
        </div>
      )}
    </FormSection>
  );
}
