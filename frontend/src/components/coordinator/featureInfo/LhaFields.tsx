import { useTranslation } from "react-i18next";
import InfoHint from "@/components/common/InfoHint";
import Input from "@/components/common/Input";
import type { SurfaceResponse } from "@/types/airport";
import type { PointZ } from "@/types/common";
import PointCoordEditor from "./PointCoordEditor";

interface LhaFieldsProps {
  data: Record<string, unknown>;
  val: (key: string) => string;
  handleChange: (field: string, value: string | number | boolean | null) => void;
  onUpdate: (data: Record<string, unknown>) => void;
  surfaces?: SurfaceResponse[];
  seqDraft: string | null;
  setSeqDraft: (v: string | null) => void;
  seqError: string | null;
  setSeqError: (v: string | null) => void;
}

export default function LhaFields({
  data,
  val,
  handleChange,
  onUpdate,
  surfaces,
  seqDraft,
  setSeqDraft,
  seqError,
  setSeqError,
}: LhaFieldsProps) {
  /** lha-type fields for the feature info panel. */
  const { t } = useTranslation();

  return (
    <>
      {(() => {
        const parentAgl = surfaces?.flatMap(s => s.agls).find(a => a.id === data.agl_id);
        const isPapi = parentAgl?.agl_type === "PAPI";
        const lhaCount = parentAgl?.lhas?.length ?? 1;
        // PAPI: sequence_number is presented via the A-D letter dropdown
        // below, so the numeric input is hidden to avoid two equivalent
        // controls for the same field.
        if (isPapi) return null;
        // draft mirrors the raw input while the user types invalid values;
        // committed (valid) values flow back through data via val()
        const seqVal = seqDraft ?? val("sequence_number");
        return (
          <div>
            <Input
              id="feat-sequence-number"
              label={t("airport.lha.sequenceNumber")}
              hint={t("airport.lha.sequenceNumberHelp")}
              type="number"
              min={1}
              max={lhaCount}
              step={1}
              value={seqVal}
              onChange={(e) => {
                const raw = e.target.value;
                setSeqDraft(raw);
                if (raw === "") {
                  setSeqError(null);
                  return;
                }
                const parsed = parseInt(raw, 10);
                if (Number.isNaN(parsed)) return;
                if (parsed < 1 || parsed > lhaCount) {
                  setSeqError(t("airport.lha.sequenceOutOfRange", { max: lhaCount }));
                  return;
                }
                setSeqError(null);
                setSeqDraft(null);
                handleChange("sequence_number", parsed);
              }}
              data-testid="feat-sequence-number"
            />
            {seqError && (
              <p className="text-[10px] text-tv-error pl-1 mt-1" data-testid="feat-sequence-number-error">
                {seqError}
              </p>
            )}
          </div>
        );
      })()}
      <div>
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t("coordinator.detail.lhaUnitDesignator")}</span>
          <InfoHint
            text={t("coordinator.detail.lhaUnitDesignatorHelp")}
            label={t("coordinator.detail.lhaUnitDesignator")}
            testId="hint-feat-lha-unit-designator"
          />
        </label>
        {(() => {
          const parentAgl = surfaces?.flatMap(s => s.agls).find(a => a.id === data.agl_id);
          const isPapi = parentAgl?.agl_type === "PAPI";
          if (isPapi) {
            // for PAPI the letter is a presentation of sequence_number
            // (1=A, 2=B, 3=C, 4=D). show all four letters; picking one
            // submits a sequence_number change so backend's shift logic
            // reorders siblings (and relabels their letters).
            const seq = Number(data.sequence_number);
            const currentLetter =
              Number.isFinite(seq) && seq >= 1 && seq <= 4
                ? String.fromCharCode(64 + seq)
                : val("unit_designator");
            return (
              <select
                value={currentLetter}
                onChange={(e) => {
                  const letter = e.target.value;
                  handleChange("sequence_number", letter.charCodeAt(0) - 64);
                }}
                className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
                data-testid="feat-unit-designator"
              >
                {["A", "B", "C", "D"].map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            );
          }
          return (
            <Input
              id="feat-unit-designator"
              label=""
              value={val("unit_designator")}
              onChange={(e) => handleChange("unit_designator", e.target.value)}
            />
          );
        })()}
      </div>
      <Input
        id="feat-angle"
        label={t("coordinator.detail.lhaSettingAngle")}
        hint={t("coordinator.detail.lhaSettingAngleHelp")}
        type="number"
        step="0.1"
        value={val("setting_angle")}
        onChange={(e) => handleChange("setting_angle", e.target.value === "" ? null : parseFloat(e.target.value))}
      />
      <div>
        <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
          <span>{t("coordinator.detail.lhaLampType")}</span>
          <InfoHint
            text={t("coordinator.detail.lhaLampTypeHelp")}
            label={t("coordinator.detail.lhaLampType")}
            testId="hint-feat-lha-lamp-type"
          />
        </label>
        <select
          value={val("lamp_type")}
          onChange={(e) => handleChange("lamp_type", e.target.value)}
          className="w-full px-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
        >
          <option value="HALOGEN">{t("coordinator.detail.lampTypes.halogen")}</option>
          <option value="LED">{t("coordinator.detail.lampTypes.led")}</option>
        </select>
      </div>
      <Input
        id="feat-tolerance"
        label={t("coordinator.detail.lhaTolerance")}
        hint={t("coordinator.detail.lhaToleranceHelp")}
        type="number"
        step="0.1"
        value={val("tolerance")}
        onChange={(e) => handleChange("tolerance", e.target.value === "" ? null : parseFloat(e.target.value))}
      />
      {(() => {
        const parentAgl = surfaces?.flatMap(s => s.agls).find(a => a.id === data.agl_id);
        // lens heights are PAPI-only optics; hide for edge lights.
        if (parentAgl?.agl_type !== "PAPI") return null;
        return (
          <div className="flex flex-col gap-1.5">
            <Input
              id="feat-lens-msl"
              label={t("coordinator.detail.lhaLensMsl")}
              hint={t("coordinator.detail.lhaLensMslHelp")}
              type="number"
              step="0.01"
              value={val("lens_height_msl_m")}
              onChange={(e) => handleChange("lens_height_msl_m", e.target.value === "" ? null : parseFloat(e.target.value))}
              data-testid="feat-lens-msl"
            />
            <Input
              id="feat-lens-agl"
              label={t("coordinator.detail.lhaLensAgl")}
              hint={t("coordinator.detail.lhaLensAglHelp")}
              type="number"
              step="0.01"
              value={val("lens_height_agl_m")}
              onChange={(e) => handleChange("lens_height_agl_m", e.target.value === "" ? null : parseFloat(e.target.value))}
              data-testid="feat-lens-agl"
            />
          </div>
        );
      })()}
      <PointCoordEditor
        position={(data.position as PointZ | undefined) ?? null}
        onChange={(coords) => {
          const newPos = { type: "Point" as const, coordinates: coords };
          onUpdate({ position: newPos, preserve_altitude: true });
        }}
      />
    </>
  );
}
