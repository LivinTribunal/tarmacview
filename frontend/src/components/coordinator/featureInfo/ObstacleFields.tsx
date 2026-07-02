import { useTranslation } from "react-i18next";
import InfoHint from "@/components/common/InfoHint";
import Input from "@/components/common/Input";
import { labelKeyOf, obstacleFields } from "@/config/featureFields";
import RecalculateBlock, { type RecalcPreview } from "./RecalculateBlock";

interface ObstacleFieldsProps {
  val: (key: string) => string;
  handleChange: (field: string, value: string | number | boolean | null) => void;
  airportId?: string;
  recalcLoading: boolean;
  recalcError: string | null;
  recalcPreview: RecalcPreview | null;
  onRecalculate: () => void;
  onApplyRecalculate: () => void;
  onCancelRecalculate: () => void;
}

export default function ObstacleFields({
  val,
  handleChange,
  airportId,
  recalcLoading,
  recalcError,
  recalcPreview,
  onRecalculate,
  onApplyRecalculate,
  onCancelRecalculate,
}: ObstacleFieldsProps) {
  /** obstacle-type fields for the feature info panel. */
  const { t } = useTranslation();

  return (
    <>
      <Input
        id="feat-name"
        label={t(labelKeyOf(obstacleFields, "name"))}
        hint={t("coordinator.detail.obstacleNameHelp")}
        value={val("name")}
        onChange={(e) => handleChange("name", e.target.value)}
      />
      <div>
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t(labelKeyOf(obstacleFields, "type"))}</span>
          <InfoHint
            text={t("coordinator.detail.obstacleTypeHelp")}
            label={t("coordinator.detail.obstacleType")}
            testId="hint-feat-obstacle-type"
          />
        </label>
        <select
          value={val("type")}
          onChange={(e) => handleChange("type", e.target.value)}
          className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
        >
          <option value="BUILDING">{t("coordinator.detail.obstacleTypes.building")}</option>
          <option value="ANTENNA">{t("coordinator.detail.obstacleTypes.antenna")}</option>
          <option value="VEGETATION">{t("coordinator.detail.obstacleTypes.vegetation")}</option>
          <option value="TOWER">{t("coordinator.detail.obstacleTypes.tower")}</option>
          <option value="OTHER">{t("coordinator.detail.obstacleTypes.other")}</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Input
          id="feat-height"
          label={t(labelKeyOf(obstacleFields, "height"))}
          hint={t("coordinator.detail.obstacleHeightHelp")}
          type="number"
          value={val("height")}
          onChange={(e) => handleChange("height", e.target.value === "" ? null : parseFloat(e.target.value))}
        />
        <Input
          id="feat-buffer-distance"
          label={t(labelKeyOf(obstacleFields, "buffer_distance"))}
          hint={t("coordinator.detail.bufferDistanceHelp")}
          type="number"
          value={val("buffer_distance")}
          onChange={(e) => handleChange("buffer_distance", e.target.value === "" ? null : parseFloat(e.target.value))}
        />
      </div>
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
    </>
  );
}
