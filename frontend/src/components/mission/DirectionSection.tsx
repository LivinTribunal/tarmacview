import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import type { InspectionConfigOverride } from "@/types/mission";
import FormSection from "@/components/common/FormSection";

interface DirectionSectionProps {
  showDirectionSection: boolean;
  inspectionDirection: "NATURAL" | "REVERSED" | null;
  resolvedDirection: "NATURAL" | "REVERSED" | null;
  displayedBearing: number | null;
  isDirectionDirty: boolean;
  configOverride: InspectionConfigOverride;
  onChange: (override: InspectionConfigOverride) => void;
  disabled: boolean;
}

// direction mode - inherit / natural / reversed. horizontal-range, fly-over, parallel-side-sweep
export default function DirectionSection({
  showDirectionSection,
  inspectionDirection,
  resolvedDirection,
  displayedBearing,
  isDirectionDirty,
  configOverride,
  onChange,
  disabled,
}: DirectionSectionProps) {
  /** direction-mode section: inherit/natural/reversed toggle + traversal-bearing indicator. */
  const { t } = useTranslation();
  const isInherit = inspectionDirection === null;
  const isNatural = inspectionDirection === "NATURAL";
  const isReversed = inspectionDirection === "REVERSED";
  const setMode = useCallback(
    (mode: "INHERIT" | "NATURAL" | "REVERSED") => {
      if (mode === "INHERIT") {
        onChange({ ...configOverride, direction: null });
        return;
      }
      onChange({ ...configOverride, direction: mode });
    },
    [onChange, configOverride],
  );
  const directionToggle = useMemo(
    () => (
      <div
        className="inline-flex rounded-full border border-tv-border bg-tv-surface p-0.5 text-xs"
        data-testid="inspection-direction-mode"
      >
        {([
          { key: "INHERIT", active: isInherit },
          { key: "NATURAL", active: isNatural },
          { key: "REVERSED", active: isReversed },
        ] as const).map(({ key, active }) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => setMode(key)}
            className={`px-3 py-1 rounded-full transition-colors flex items-center gap-1 ${
              active
                ? "bg-tv-accent text-white font-medium"
                : "text-tv-text-secondary hover:text-tv-text-primary"
            } disabled:opacity-50`}
            data-testid={`inspection-direction-mode-${key.toLowerCase()}`}
            title={t(`mission.config.direction.modeTitle.${key.toLowerCase()}`)}
          >
            {key === "REVERSED" ? <RotateCcw className="h-3 w-3" /> : null}
            {t(`mission.config.direction.mode.${key.toLowerCase()}`)}
          </button>
        ))}
      </div>
    ),
    [isInherit, isNatural, isReversed, disabled, setMode, t],
  );
  if (!showDirectionSection) {
    return null;
  }
  // when inheriting and a flight plan resolved a value, surface it as a label
  const inheritResolvedLabel =
    isInherit && resolvedDirection
      ? t(`mission.config.direction.inheritResolved.${resolvedDirection.toLowerCase()}`)
      : null;
  return (
    <FormSection
      title={t("mission.config.sections.direction")}
      hint={t("mission.config.direction.labelHelp")}
      testId="section-direction"
      meta={directionToggle}
    >
      <div data-testid="direction-reversed-section">
        <div className="flex items-center gap-2">
          <svg className="h-5 w-5 flex-shrink-0" viewBox="0 0 24 24">
            <line
              x1="12" y1="20" x2="12" y2="4"
              stroke="var(--tv-accent)" strokeWidth="2" strokeLinecap="round"
              transform={`rotate(${displayedBearing ?? 0}, 12, 12)`}
            />
            <polygon
              points="12,2 9,8 15,8"
              fill="var(--tv-accent)"
              transform={`rotate(${displayedBearing ?? 0}, 12, 12)`}
            />
          </svg>
          <span
            className="text-xs font-medium text-tv-text-primary tabular-nums"
            data-testid="inspection-direction-bearing"
          >
            {displayedBearing === null
              ? t("mission.config.direction.unknown")
              : `${displayedBearing}°`}
          </span>
        </div>
        {inheritResolvedLabel && (
          <p
            className="mt-2 text-xs text-tv-text-secondary leading-tight"
            data-testid="inspection-direction-inherit-resolved"
          >
            {inheritResolvedLabel}
          </p>
        )}
        {isInherit && !inheritResolvedLabel && (
          <p className="mt-2 text-xs text-tv-text-secondary leading-tight">
            {t("mission.config.direction.inheritHint")}
          </p>
        )}
        {!isInherit && isDirectionDirty && (
          <p
            className="mt-2 text-[10px] text-tv-warning"
            data-testid="inspection-direction-recompute-hint"
          >
            {t("mission.config.direction.recomputeHint")}
          </p>
        )}
      </div>
    </FormSection>
  );
}
