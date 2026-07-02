import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, ArrowLeftRight } from "lucide-react";
import InfoHint from "@/components/common/InfoHint";
import Input from "@/components/common/Input";
import type { SurfaceResponse, AGLResponse } from "@/types/airport";
import type { PointZ } from "@/types/common";
import { reverseLHAs } from "@/api/airports";
import QuickLhaSetup from "../QuickLhaSetup";
import PointCoordEditor from "./PointCoordEditor";

interface AglFieldsProps {
  data: Record<string, unknown>;
  agl: AGLResponse;
  val: (key: string) => string;
  handleChange: (field: string, value: string | number | boolean | null) => void;
  onUpdate: (data: Record<string, unknown>) => void;
  surfaces?: SurfaceResponse[];
  airportId?: string;
  onAddLha?: (aglId: string) => void;
  onLhasGenerated?: () => Promise<void> | void;
  pickingLha?: "first" | "last" | null;
  onPickLhaToggle?: (which: "first" | "last") => void;
  pickedLhaCoord?: { which: "first" | "last"; lat: number; lon: number; alt: number } | null;
  onPickedLhaConsumed?: () => void;
}

export default function AglFields({
  data,
  agl,
  val,
  handleChange,
  onUpdate,
  surfaces,
  airportId,
  onAddLha,
  onLhasGenerated,
  pickingLha,
  onPickLhaToggle,
  pickedLhaCoord,
  onPickedLhaConsumed,
}: AglFieldsProps) {
  /** agl-type fields for the feature info panel. */
  const { t } = useTranslation();
  const [reversing, setReversing] = useState(false);
  const [reverseError, setReverseError] = useState<string | null>(null);

  // reverse is a PAPI-only, whole-row flip and needs at least two lights to flip
  const canReverse = agl.agl_type === "PAPI" && agl.lhas.length >= 2;

  async function handleReverse() {
    /** flip the PAPI agl numbering A,B,C,D -> D,C,B,A, then refetch. */
    if (!airportId) return;
    setReverseError(null);
    setReversing(true);
    try {
      await reverseLHAs(airportId, agl.surface_id, agl.id);
      if (onLhasGenerated) await onLhasGenerated();
    } catch (e) {
      setReverseError(
        e instanceof Error && e.message
          ? e.message
          : t("coordinator.detail.reverseNumberingError"),
      );
    } finally {
      setReversing(false);
    }
  }

  return (
    <>
      <Input
        id="feat-name"
        label={t("coordinator.detail.aglName")}
        hint={t("coordinator.detail.aglNameHelp")}
        value={val("name")}
        onChange={(e) => handleChange("name", e.target.value)}
      />
      {surfaces && surfaces.length > 0 && (
        <div>
          <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
            <span>{t("coordinator.detail.aglSurface")}</span>
            <InfoHint
              text={t("coordinator.detail.aglSurfaceHelp")}
              label={t("coordinator.detail.aglSurface")}
              testId="hint-feat-agl-surface"
            />
          </label>
          <select
            value={val("surface_id")}
            onChange={(e) => handleChange("surface_id", e.target.value)}
            className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
          >
            <option value="">—</option>
            {surfaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.surface_type === "RUNWAY" ? "RWY" : "TWY"} {s.identifier}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t("coordinator.detail.aglType")}</span>
          <InfoHint
            text={t("coordinator.detail.aglTypeHelp")}
            label={t("coordinator.detail.aglType")}
            testId="hint-feat-agl-type"
          />
        </label>
        <select
          value={val("agl_type")}
          onChange={(e) => {
            const next = e.target.value;
            if (
              next === "RUNWAY_EDGE_LIGHTS" &&
              (data.glide_slope_angle != null ||
                data.glide_slope_angle_tolerance != null ||
                data.ils_harmonization_tolerance != null ||
                data.meht_height_m != null)
            ) {
              onUpdate({
                agl_type: next,
                glide_slope_angle: null,
                glide_slope_angle_tolerance: null,
                ils_harmonization_tolerance: null,
                meht_height_m: null,
              });
            } else {
              handleChange("agl_type", next);
            }
          }}
          className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
          data-testid="feat-agl-type-select"
        >
          <option value="PAPI">PAPI</option>
          <option value="RUNWAY_EDGE_LIGHTS">{t("coordinator.agl.runwayEdgeLights")}</option>
        </select>
      </div>
      <div>
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t("coordinator.detail.aglSide")}</span>
          <InfoHint
            text={t("coordinator.detail.aglSideHelp")}
            label={t("coordinator.detail.aglSide")}
            testId="hint-feat-agl-side"
          />
        </label>
        <select
          value={val("side")}
          onChange={(e) => handleChange("side", e.target.value)}
          className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
        >
          <option value="">—</option>
          <option value="LEFT">{t("coordinator.detail.aglSides.left")}</option>
          <option value="RIGHT">{t("coordinator.detail.aglSides.right")}</option>
        </select>
      </div>
      {val("agl_type") === "PAPI" && (
        <Input
          id="feat-glide"
          label={t("coordinator.detail.aglGlideAngle")}
          hint={t("coordinator.detail.aglGlideAngleHelp")}
          type="number"
          step="0.1"
          value={val("glide_slope_angle")}
          onChange={(e) => handleChange("glide_slope_angle", e.target.value === "" ? null : parseFloat(e.target.value))}
        />
      )}
      {val("agl_type") === "PAPI" && (
        <Input
          id="feat-glide-tolerance"
          label={t("coordinator.detail.aglGlideTolerance")}
          hint={t("coordinator.detail.aglGlideToleranceHelp")}
          type="number"
          step="0.1"
          value={val("glide_slope_angle_tolerance")}
          onChange={(e) => handleChange("glide_slope_angle_tolerance", e.target.value === "" ? null : parseFloat(e.target.value))}
        />
      )}
      {val("agl_type") === "PAPI" && (
        <Input
          id="feat-ils-tolerance"
          label={t("coordinator.detail.aglIlsTolerance")}
          hint={t("coordinator.detail.aglIlsToleranceHelp")}
          type="number"
          step="0.01"
          value={val("ils_harmonization_tolerance")}
          onChange={(e) =>
            handleChange(
              "ils_harmonization_tolerance",
              e.target.value === "" ? null : parseFloat(e.target.value),
            )
          }
        />
      )}
      {val("agl_type") === "PAPI" && (
        <Input
          id="feat-dist-threshold"
          label={t("coordinator.detail.aglDistance")}
          hint={t("coordinator.detail.aglDistanceHelp")}
          type="number"
          step="0.1"
          value={val("distance_from_threshold")}
          onChange={(e) => handleChange("distance_from_threshold", e.target.value === "" ? null : parseFloat(e.target.value))}
        />
      )}
      {val("agl_type") === "PAPI" && (
        <Input
          id="feat-meht-height"
          label={t("coordinator.detail.aglMehtHeight")}
          hint={t("coordinator.detail.aglMehtHeightHelp")}
          type="number"
          step="0.1"
          value={val("meht_height_m")}
          onChange={(e) => handleChange("meht_height_m", e.target.value === "" ? null : parseFloat(e.target.value))}
        />
      )}
      <PointCoordEditor
        position={(data.position as PointZ | undefined) ?? null}
        onChange={(coords) => {
          const newPos = { type: "Point" as const, coordinates: coords };
          onUpdate({ position: newPos, preserve_altitude: true });
        }}
      />
      {onAddLha && (
        <button
          type="button"
          onClick={() => onAddLha(String(data.id))}
          className="flex items-center justify-center gap-1.5 w-full mt-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-tv-accent text-tv-accent hover:bg-tv-surface-hover transition-colors"
          data-testid="add-lha-button"
        >
          <Plus className="h-3 w-3" />
          {t("coordinator.detail.addLha")}
        </button>
      )}
      {airportId && canReverse && (
        <>
          <button
            type="button"
            onClick={handleReverse}
            disabled={reversing}
            className="flex items-center justify-center gap-1.5 w-full mt-1 px-3 py-1.5 rounded-full text-xs font-semibold border border-tv-accent text-tv-accent hover:bg-tv-surface-hover transition-colors disabled:opacity-50"
            data-testid="reverse-lhas-button"
          >
            <ArrowLeftRight className="h-3 w-3" />
            {t("coordinator.detail.reverseNumbering")}
          </button>
          <p className="text-[10px] text-tv-text-muted">
            {t("coordinator.detail.reverseNumberingHint")}
          </p>
          {reverseError && <p className="text-[10px] text-tv-error">{reverseError}</p>}
        </>
      )}
      {airportId && (
        <QuickLhaSetup
          airportId={airportId}
          agl={agl}
          surfaces={surfaces ?? []}
          onGenerated={onLhasGenerated}
          pickingLha={pickingLha ?? null}
          onPickLhaToggle={onPickLhaToggle}
          pickedLhaCoord={pickedLhaCoord ?? null}
          onPickedLhaConsumed={onPickedLhaConsumed}
        />
      )}
    </>
  );
}
