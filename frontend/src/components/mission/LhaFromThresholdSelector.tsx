import { useId } from "react";
import { useTranslation } from "react-i18next";
import type {
  LhaSelectionFromThresholdParams,
  ThresholdAnchor,
} from "@/types/mission";

interface LhaFromThresholdSelectorProps {
  params: LhaSelectionFromThresholdParams;
  onChange: (next: LhaSelectionFromThresholdParams) => void;
  available: boolean;
  disabled?: boolean;
}

const ANCHORS: ThresholdAnchor[] = ["START", "END"];

export default function LhaFromThresholdSelector({
  params,
  onChange,
  available,
  disabled = false,
}: LhaFromThresholdSelectorProps) {
  const { t } = useTranslation();
  const distanceId = useId();

  if (!available) {
    return (
      <p
        className="mt-2 text-xs text-tv-warning"
        data-testid="lha-from-threshold-unavailable"
      >
        {t("mission.config.lhaSelection.fromThresholdUnavailable")}
      </p>
    );
  }

  const labelFor = (a: ThresholdAnchor) =>
    a === "START"
      ? t("mission.config.lhaSelection.thresholdStart")
      : t("mission.config.lhaSelection.thresholdEnd");

  return (
    <div className="mt-2 space-y-2" data-testid="lha-from-threshold-selector">
      <fieldset className="inline-flex min-w-0 rounded-full border border-tv-border bg-tv-bg p-0.5 text-xs">
        {ANCHORS.map((a) => {
          const active = params.threshold === a;
          return (
            <button
              key={a}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ ...params, threshold: a })}
              className={`px-3 py-1 rounded-full transition-colors ${
                active
                  ? "bg-tv-accent text-white font-medium"
                  : "text-tv-text-secondary hover:text-tv-text-primary"
              } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
              data-testid={`lha-from-threshold-anchor-${a.toLowerCase()}`}
            >
              {labelFor(a)}
            </button>
          );
        })}
      </fieldset>
      <div>
        <label
          htmlFor={distanceId}
          className="block text-xs font-medium mb-1 text-tv-text-secondary"
        >
          {t("mission.config.lhaSelection.distanceM")}
        </label>
        <input
          id={distanceId}
          type="number"
          min={0}
          step="0.1"
          disabled={disabled}
          value={Number.isFinite(params.distance_m) ? params.distance_m : ""}
          onChange={(e) => {
            const v = e.target.value;
            const n = v === "" ? 0 : parseFloat(v);
            onChange({ ...params, distance_m: Number.isFinite(n) ? n : 0 });
          }}
          className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors disabled:opacity-50"
          data-testid="lha-from-threshold-distance"
        />
      </div>
    </div>
  );
}
