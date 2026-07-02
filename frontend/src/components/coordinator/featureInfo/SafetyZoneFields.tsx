import { useTranslation } from "react-i18next";
import InfoHint from "@/components/common/InfoHint";
import Input from "@/components/common/Input";
import { labelKeyOf, safetyZoneFields } from "@/config/featureFields";

interface SafetyZoneFieldsProps {
  data: Record<string, unknown>;
  val: (key: string) => string;
  handleChange: (field: string, value: string | number | boolean | null) => void;
}

export default function SafetyZoneFields({
  data,
  val,
  handleChange,
}: SafetyZoneFieldsProps) {
  /** safety-zone-type fields for the feature info panel. */
  const { t } = useTranslation();

  return (
    <>
      <Input
        id="feat-name"
        label={t(labelKeyOf(safetyZoneFields, "name"))}
        hint={t("coordinator.detail.zoneNameHelp")}
        value={val("name")}
        onChange={(e) => handleChange("name", e.target.value)}
      />
      <div>
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t(labelKeyOf(safetyZoneFields, "type"))}</span>
          <InfoHint
            text={t("coordinator.detail.zoneTypeHelp")}
            label={t("coordinator.detail.zoneType")}
            testId="hint-feat-zone-type"
          />
        </label>
        <select
          value={val("type")}
          onChange={(e) => handleChange("type", e.target.value)}
          className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
        >
          <option value="CTR">{t("coordinator.detail.zoneTypes.ctr")}</option>
          <option value="RESTRICTED">{t("coordinator.detail.zoneTypes.restricted")}</option>
          <option value="PROHIBITED">{t("coordinator.detail.zoneTypes.prohibited")}</option>
          <option value="TEMPORARY_NO_FLY">{t("coordinator.detail.zoneTypes.temporaryNoFly")}</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Input
          id="feat-floor"
          label={t(labelKeyOf(safetyZoneFields, "altitude_floor"))}
          hint={t("coordinator.detail.zoneFloorHelp")}
          type="number"
          value={val("altitude_floor")}
          onChange={(e) => handleChange("altitude_floor", e.target.value === "" ? null : parseFloat(e.target.value))}
        />
        <Input
          id="feat-ceiling"
          label={t(labelKeyOf(safetyZoneFields, "altitude_ceiling"))}
          hint={t("coordinator.detail.zoneCeilingHelp")}
          type="number"
          value={val("altitude_ceiling")}
          onChange={(e) => handleChange("altitude_ceiling", e.target.value === "" ? null : parseFloat(e.target.value))}
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-tv-text-primary">
        <input
          type="checkbox"
          checked={Boolean(data.is_active)}
          onChange={(e) => handleChange("is_active", e.target.checked)}
          className="accent-tv-accent"
        />
        <span>{t(labelKeyOf(safetyZoneFields, "is_active"))}</span>
        <InfoHint
          text={t("coordinator.detail.zoneActiveHelp")}
          label={t("coordinator.detail.zoneActive")}
          testId="hint-feat-zone-active"
        />
      </label>
    </>
  );
}
