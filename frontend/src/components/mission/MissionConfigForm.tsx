import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { MissionDetailResponse, MissionUpdate } from "@/types/mission";
import FlightPlanScopeSelector from "./FlightPlanScopeSelector";
import type { DroneProfileResponse } from "@/types/droneProfile";
import type { PointZ } from "@/types/common";
import InfoHint from "@/components/common/InfoHint";
import FormSection from "@/components/common/FormSection";
import CoordinateInput from "./CoordinateInput";
import DroneProfileDropdown from "./DroneProfileDropdown";
import MissionCameraSection from "./MissionCameraSection";
import MissionTogglesSection from "./MissionTogglesSection";
import { useMissionConfigValues } from "@/hooks/useMissionConfigValues";

type PickTarget = "takeoff" | "landing" | null;

interface MissionConfigFormProps {
  mission: MissionDetailResponse;
  droneProfiles: DroneProfileResponse[];
  values: Partial<MissionUpdate>;
  onChange: (update: Partial<MissionUpdate>) => void;
  pickingCoord?: PickTarget;
  onPickCoord?: (target: PickTarget) => void;
  defaultAltitude?: number;
  disabled?: boolean;
  // optional controlled mirror-mode state - when omitted the checkbox is
  // self-contained; the parent lifts this when pick-on-map also needs to mirror
  useTakeoffAsLanding?: boolean;
  onUseTakeoffAsLandingChange?: (value: boolean) => void;
}

export default function MissionConfigForm({
  mission,
  droneProfiles,
  values,
  onChange,
  pickingCoord,
  onPickCoord,
  defaultAltitude,
  disabled = false,
  useTakeoffAsLanding: useTakeoffAsLandingProp,
  onUseTakeoffAsLandingChange,
}: MissionConfigFormProps) {
  /** mission-level configuration form with coordinate pick-on-map support. */
  const { t } = useTranslation();
  const transitSpeedId = useId();
  const measurementSpeedId = useId();
  const altitudeOffsetId = useId();
  const transitAglId = useId();
  const notesId = useId();
  const [localUseTakeoffAsLanding, setLocalUseTakeoffAsLanding] = useState(false);
  const useTakeoffAsLanding = useTakeoffAsLandingProp ?? localUseTakeoffAsLanding;
  const setUseTakeoffAsLanding = (value: boolean) => {
    if (onUseTakeoffAsLandingChange) onUseTakeoffAsLandingChange(value);
    else setLocalUseTakeoffAsLanding(value);
  };

  const {
    droneProfileId,
    defaultSpeed,
    measurementSpeedOverride,
    defaultAltitudeOffset,
    takeoff,
    landing,
    notes,
    defaultCaptureMode,
    defaultBufferDistance,
    defaultWhiteBalance,
    defaultIso,
    defaultShutterSpeed,
    defaultFocusMode,
    cameraMode,
    transitAgl,
    requirePerpendicularCrossing,
    keepInsideAirportBoundary,
    flightPlanScope,
    missionDirection,
    presets,
    appliedPresetId,
    handlePresetApply,
    handleCameraModeChange,
  } = useMissionConfigValues(mission, values, onChange);

  const [collapsed, setCollapsed] = useState(false);

  const directionToggle = useMemo(
    () => (
      <div
        className="inline-flex rounded-full border border-tv-border bg-tv-surface p-0.5 text-xs"
        data-testid="mission-direction-mode"
      >
        {(["AUTO", "NATURAL", "REVERSED"] as const).map((key) => {
          const active = missionDirection === key;
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ direction: key })}
              className={`px-3 py-1 rounded-full transition-colors ${
                active
                  ? "bg-tv-accent text-white font-medium"
                  : "text-tv-text-secondary hover:text-tv-text-primary"
              } disabled:opacity-50`}
              data-testid={`mission-direction-mode-${key.toLowerCase()}`}
              title={t(`mission.config.missionDirection.modeTitle.${key.toLowerCase()}`)}
            >
              {t(`mission.config.missionDirection.mode.${key.toLowerCase()}`)}
            </button>
          );
        })}
      </div>
    ),
    [missionDirection, disabled, onChange, t],
  );

  return (
    <div data-testid="mission-config-form">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-between w-full text-sm font-semibold text-tv-text-primary"
      >
        <span className="rounded-full px-3 py-1 bg-tv-bg border border-tv-border">{t("mission.config.missionConfig")}</span>
        {collapsed ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronUp className="h-4 w-4" />
        )}
      </button>
      {!collapsed && <div className="border-b border-tv-border -mx-4 mt-3" />}

      {!collapsed && (
      <div className={`space-y-4 mt-3${disabled ? " pointer-events-none opacity-60" : ""}`}>

      <FormSection title={t("mission.config.sections.droneAndSpeeds")} testId="section-drone-and-speeds">
      <DroneProfileDropdown
        droneProfiles={droneProfiles}
        selectedId={droneProfileId ?? ""}
        onSelect={(id) => onChange({ drone_profile_id: id || null })}
      />

      {/* speed overrides + altitude offset */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label
            htmlFor={transitSpeedId}
            className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
          >
            <span>{t("mission.config.transitSpeedOverride")}</span>
            <InfoHint
              text={t("mission.config.transitSpeedOverrideHelp")}
              label={t("mission.config.transitSpeedOverride")}
              testId="hint-transit-speed-override"
            />
          </label>
          <input
            id={transitSpeedId}
            type="number"
            step="0.1"
            min="0"
            value={defaultSpeed ?? ""}
            onChange={(e) =>
              onChange({ default_speed: e.target.value ? parseFloat(e.target.value) : null })
            }
            placeholder={t("mission.config.transitSpeedOverrideHint")}
            className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
            data-testid="default-speed-input"
          />
        </div>
        <div>
          <label
            htmlFor={measurementSpeedId}
            className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
          >
            <span>{t("mission.config.measurementSpeedOverride")}</span>
            <InfoHint
              text={t("mission.config.missionMeasurementSpeedHelp")}
              label={t("mission.config.measurementSpeedOverride")}
              testId="hint-measurement-speed-override"
            />
          </label>
          <input
            id={measurementSpeedId}
            type="number"
            step="0.1"
            min="0"
            value={measurementSpeedOverride ?? ""}
            onChange={(e) =>
              onChange({ measurement_speed_override: e.target.value ? parseFloat(e.target.value) : null })
            }
            placeholder={t("mission.config.missionMeasurementSpeedHint")}
            className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
            data-testid="measurement-speed-override-input"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label
            htmlFor={altitudeOffsetId}
            className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
          >
            <span>{t("mission.config.defaultAltitudeOffset")}</span>
            <InfoHint
              text={t("mission.config.defaultAltitudeOffsetHelp")}
              label={t("mission.config.defaultAltitudeOffset")}
              testId="hint-default-altitude-offset"
            />
          </label>
          <input
            id={altitudeOffsetId}
            type="number"
            step="0.1"
            value={defaultAltitudeOffset ?? ""}
            onChange={(e) =>
              onChange({ default_altitude_offset: e.target.value ? parseFloat(e.target.value) : null })
            }
            placeholder={t("mission.config.defaultAltitudeOffsetHint")}
            className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
            data-testid="default-altitude-offset-input"
          />
        </div>
        <div>
          <label
            htmlFor={transitAglId}
            className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
          >
            <span>{t("mission.config.transitAgl")}</span>
            <InfoHint
              text={t("mission.config.transitAglHelp")}
              label={t("mission.config.transitAgl")}
              testId="hint-transit-agl"
            />
          </label>
          <input
            id={transitAglId}
            type="number"
            step="0.5"
            min="5"
            value={transitAgl ?? ""}
            onChange={(e) =>
              onChange({ transit_agl: e.target.value ? parseFloat(e.target.value) : null })
            }
            placeholder={t("mission.config.transitAglHint")}
            className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
            data-testid="transit-agl-input"
          />
        </div>
      </div>
      </FormSection>

      <MissionCameraSection
        defaultCaptureMode={defaultCaptureMode}
        defaultBufferDistance={defaultBufferDistance}
        cameraMode={cameraMode}
        presets={presets}
        appliedPresetId={appliedPresetId}
        defaultWhiteBalance={defaultWhiteBalance}
        defaultIso={defaultIso}
        defaultShutterSpeed={defaultShutterSpeed}
        defaultFocusMode={defaultFocusMode}
        onChange={onChange}
        onCameraModeChange={handleCameraModeChange}
        onPresetApply={handlePresetApply}
      />

      <MissionTogglesSection
        useTakeoffAsLanding={useTakeoffAsLanding}
        setUseTakeoffAsLanding={setUseTakeoffAsLanding}
        takeoff={takeoff}
        requirePerpendicularCrossing={requirePerpendicularCrossing}
        keepInsideAirportBoundary={keepInsideAirportBoundary}
        onChange={onChange}
        disabled={disabled}
      />

      <FormSection
        title={t("mission.config.sections.coordinates")}
        hint={t("mission.config.sections.coordinatesHelp")}
        testId="section-coordinates"
      >
      <div className="flex flex-col gap-2">
        <div className="rounded-2xl border border-tv-border px-3 py-2.5">
          <CoordinateInput
            label={
              useTakeoffAsLanding
                ? t("mission.config.takeoffAndLandingCoordinate")
                : t("mission.config.takeoffCoordinate")
            }
            value={takeoff ?? null}
            onChange={(val: PointZ | null) => {
              if (useTakeoffAsLanding) {
                onChange({ takeoff_coordinate: val, landing_coordinate: val });
              } else {
                onChange({ takeoff_coordinate: val });
              }
            }}
            picking={pickingCoord === "takeoff"}
            onPickOnMap={onPickCoord ? () => onPickCoord(pickingCoord === "takeoff" ? null : "takeoff") : undefined}
            defaultAltitude={defaultAltitude}
          />
        </div>
        {!useTakeoffAsLanding && (
          <div className="rounded-2xl border border-tv-border px-3 py-2.5">
            <CoordinateInput
              label={t("mission.config.landingCoordinate")}
              value={landing ?? null}
              onChange={(val: PointZ | null) => onChange({ landing_coordinate: val })}
              picking={pickingCoord === "landing"}
              onPickOnMap={
                onPickCoord
                  ? () => onPickCoord(pickingCoord === "landing" ? null : "landing")
                  : undefined
              }
              defaultAltitude={defaultAltitude}
            />
          </div>
        )}
      </div>
      </FormSection>

      <FormSection
        title={t("mission.config.sections.flightPlanScope")}
        hint={t("mission.config.sections.flightPlanScopeHelp")}
        testId="section-flight-plan-scope"
      >
      <FlightPlanScopeSelector
        value={flightPlanScope}
        onChange={(scope) => onChange({ flight_plan_scope: scope })}
        disabled={disabled}
      />
      </FormSection>

      <FormSection
        title={t("mission.config.sections.direction")}
        hint={t("mission.config.sections.directionHelp")}
        testId="section-direction"
        meta={directionToggle}
      >
      <div data-testid="mission-direction-section">
        <p className="text-xs text-tv-text-secondary leading-tight">
          {t("mission.config.missionDirection.hint")}
        </p>
      </div>
      </FormSection>

      <FormSection
        title={t("mission.config.sections.notes")}
        hint={t("mission.config.sections.notesHelp")}
        testId="section-notes"
      >
      <div>
        <label
          htmlFor={notesId}
          className="block text-xs font-medium mb-1 text-tv-text-secondary"
        >
          {t("mission.config.operatorNotes")}
        </label>
        <textarea
          id={notesId}
          value={notes ?? ""}
          onChange={(e) => onChange({ operator_notes: e.target.value || null })}
          placeholder={t("mission.config.operatorNotesPlaceholder")}
          rows={2}
          className="w-full px-3 py-2 rounded-2xl text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors resize-none"
          data-testid="operator-notes-textarea"
        />
      </div>
      </FormSection>
      </div>
      )}
    </div>
  );
}
