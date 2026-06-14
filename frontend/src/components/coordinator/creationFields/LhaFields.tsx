import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import InfoHint from "@/components/common/InfoHint";
import Input from "@/components/common/Input";
import { formatAglDisplayName } from "@/utils/agl";
import type { AGLResponse } from "@/types/airport";

interface LhaFieldsProps {
  allAgls: (AGLResponse & { surfaceId: string })[];
  lhaAglId: string;
  setLhaAglId: Dispatch<SetStateAction<string>>;
  papiSlotsExhausted: boolean;
  nextDesignator: string | null;
  lhaSettingAngle: string;
  setLhaSettingAngle: Dispatch<SetStateAction<string>>;
  lhaLampType: string;
  setLhaLampType: Dispatch<SetStateAction<string>>;
  lhaTolerance: string;
  setLhaTolerance: Dispatch<SetStateAction<string>>;
  isPapi: boolean;
  lhaLensMsl: string;
  setLhaLensMsl: Dispatch<SetStateAction<string>>;
  lhaLensAgl: string;
  setLhaLensAgl: Dispatch<SetStateAction<string>>;
  manualLat: string;
  setManualLat: Dispatch<SetStateAction<string>>;
  manualLon: string;
  setManualLon: Dispatch<SetStateAction<string>>;
  altLoading: boolean;
  manualAlt: string;
  handleAltChange: (value: string) => void;
  altFallback: boolean;
}

/** LHA creation fields: parent AGL, setting angle, lamp type, tolerance, position. */
export default function LhaFields({
  allAgls,
  lhaAglId,
  setLhaAglId,
  papiSlotsExhausted,
  nextDesignator,
  lhaSettingAngle,
  setLhaSettingAngle,
  lhaLampType,
  setLhaLampType,
  lhaTolerance,
  setLhaTolerance,
  isPapi,
  lhaLensMsl,
  setLhaLensMsl,
  lhaLensAgl,
  setLhaLensAgl,
  manualLat,
  setManualLat,
  manualLon,
  setManualLon,
  altLoading,
  manualAlt,
  handleAltChange,
  altFallback,
}: LhaFieldsProps) {
  const { t } = useTranslation();
  return (
    <>
      <div>
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t("coordinator.creation.parentAgl")}</span>
          <InfoHint
            text={t("coordinator.creation.parentAglHelp")}
            label={t("coordinator.creation.parentAgl")}
            testId="hint-creation-parent-agl"
          />
        </label>
        <select
          value={lhaAglId}
          onChange={(e) => setLhaAglId(e.target.value)}
          className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
        >
          <option value="">{t("coordinator.creation.selectAgl")}</option>
          {allAgls.map((a) => (
            <option key={a.id} value={a.id}>
              {formatAglDisplayName(a)}
            </option>
          ))}
        </select>
      </div>
      {lhaAglId && (
        <p className={`text-[10px] ${papiSlotsExhausted ? "text-tv-error" : "text-tv-text-muted"}`}>
          {papiSlotsExhausted
            ? t("coordinator.creation.allPapiSlotsUsed")
            : `${t("coordinator.creation.unitDesignator")}: ${nextDesignator}`}
        </p>
      )}
      <Input
        id="create-lha-angle"
        label={t("coordinator.detail.lhaSettingAngle")}
        hint={t("coordinator.detail.lhaSettingAngleHelp")}
        type="number"
        step="0.1"
        value={lhaSettingAngle}
        onChange={(e) => setLhaSettingAngle(e.target.value)}
        disabled={!lhaAglId}
        className="disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <div>
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t("coordinator.detail.lhaLampType")}</span>
          <InfoHint
            text={t("coordinator.detail.lhaLampTypeHelp")}
            label={t("coordinator.detail.lhaLampType")}
            testId="hint-creation-lha-lamp-type"
          />
        </label>
        <select
          value={lhaLampType}
          onChange={(e) => setLhaLampType(e.target.value)}
          disabled={!lhaAglId}
          className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="HALOGEN">{t("coordinator.detail.lampTypes.halogen")}</option>
          <option value="LED">{t("coordinator.detail.lampTypes.led")}</option>
        </select>
      </div>
      <Input
        id="create-lha-tolerance"
        label={t("coordinator.detail.lhaTolerance")}
        hint={t("coordinator.detail.lhaToleranceHelp")}
        type="number"
        step="0.1"
        value={lhaTolerance}
        onChange={(e) => setLhaTolerance(e.target.value)}
        disabled={!lhaAglId}
        className="disabled:opacity-50 disabled:cursor-not-allowed"
      />
      {isPapi && (
        <div className="flex flex-col gap-1.5">
          <Input
            id="create-lha-lens-msl"
            label={t("coordinator.detail.lhaLensMsl")}
            hint={t("coordinator.detail.lhaLensMslHelp")}
            type="number"
            step="0.01"
            value={lhaLensMsl}
            onChange={(e) => setLhaLensMsl(e.target.value)}
            disabled={!lhaAglId}
            className="disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="creation-lha-lens-msl"
          />
          <Input
            id="create-lha-lens-agl"
            label={t("coordinator.detail.lhaLensAgl")}
            hint={t("coordinator.detail.lhaLensAglHelp")}
            type="number"
            step="0.01"
            value={lhaLensAgl}
            onChange={(e) => setLhaLensAgl(e.target.value)}
            disabled={!lhaAglId}
            className="disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="creation-lha-lens-agl"
          />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Input id="create-lha-lat" label={t("map.coordinates.lat")} hint={t("map.coordinates.latHelp")} type="number" step="0.000001"
          value={manualLat} onChange={(e) => setManualLat(e.target.value)}
          disabled={!lhaAglId}
          className="disabled:opacity-50 disabled:cursor-not-allowed" />
        <Input id="create-lha-lon" label={t("map.coordinates.lon")} hint={t("map.coordinates.lonHelp")} type="number" step="0.000001"
          value={manualLon} onChange={(e) => setManualLon(e.target.value)}
          disabled={!lhaAglId}
          className="disabled:opacity-50 disabled:cursor-not-allowed" />
        <Input
          id="create-lha-alt"
          label={t("coordinator.creation.altitude")}
          hint={t("coordinator.creation.altitudeHelp")}
          type="number"
          step="0.01"
          value={altLoading ? "" : manualAlt}
          onChange={(e) => handleAltChange(e.target.value)}
          placeholder={altLoading ? t("coordinator.creation.altitudeLoading") : undefined}
          disabled={!lhaAglId || altLoading}
          className="disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="creation-lha-alt"
        />
        {altFallback && !altLoading && (
          <p
            className="text-[10px] text-tv-text-muted"
            data-testid="creation-lha-alt-fallback"
          >
            ({t("coordinator.creation.altitudeFallback")})
          </p>
        )}
      </div>
    </>
  );
}
