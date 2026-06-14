import { useTranslation } from "react-i18next";
import type { LhaSelectionMode } from "@/types/mission";

interface LhaSelectionModeToggleProps {
  mode: LhaSelectionMode;
  onChange: (mode: LhaSelectionMode) => void;
  disabled?: boolean;
  fromThresholdAvailable?: boolean;
}

const ORDER: LhaSelectionMode[] = ["ALL", "RANGE", "FROM_THRESHOLD", "CUSTOM"];

export default function LhaSelectionModeToggle({
  mode,
  onChange,
  disabled = false,
  fromThresholdAvailable = true,
}: LhaSelectionModeToggleProps) {
  const { t } = useTranslation();

  const labelFor = (m: LhaSelectionMode) =>
    m === "ALL"
      ? t("mission.config.lhaSelection.modeAll")
      : m === "RANGE"
        ? t("mission.config.lhaSelection.modeRange")
        : m === "FROM_THRESHOLD"
          ? t("mission.config.lhaSelection.modeFromThreshold")
          : t("mission.config.lhaSelection.modeCustom");

  return (
    <fieldset
      className="inline-flex min-w-0 rounded-full border border-tv-border bg-tv-bg p-0.5 text-xs"
      data-testid="lha-selection-mode-toggle"
    >
      {ORDER.map((m) => {
        const active = mode === m;
        const disabledThis =
          disabled || (m === "FROM_THRESHOLD" && !fromThresholdAvailable);
        return (
          <button
            key={m}
            type="button"
            disabled={disabledThis}
            onClick={() => onChange(m)}
            title={
              m === "FROM_THRESHOLD" && !fromThresholdAvailable
                ? t("mission.config.lhaSelection.fromThresholdUnavailable")
                : undefined
            }
            className={`px-3 py-1 rounded-full transition-colors ${
              active
                ? "bg-tv-accent text-white font-medium"
                : "text-tv-text-secondary hover:text-tv-text-primary"
            } ${disabledThis ? "opacity-50 cursor-not-allowed" : ""}`}
            data-testid={`lha-selection-mode-${m.toLowerCase()}`}
          >
            {labelFor(m)}
          </button>
        );
      })}
    </fieldset>
  );
}
