import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { InspectionConfigOverride } from "@/types/mission";
import InfoHint from "@/components/common/InfoHint";
import { VP_DEFAULT_START_DEG, VP_DEFAULT_END_DEG } from "@/constants/mission";

interface VerticalProfileGeometryProps {
  angleSource: "PAPI" | "CUSTOM";
  disabled: boolean;
  verticalProfilePapiMissing: string[];
  angleOffsetBelow: number | "";
  angleOffsetAbove: number | "";
  angleStart: number | "";
  angleEnd: number | "";
  verticalProfilePreview: { start: number; end: number } | null;
  configOverride: InspectionConfigOverride;
  onChange: (override: InspectionConfigOverride) => void;
  onNumberChange: (field: keyof InspectionConfigOverride, raw: string) => void;
}

export default function VerticalProfileGeometry({
  angleSource,
  disabled,
  verticalProfilePapiMissing,
  angleOffsetBelow,
  angleOffsetAbove,
  angleStart,
  angleEnd,
  verticalProfilePreview,
  configOverride,
  onChange,
  onNumberChange,
}: VerticalProfileGeometryProps) {
  /** vertical-profile angle source toggle, offsets/custom band, and scan preview. */
  const { t } = useTranslation();
  const offsetBelowId = useId();
  const offsetAboveId = useId();
  const angleStartId = useId();
  const angleEndId = useId();
  return (
    <div className="col-span-2 grid gap-3" data-testid="vertical-profile-fields">
      <div>
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t("mission.config.angleSource")}</span>
          <InfoHint
            text={t("mission.config.angleSourceHelp")}
            label={t("mission.config.angleSource")}
            testId="hint-inspection-angle-source"
          />
        </label>
        <fieldset
          className="inline-flex min-w-0 gap-1 rounded-full border border-tv-border p-1"
          aria-label={t("mission.config.angleSource")}
        >
          <button
            type="button"
            disabled={disabled || verticalProfilePapiMissing.length > 0}
            onClick={() =>
              onChange({ ...configOverride, angle_source: "PAPI" })
            }
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              angleSource === "PAPI"
                ? "bg-tv-accent text-tv-bg"
                : "text-tv-text-secondary hover:text-tv-text-primary"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            data-testid="vp-angle-source-papi"
          >
            {t("mission.config.angleSourcePapi")}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              onChange({ ...configOverride, angle_source: "CUSTOM" })
            }
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              angleSource === "CUSTOM"
                ? "bg-tv-accent text-tv-bg"
                : "text-tv-text-secondary hover:text-tv-text-primary"
            }`}
            data-testid="vp-angle-source-custom"
          >
            {t("mission.config.angleSourceCustom")}
          </button>
        </fieldset>
        {verticalProfilePapiMissing.length > 0 && (
          <p className="text-[11px] text-tv-text-muted mt-1">
            {t("mission.config.angleSourcePapiUnavailable", {
              units: verticalProfilePapiMissing.join(", "),
            })}
          </p>
        )}
      </div>

      {angleSource === "PAPI" ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor={offsetBelowId}
              className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
            >
              <span>{t("mission.config.angleOffsetBelow")}</span>
              <InfoHint
                text={t("mission.config.angleOffsetBelowHelp")}
                label={t("mission.config.angleOffsetBelow")}
                testId="hint-inspection-angle-offset-below"
              />
            </label>
            <input
              id={offsetBelowId}
              type="number"
              step="0.1"
              min="0"
              max="10"
              value={angleOffsetBelow}
              onChange={(e) =>
                onNumberChange("angle_offset_below", e.target.value)
              }
              placeholder={t("mission.config.angleOffsetHint")}
              className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
              data-testid="inspection-angle-offset-below"
            />
          </div>
          <div>
            <label
              htmlFor={offsetAboveId}
              className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
            >
              <span>{t("mission.config.angleOffsetAbove")}</span>
              <InfoHint
                text={t("mission.config.angleOffsetAboveHelp")}
                label={t("mission.config.angleOffsetAbove")}
                testId="hint-inspection-angle-offset-above"
              />
            </label>
            <input
              id={offsetAboveId}
              type="number"
              step="0.1"
              min="0"
              max="10"
              value={angleOffsetAbove}
              onChange={(e) =>
                onNumberChange("angle_offset_above", e.target.value)
              }
              placeholder={t("mission.config.angleOffsetHint")}
              className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
              data-testid="inspection-angle-offset-above"
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor={angleStartId}
              className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
            >
              <span>{t("mission.config.angleStart")}</span>
              <InfoHint
                text={t("mission.config.angleStartHelp")}
                label={t("mission.config.angleStart")}
                testId="hint-inspection-angle-start"
              />
            </label>
            <input
              id={angleStartId}
              type="number"
              step="0.1"
              min="1"
              max="16.5"
              value={angleStart}
              onChange={(e) =>
                onNumberChange("angle_start", e.target.value)
              }
              placeholder={String(VP_DEFAULT_START_DEG)}
              className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
              data-testid="inspection-angle-start"
            />
          </div>
          <div>
            <label
              htmlFor={angleEndId}
              className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
            >
              <span>{t("mission.config.angleEnd")}</span>
              <InfoHint
                text={t("mission.config.angleEndHelp")}
                label={t("mission.config.angleEnd")}
                testId="hint-inspection-angle-end"
              />
            </label>
            <input
              id={angleEndId}
              type="number"
              step="0.1"
              min="1"
              max="16.5"
              value={angleEnd}
              onChange={(e) =>
                onNumberChange("angle_end", e.target.value)
              }
              placeholder={String(VP_DEFAULT_END_DEG)}
              className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
              data-testid="inspection-angle-end"
            />
          </div>
          {typeof angleStart === "number" &&
            typeof angleEnd === "number" &&
            angleStart >= angleEnd && (
              <p
                className="col-span-2 text-[11px] text-tv-warning"
                data-testid="vp-angle-band-error"
              >
                {t("mission.config.angleBandError")}
              </p>
            )}
        </div>
      )}

      {verticalProfilePreview && (
        <p
          className="text-[11px] text-tv-text-muted"
          data-testid="vp-scan-preview"
        >
          {t("mission.config.verticalProfileScanPreview", {
            start: verticalProfilePreview.start.toFixed(1),
            end: verticalProfilePreview.end.toFixed(1),
          })}
        </p>
      )}
    </div>
  );
}
