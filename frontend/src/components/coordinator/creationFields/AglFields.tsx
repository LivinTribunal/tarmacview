import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import InfoHint from "@/components/common/InfoHint";
import Input from "@/components/common/Input";
import type { SurfaceResponse } from "@/types/airport";

interface AglFieldsProps {
  surfaces: SurfaceResponse[];
  surfaceId: string;
  setSurfaceId: Dispatch<SetStateAction<string>>;
  aglType: "PAPI" | "RUNWAY_EDGE_LIGHTS";
  setAglType: Dispatch<SetStateAction<"PAPI" | "RUNWAY_EDGE_LIGHTS">>;
  aglSide: string;
  setAglSide: Dispatch<SetStateAction<string>>;
  glideSlopeAngle: string;
  setGlideSlopeAngle: Dispatch<SetStateAction<string>>;
  distFromThreshold: string;
  onDistFromThresholdChange: (value: string) => void;
  manualLat: string;
  setManualLat: Dispatch<SetStateAction<string>>;
  manualLon: string;
  setManualLon: Dispatch<SetStateAction<string>>;
  altLoading: boolean;
  manualAlt: string;
  handleAltChange: (value: string) => void;
  altFallback: boolean;
}

/** AGL creation fields: surface, type, side, glide slope, position. */
export default function AglFields({
  surfaces,
  surfaceId,
  setSurfaceId,
  aglType,
  setAglType,
  aglSide,
  setAglSide,
  glideSlopeAngle,
  setGlideSlopeAngle,
  distFromThreshold,
  onDistFromThresholdChange,
  manualLat,
  setManualLat,
  manualLon,
  setManualLon,
  altLoading,
  manualAlt,
  handleAltChange,
  altFallback,
}: AglFieldsProps) {
  const { t } = useTranslation();
  return (
    <>
      {surfaces.length > 0 ? (
        <div>
          <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
            <span>{t("coordinator.creation.surface")}</span>
            <InfoHint
              text={t("coordinator.creation.surfaceHelp")}
              label={t("coordinator.creation.surface")}
              testId="hint-creation-agl-surface"
            />
          </label>
          <select
            value={surfaceId}
            onChange={(e) => setSurfaceId(e.target.value)}
            className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
          >
            <option value="">{t("coordinator.creation.selectSurface")}</option>
            {surfaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.surface_type === "RUNWAY" ? "RWY" : "TWY"} {s.identifier}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div
          className="flex items-center gap-2 p-3 rounded-2xl border border-tv-warning bg-tv-warning/10"
          data-testid="creation-no-runway-warning"
        >
          <AlertTriangle className="h-4 w-4 text-tv-warning flex-shrink-0" />
          <p className="text-xs text-tv-warning">
            {t("coordinator.creation.noRunwayWarning")}
          </p>
        </div>
      )}
      <div>
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t("coordinator.creation.aglType")}</span>
          <InfoHint
            text={t("coordinator.creation.aglTypeHelp")}
            label={t("coordinator.creation.aglType")}
            testId="hint-creation-agl-type"
          />
        </label>
        <select
          value={aglType}
          onChange={(e) => setAglType(e.target.value as "PAPI" | "RUNWAY_EDGE_LIGHTS")}
          disabled={!surfaceId}
          className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="creation-agl-type-select"
        >
          <option value="PAPI">PAPI</option>
          <option value="RUNWAY_EDGE_LIGHTS">{t("coordinator.agl.runwayEdgeLights")}</option>
        </select>
      </div>
      <div>
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t("coordinator.creation.aglSide")}</span>
          <InfoHint
            text={t("coordinator.creation.aglSideHelp")}
            label={t("coordinator.creation.aglSide")}
            testId="hint-creation-agl-side"
          />
        </label>
        <select
          value={aglSide}
          onChange={(e) => setAglSide(e.target.value)}
          disabled={!surfaceId}
          className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="LEFT">{t("coordinator.detail.aglSides.left")}</option>
          <option value="RIGHT">{t("coordinator.detail.aglSides.right")}</option>
        </select>
      </div>
      {/* glide slope is PAPI-only - edge lights have no defined approach beam */}
      {aglType === "PAPI" && (
        <Input
          id="create-glide"
          label={t("coordinator.creation.glideSlopeAngle")}
          hint={t("coordinator.creation.glideSlopeAngleHelp")}
          type="number"
          step="0.1"
          value={glideSlopeAngle}
          onChange={(e) => setGlideSlopeAngle(e.target.value)}
          disabled={!surfaceId}
          className="disabled:opacity-50 disabled:cursor-not-allowed"
        />
      )}
      <Input
        id="create-dist"
        label={t("coordinator.creation.distanceFromThreshold")}
        hint={t("coordinator.creation.distanceFromThresholdHelp")}
        type="number"
        value={distFromThreshold}
        onChange={(e) => onDistFromThresholdChange(e.target.value)}
        disabled={!surfaceId}
        className="disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <div className="flex flex-col gap-1.5">
        <Input id="create-lat" label={t("map.coordinates.lat")} hint={t("map.coordinates.latHelp")} type="number" step="0.000001"
          value={manualLat} onChange={(e) => setManualLat(e.target.value)}
          disabled={!surfaceId}
          className="disabled:opacity-50 disabled:cursor-not-allowed" />
        <Input id="create-lon" label={t("map.coordinates.lon")} hint={t("map.coordinates.lonHelp")} type="number" step="0.000001"
          value={manualLon} onChange={(e) => setManualLon(e.target.value)}
          disabled={!surfaceId}
          className="disabled:opacity-50 disabled:cursor-not-allowed" />
        <Input
          id="create-alt"
          label={t("coordinator.creation.altitude")}
          hint={t("coordinator.creation.altitudeHelp")}
          type="number"
          step="0.01"
          value={altLoading ? "" : manualAlt}
          onChange={(e) => handleAltChange(e.target.value)}
          placeholder={altLoading ? t("coordinator.creation.altitudeLoading") : undefined}
          disabled={!surfaceId || altLoading}
          className="disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="creation-agl-alt"
        />
        {altFallback && !altLoading && (
          <p
            className="text-[10px] text-tv-text-muted"
            data-testid="creation-agl-alt-fallback"
          >
            ({t("coordinator.creation.altitudeFallback")})
          </p>
        )}
      </div>
    </>
  );
}
