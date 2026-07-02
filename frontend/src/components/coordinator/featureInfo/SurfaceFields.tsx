import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import InfoHint from "@/components/common/InfoHint";
import Input from "@/components/common/Input";
import type { SurfaceResponse } from "@/types/airport";
import type { LineStringZ } from "@/types/common";
import { labelKeyOf, surfaceFields } from "@/config/featureFields";
import PairSurfaceSection from "../PairSurfaceSection";
import RecalculateBlock, { type RecalcPreview } from "./RecalculateBlock";
import SurfaceTouchpointSection from "./SurfaceTouchpointSection";
import ThresholdEndSection from "./ThresholdEndSection";

interface SurfaceFieldsProps {
  data: Record<string, unknown>;
  surface: SurfaceResponse;
  val: (key: string) => string;
  handleChange: (field: string, value: string | number | boolean | null) => void;
  onUpdate: (data: Record<string, unknown>) => void;
  airportId?: string;
  surfaces?: SurfaceResponse[];
  pickingTouchpoint?: boolean;
  onPickTouchpointToggle?: () => void;
  pickingThreshold?: boolean;
  onPickThresholdToggle?: () => void;
  pickingEnd?: boolean;
  onPickEndToggle?: () => void;
  recalcLoading: boolean;
  recalcError: string | null;
  recalcPreview: RecalcPreview | null;
  onRecalculate: () => void;
  onApplyRecalculate: () => void;
  onCancelRecalculate: () => void;
  onSurfacesChanged?: () => Promise<void> | void;
}

export default function SurfaceFields({
  data,
  surface,
  val,
  handleChange,
  onUpdate,
  airportId,
  surfaces,
  pickingTouchpoint,
  onPickTouchpointToggle,
  pickingThreshold,
  onPickThresholdToggle,
  pickingEnd,
  onPickEndToggle,
  recalcLoading,
  recalcError,
  recalcPreview,
  onRecalculate,
  onApplyRecalculate,
  onCancelRecalculate,
  onSurfacesChanged,
}: SurfaceFieldsProps) {
  /** surface-type fields for the feature info panel. */
  const { t } = useTranslation();

  return (
    <>
      <Input
        id="feat-identifier"
        label={t(labelKeyOf(surfaceFields, "identifier"))}
        hint={t("coordinator.detail.surfaceIdentifierHelp")}
        value={val("identifier")}
        onChange={(e) => handleChange("identifier", e.target.value)}
      />
      <div>
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t(labelKeyOf(surfaceFields, "surface_type"))}</span>
          <InfoHint
            text={t("coordinator.detail.surfaceTypeHelp")}
            label={t("coordinator.detail.surfaceType")}
            testId="hint-feat-surface-type"
          />
        </label>
        <select
          value={val("surface_type")}
          onChange={(e) => handleChange("surface_type", e.target.value)}
          className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
        >
          <option value="RUNWAY">{t("coordinator.detail.surfaceTypes.runway")}</option>
          <option value="TAXIWAY">{t("coordinator.detail.surfaceTypes.taxiway")}</option>
        </select>
      </div>
      <Input
        id="feat-heading"
        label={t(labelKeyOf(surfaceFields, "heading"))}
        hint={t("coordinator.detail.surfaceHeadingHelp")}
        type="number"
        value={val("heading")}
        onChange={(e) => handleChange("heading", e.target.value === "" ? null : parseFloat(e.target.value))}
      />
      {val("heading") && (
        <div className="flex items-center gap-2">
          <svg className="h-6 w-6 flex-shrink-0" viewBox="0 0 24 24">
            <line
              x1="12" y1="20" x2="12" y2="4"
              stroke="var(--tv-accent)" strokeWidth="2" strokeLinecap="round"
              transform={`rotate(${parseFloat(val("heading"))}, 12, 12)`}
            />
            <polygon
              points="12,2 9,8 15,8"
              fill="var(--tv-accent)"
              transform={`rotate(${parseFloat(val("heading"))}, 12, 12)`}
            />
          </svg>
          <button
            type="button"
            onClick={() => {
              const current = parseFloat(val("heading"));
              if (!isNaN(current)) handleChange("heading", (current + 180) % 360);
            }}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border border-tv-border text-tv-text-secondary hover:bg-tv-surface-hover transition-colors"
            title={t("coordinator.detail.oppositeHeading")}
          >
            <RotateCcw className="h-3 w-3" />
            {t("coordinator.detail.opposite")}
          </button>
          <span className="text-[10px] text-tv-text-muted">
            {Math.round((parseFloat(val("heading")) + 180) % 360)}°
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <Input
          id="feat-length"
          label={t(labelKeyOf(surfaceFields, "length"))}
          hint={t("coordinator.detail.surfaceLengthHelp")}
          type="number"
          value={val("length")}
          onChange={(e) => handleChange("length", e.target.value === "" ? null : parseFloat(e.target.value))}
        />
        <Input
          id="feat-width"
          label={t(labelKeyOf(surfaceFields, "width"))}
          hint={t("coordinator.detail.surfaceWidthHelp")}
          type="number"
          value={val("width")}
          onChange={(e) => handleChange("width", e.target.value === "" ? null : parseFloat(e.target.value))}
        />
      </div>
      <Input
        id="feat-surface-buffer"
        label={t(labelKeyOf(surfaceFields, "buffer_distance"))}
        hint={t("coordinator.detail.bufferDistanceHelp")}
        type="number"
        value={val("buffer_distance")}
        onChange={(e) => handleChange("buffer_distance", e.target.value === "" ? null : parseFloat(e.target.value))}
      />
      {val("surface_type") === "RUNWAY" && (
        <SurfaceTouchpointSection
          val={val}
          handleChange={handleChange}
          pickingTouchpoint={pickingTouchpoint}
          onPickTouchpointToggle={onPickTouchpointToggle}
        />
      )}
      {val("surface_type") === "RUNWAY" && (
        <ThresholdEndSection
          data={data}
          onUpdate={onUpdate}
          centerline={(data.geometry as LineStringZ | undefined)?.coordinates}
          pickingThreshold={pickingThreshold}
          onPickThresholdToggle={onPickThresholdToggle}
          pickingEnd={pickingEnd}
          onPickEndToggle={onPickEndToggle}
        />
      )}
      {airportId && (
        <RecalculateBlock
          loading={recalcLoading}
          error={recalcError}
          preview={recalcPreview}
          onRecalculate={onRecalculate}
          onApply={onApplyRecalculate}
          onCancel={onCancelRecalculate}
        />
      )}
      {airportId && surfaces && val("surface_type") === "RUNWAY" && (
        <PairSurfaceSection
          airportId={airportId}
          surface={surface}
          surfaces={surfaces}
          onChanged={async () => {
            await onSurfacesChanged?.();
          }}
        />
      )}
    </>
  );
}
