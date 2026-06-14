import { useTranslation } from "react-i18next";
import type { MissionUpdate } from "@/types/mission";
import type { PointZ } from "@/types/common";
import Toggle from "@/components/common/Toggle";
import FormSection from "@/components/common/FormSection";

interface MissionTogglesSectionProps {
  useTakeoffAsLanding: boolean;
  setUseTakeoffAsLanding: (value: boolean) => void;
  takeoff: PointZ | null | undefined;
  requirePerpendicularCrossing: boolean;
  keepInsideAirportBoundary: boolean;
  onChange: (update: Partial<MissionUpdate>) => void;
  disabled: boolean;
}

/** mission boolean toggles - use-takeoff-as-landing, perpendicular crossing, keep-inside-boundary. */
export default function MissionTogglesSection({
  useTakeoffAsLanding,
  setUseTakeoffAsLanding,
  takeoff,
  requirePerpendicularCrossing,
  keepInsideAirportBoundary,
  onChange,
  disabled,
}: MissionTogglesSectionProps) {
  const { t } = useTranslation();
  return (
    <FormSection
      title={t("mission.config.sections.missionToggles")}
      hint={t("mission.config.sections.missionTogglesHelp")}
      testId="section-mission-toggles"
    >
    <div
      className="rounded-2xl border border-tv-border bg-tv-bg px-3 py-2.5 flex items-center gap-3"
      data-testid="use-takeoff-as-landing"
    >
      <span className="flex flex-col flex-1 min-w-0">
        <span className="text-xs font-medium text-tv-text-primary">
          {t("map.useTakeoffAsLanding")}
        </span>
        <span className="text-xs text-tv-text-secondary leading-tight">
          {t("map.useTakeoffAsLandingHint")}
        </span>
      </span>
      <Toggle
        checked={useTakeoffAsLanding}
        onChange={() => {
          const next = !useTakeoffAsLanding;
          setUseTakeoffAsLanding(next);
          if (next && takeoff) {
            onChange({ landing_coordinate: takeoff });
          }
        }}
        disabled={disabled}
        data-testid="use-takeoff-as-landing-checkbox"
      />
    </div>
    <div
      className="rounded-2xl border border-tv-border bg-tv-bg px-3 py-2.5 flex items-center gap-3"
      data-testid="require-perpendicular-crossing"
    >
      <span className="flex flex-col flex-1 min-w-0">
        <span className="text-xs font-medium text-tv-text-primary">
          {t("mission.config.requirePerpendicularCrossing")}
        </span>
        <span className="text-xs text-tv-text-secondary leading-tight">
          {t("mission.config.requirePerpendicularCrossingHint")}
        </span>
      </span>
      <Toggle
        checked={requirePerpendicularCrossing}
        onChange={() =>
          onChange({
            require_perpendicular_runway_crossing: !requirePerpendicularCrossing,
          })
        }
        disabled={disabled}
        data-testid="require-perpendicular-crossing-toggle"
      />
    </div>
    <div
      className="rounded-2xl border border-tv-border bg-tv-bg px-3 py-2.5 flex items-center gap-3"
      data-testid="keep-inside-airport-boundary"
    >
      <span className="flex flex-col flex-1 min-w-0">
        <span className="text-xs font-medium text-tv-text-primary">
          {t("mission.config.keepInsideAirportBoundary")}
        </span>
        <span className="text-xs text-tv-text-secondary leading-tight">
          {t("mission.config.keepInsideAirportBoundaryHint")}
        </span>
      </span>
      <Toggle
        checked={keepInsideAirportBoundary}
        onChange={() =>
          onChange({
            keep_inside_airport_boundary: !keepInsideAirportBoundary,
          })
        }
        disabled={disabled}
        data-testid="keep-inside-airport-boundary-toggle"
      />
    </div>
    </FormSection>
  );
}
