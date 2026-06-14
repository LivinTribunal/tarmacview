import { useTranslation } from "react-i18next";
import Input from "@/components/common/Input";
import InfoHint from "@/components/common/InfoHint";
import type { InspectionConfigResponse } from "@/types/inspectionTemplate";

type ConfigUpdate = Partial<Omit<InspectionConfigResponse, "id">>;

interface TemplateVerticalProfileFieldsProps {
  config: Omit<InspectionConfigResponse, "id"> | null;
  onChange: (updates: ConfigUpdate) => void;
  handleNumber: (field: keyof ConfigUpdate, raw: string) => void;
}

/** vertical-profile angle-source toggle plus PAPI/custom angle inputs. */
export default function TemplateVerticalProfileFields({
  config,
  onChange,
  handleNumber,
}: TemplateVerticalProfileFieldsProps) {
  const { t } = useTranslation();
  const angleSource: "PAPI" | "CUSTOM" = config?.angle_source ?? "CUSTOM";
  const setSource = (s: "PAPI" | "CUSTOM") => onChange({ angle_source: s });
  const startError =
    config?.angle_start != null &&
    config?.angle_end != null &&
    config.angle_start >= config.angle_end;
  return (
    <div className="flex flex-col gap-2" data-testid="template-vertical-profile-fields">
      <div>
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t("mission.config.angleSource")}</span>
          <InfoHint
            text={t("mission.config.angleSourceHelp")}
            label={t("mission.config.angleSource")}
            testId="hint-template-angle-source"
          />
        </label>
        <fieldset
          className="inline-flex min-w-0 rounded-full border border-tv-border bg-tv-bg p-0.5 text-[11px]"
          aria-label={t("mission.config.angleSource")}
        >
          {(["PAPI", "CUSTOM"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              className={`px-3 py-1 rounded-full transition-colors ${
                angleSource === s
                  ? "bg-tv-accent text-white font-medium"
                  : "text-tv-text-secondary hover:text-tv-text-primary"
              }`}
              data-testid={`template-vp-angle-source-${s.toLowerCase()}`}
            >
              {t(`mission.config.angleSource${s === "PAPI" ? "Papi" : "Custom"}`)}
            </button>
          ))}
        </fieldset>
      </div>
      {angleSource === "PAPI" ? (
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t("mission.config.angleOffsetBelow")}
            hint={t("mission.config.angleOffsetBelowHelp")}
            type="number"
            value={config?.angle_offset_below ?? ""}
            onChange={(e) => handleNumber("angle_offset_below", e.target.value)}
            step="0.1"
            min="0"
            max="10"
          />
          <Input
            label={t("mission.config.angleOffsetAbove")}
            hint={t("mission.config.angleOffsetAboveHelp")}
            type="number"
            value={config?.angle_offset_above ?? ""}
            onChange={(e) => handleNumber("angle_offset_above", e.target.value)}
            step="0.1"
            min="0"
            max="10"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t("mission.config.angleStart")}
            hint={t("mission.config.angleStartHelp")}
            type="number"
            value={config?.angle_start ?? ""}
            onChange={(e) => handleNumber("angle_start", e.target.value)}
            step="0.1"
            min="1"
            max="16.5"
          />
          <Input
            label={t("mission.config.angleEnd")}
            hint={t("mission.config.angleEndHelp")}
            type="number"
            value={config?.angle_end ?? ""}
            onChange={(e) => handleNumber("angle_end", e.target.value)}
            step="0.1"
            min="1"
            max="16.5"
          />
          {startError && (
            <p
              className="col-span-2 text-[11px] text-tv-warning"
              data-testid="template-vp-angle-band-error"
            >
              {t("mission.config.angleBandError")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
