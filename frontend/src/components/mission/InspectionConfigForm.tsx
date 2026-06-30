import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp } from "lucide-react";
import type {
  InspectionResponse,
  InspectionConfigOverride,
  LhaSelectionRules,
  MissionDetailResponse,
} from "@/types/mission";
import type { InspectionTemplateResponse } from "@/types/inspectionTemplate";
import type { DroneProfileResponse } from "@/types/droneProfile";
import type { AGLResponse, SurfaceResponse } from "@/types/airport";
import FormSection from "@/components/common/FormSection";
import ReadOnlyField from "@/components/common/ReadOnlyField";
import CameraSettingsSection from "@/components/mission/CameraSettingsSection";
import CaptureModeSection from "@/components/mission/CaptureModeSection";
import DirectionSection from "@/components/mission/DirectionSection";
import FlightParametersSection from "@/components/mission/FlightParametersSection";
import LhaSelectionSection from "@/components/mission/LhaSelectionSection";
import MethodSpecificSections from "@/components/mission/MethodSpecificSections";
import useInspectionConfig from "@/hooks/useInspectionConfig";

interface InspectionConfigFormProps {
  inspection: InspectionResponse;
  template: InspectionTemplateResponse | null;
  agls: AGLResponse[];
  surfaces?: SurfaceResponse[];
  droneProfile: DroneProfileResponse | null;
  mission: MissionDetailResponse;
  configOverride: InspectionConfigOverride;
  onChange: (override: InspectionConfigOverride) => void;
  selectedLhaIds: Set<string>;
  onToggleLha: (lhaId: string) => void;
  onSelectionForAglChange?: (aglId: string, lhaIds: Set<string>) => void;
  lhaSelectionRules?: LhaSelectionRules;
  onLhaSelectionRulesChange?: (rules: LhaSelectionRules) => void;
  disabled?: boolean;
  // computed traversal bearing (0-359) from the latest trajectory, or null when
  // trajectory is missing / method has no meaningful direction.
  directionBearing?: number | null;
}

export default function InspectionConfigForm({
  inspection,
  template,
  agls,
  surfaces,
  droneProfile,
  mission,
  configOverride,
  onChange,
  selectedLhaIds,
  onToggleLha,
  onSelectionForAglChange,
  lhaSelectionRules,
  onLhaSelectionRulesChange,
  disabled = false,
  directionBearing = null,
}: InspectionConfigFormProps) {
  /** per-inspection override form, with method-specific field groups and the camera/zoom controls. */
  const { t } = useTranslation();
  const cfg = useInspectionConfig({
    inspection,
    template,
    agls,
    droneProfile,
    mission,
    configOverride,
    onChange,
    selectedLhaIds,
    directionBearing,
  });

  const [collapsed, setCollapsed] = useState(false);
  const [lhaSelectionOpen, setLhaSelectionOpen] = useState(false);
  // hover-point-lock angle lock - owned here so it survives inspection/method switches
  const [angleLocked, setAngleLocked] = useState(false);

  // shared between the geometry + trailing MethodSpecificSections slots
  const methodSectionProps = {
    inspection,
    disabled,
    droneProfile,
    targetAgls: cfg.targetAgls,
    surfaces,
    template,
    configOverride,
    onChange,
    onNumberChange: cfg.handleNumberChange,
    missingSettingAngleUnits: cfg.missingSettingAngleUnits,
    horizontalDistance: cfg.horizontalDistance,
    sweepAngle: cfg.sweepAngle,
    angleOffsetAbove: cfg.angleOffsetAbove,
    angleOffsetBelow: cfg.angleOffsetBelow,
    angleStart: cfg.angleStart,
    angleEnd: cfg.angleEnd,
    angleSource: cfg.angleSource,
    verticalProfilePapiMissing: cfg.verticalProfilePapiMissing,
    verticalProfilePreview: cfg.verticalProfilePreview,
    bufferDistance: cfg.bufferDistance,
    lhaSettingAngleOverrideId: cfg.lhaSettingAngleOverrideId,
    computedObservationAngle: cfg.computedObservationAngle,
    heightAboveLights: cfg.heightAboveLights,
    lateralOffset: cfg.lateralOffset,
    distanceFromLha: cfg.distanceFromLha,
    heightAboveLha: cfg.heightAboveLha,
    cameraGimbalAngle: cfg.cameraGimbalAngle,
    descentStartDistance: cfg.descentStartDistance,
    descentGlideSlopeOverride: cfg.descentGlideSlopeOverride,
    hoverBearing: cfg.hoverBearing,
    hoverBearingReference: cfg.hoverBearingReference,
    angleLocked,
    onAngleLockedToggle: () => setAngleLocked((v) => !v),
    computedMehtHeight: cfg.computedMehtHeight,
    speedWarning: cfg.speedWarning,
    opticalZoom: cfg.opticalZoom,
  };

  return (
    <div data-testid="inspection-config-form">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-between w-full text-sm font-semibold text-tv-text-primary"
      >
        <span className="rounded-full px-3 py-1 bg-tv-bg border border-tv-border">{t("mission.config.inspectionConfig")}</span>
        {collapsed ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronUp className="h-4 w-4" />
        )}
      </button>
      {!collapsed && <div className="border-b border-tv-border -mx-4 mt-3" />}

      {!collapsed && (
      <div className={`space-y-4 mt-3${disabled ? " pointer-events-none opacity-60" : ""}`}>

      <FormSection title={t("mission.config.sections.identity")} testId="section-identity">
      <div className="grid grid-cols-2 gap-3">
        <ReadOnlyField
          label={t("mission.config.templateName")}
          hint={t("mission.config.templateNameHelp")}
          value={template?.name ?? "-"}
          testId="inspection-template-readonly"
        />
        {inspection.method !== "HOVER_POINT_LOCK" && inspection.method !== "MEHT_CHECK" && (
          <ReadOnlyField
            label={t("mission.config.method")}
            hint={t("mission.config.methodHelp")}
            value={t(`map.inspectionMethod.${inspection.method}`, inspection.method)}
            testId="inspection-method-readonly"
          />
        )}
      </div>
      </FormSection>

      <LhaSelectionSection
        inspection={inspection}
        agls={agls}
        surfaces={surfaces}
        targetAgls={cfg.targetAgls}
        selectedLhaIds={selectedLhaIds}
        selectedLhaId={cfg.selectedLhaId}
        hoverAglId={cfg.hoverAglId}
        setHoverAglId={cfg.setHoverAglId}
        hoverAgl={cfg.hoverAgl}
        lhaSelectionOpen={lhaSelectionOpen}
        setLhaSelectionOpen={setLhaSelectionOpen}
        configOverride={configOverride}
        onChange={onChange}
        onToggleLha={onToggleLha}
        onSelectionForAglChange={onSelectionForAglChange}
        lhaSelectionRules={lhaSelectionRules}
        onLhaSelectionRulesChange={onLhaSelectionRulesChange}
        disabled={disabled}
      />

      <FlightParametersSection
        inspection={inspection}
        altitudeOffset={cfg.altitudeOffset}
        measurementSpeedOverride={cfg.measurementSpeedOverride}
        measurementDensity={cfg.measurementDensity}
        bufferDistance={cfg.bufferDistance}
        hoverDuration={cfg.hoverDuration}
        speedWarning={cfg.speedWarning}
        onNumberChange={cfg.handleNumberChange}
      />

      <CaptureModeSection
        captureMode={cfg.captureMode}
        effectiveCaptureMode={cfg.effectiveCaptureMode}
        recordingSetupDuration={cfg.recordingSetupDuration}
        configOverride={configOverride}
        onChange={onChange}
        onNumberChange={cfg.handleNumberChange}
      />

      <MethodSpecificSections slot="geometry" {...methodSectionProps} />

      <DirectionSection
        showDirectionSection={cfg.showDirectionSection}
        inspectionDirection={cfg.inspectionDirection}
        resolvedDirection={cfg.resolvedDirection}
        displayedBearing={cfg.displayedBearing}
        isDirectionDirty={cfg.isDirectionDirty}
        configOverride={configOverride}
        onChange={onChange}
        disabled={disabled}
      />

      <CameraSettingsSection
        effectiveCameraMode={cfg.effectiveCameraMode}
        cameraMode={cfg.cameraMode}
        onCameraModeChange={cfg.handleCameraModeChange}
        selectedPresetId={cfg.selectedPresetId}
        onPresetSelect={cfg.handlePresetSelect}
        presets={cfg.presets}
        whiteBalance={cfg.whiteBalance}
        isoValue={cfg.isoValue}
        shutterSpeed={cfg.shutterSpeed}
        focusMode={cfg.focusMode}
        opticalZoom={cfg.opticalZoom}
        zoomTouched={cfg.zoomTouched}
        onZoomTouchedChange={cfg.setZoomTouched}
        computedOpticalZoom={cfg.computedOpticalZoom}
        configOverride={configOverride}
        onChange={onChange}
        onNumberChange={cfg.handleNumberChange}
        mission={mission}
        droneProfile={droneProfile}
        showSavePreset={cfg.showSavePreset}
        onShowSavePresetChange={cfg.setShowSavePreset}
        presetName={cfg.presetName}
        onPresetNameChange={cfg.setPresetName}
        savingPreset={cfg.savingPreset}
        onSaveAsPreset={cfg.handleSaveAsPreset}
      />

      <MethodSpecificSections slot="trailing" {...methodSectionProps} />
      </div>
      )}
    </div>
  );
}
