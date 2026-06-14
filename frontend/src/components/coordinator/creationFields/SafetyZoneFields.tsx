import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import InfoHint from "@/components/common/InfoHint";
import Input from "@/components/common/Input";

interface SafetyZoneFieldsProps {
  isAirportBoundary: boolean;
  safetyZoneTypeLabel: string;
  altFloor: string;
  setAltFloor: Dispatch<SetStateAction<string>>;
  altCeiling: string;
  setAltCeiling: Dispatch<SetStateAction<string>>;
  isActive: boolean;
  setIsActive: Dispatch<SetStateAction<boolean>>;
  prefilledArea?: number;
}

/** safety zone creation fields: zone type label, altitude floor/ceiling, active flag. */
export default function SafetyZoneFields({
  isAirportBoundary,
  safetyZoneTypeLabel,
  altFloor,
  setAltFloor,
  altCeiling,
  setAltCeiling,
  isActive,
  setIsActive,
  prefilledArea,
}: SafetyZoneFieldsProps) {
  const { t } = useTranslation();
  return (
    <>
      {!isAirportBoundary && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-tv-text-secondary">{t("coordinator.detail.zoneType")}:</span>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-medium border"
            style={{
              borderColor: "var(--tv-accent)",
              color: "var(--tv-accent)",
            }}
          >
            {safetyZoneTypeLabel}
          </span>
        </div>
      )}
      {!isAirportBoundary && (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <Input
              id="create-alt-floor"
              label={t("coordinator.creation.altitudeFloor")}
              hint={t("coordinator.creation.altitudeFloorHelp")}
              type="number"
              value={altFloor}
              onChange={(e) => setAltFloor(e.target.value)}
            />
            <Input
              id="create-alt-ceiling"
              label={t("coordinator.creation.altitudeCeiling")}
              hint={t("coordinator.creation.altitudeCeilingHelp")}
              type="number"
              value={altCeiling}
              onChange={(e) => setAltCeiling(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-tv-text-primary">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="accent-tv-accent"
            />
            <span>{t("coordinator.creation.active")}</span>
            <InfoHint
              text={t("coordinator.creation.activeHelp")}
              label={t("coordinator.creation.active")}
              testId="hint-creation-active"
            />
          </label>
        </>
      )}
      {prefilledArea != null && (
        <p className="text-[10px] text-tv-text-muted">
          {t("coordinator.creation.area")}: {Math.round(prefilledArea)} m²
        </p>
      )}
    </>
  );
}
