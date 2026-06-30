import { useId } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import type {
  InspectionResponse,
  InspectionConfigOverride,
} from "@/types/mission";
import type { AGLResponse, SurfaceResponse } from "@/types/airport";
import type { DroneProfileResponse } from "@/types/droneProfile";
import type { InspectionTemplateResponse } from "@/types/inspectionTemplate";
import FormSection from "@/components/common/FormSection";
import InfoHint from "@/components/common/InfoHint";
import ApproachDescentFields from "@/components/mission/ApproachDescentFields";
import PapiCenterHeightSection from "@/components/mission/PapiCenterHeightSection";
import FlyOverFields from "@/components/mission/FlyOverFields";
import ParallelSideSweepFields from "@/components/mission/ParallelSideSweepFields";
import HoverPointLockFields from "@/components/mission/HoverPointLockFields";
import MehtCheckFields from "@/components/mission/MehtCheckFields";
import SurfaceScanFields from "@/components/mission/SurfaceScanFields";
import VerticalProfileGeometry from "@/components/mission/VerticalProfileGeometry";
import HorizontalRangeGeometry from "@/components/mission/HorizontalRangeGeometry";
import { isZoomOverOptical } from "@/utils/cameraAutoCalc";
import { methodCaps } from "@/utils/methodAglCompatibility";

interface MethodSpecificSectionsProps {
  // "geometry" renders before the direction/camera blocks; "trailing" renders after.
  slot: "geometry" | "trailing";
  inspection: InspectionResponse;
  disabled: boolean;
  droneProfile: DroneProfileResponse | null;
  targetAgls: AGLResponse[];
  surfaces?: SurfaceResponse[];
  template: InspectionTemplateResponse | null;
  configOverride: InspectionConfigOverride;
  onChange: (override: InspectionConfigOverride) => void;
  onNumberChange: (field: keyof InspectionConfigOverride, raw: string) => void;
  missingSettingAngleUnits: string[];
  horizontalDistance: number | "";
  sweepAngle: number | "";
  angleOffsetAbove: number | "";
  angleOffsetBelow: number | "";
  angleStart: number | "";
  angleEnd: number | "";
  angleSource: "PAPI" | "CUSTOM";
  verticalProfilePapiMissing: string[];
  verticalProfilePreview: { start: number; end: number } | null;
  bufferDistance: number | "";
  lhaSettingAngleOverrideId: string | null;
  computedObservationAngle: number | null;
  heightAboveLights: number | "";
  lateralOffset: number | "";
  distanceFromLha: number | "";
  heightAboveLha: number | "";
  cameraGimbalAngle: number | "";
  descentStartDistance: number | "";
  descentGlideSlopeOverride: number | "";
  papiCenterHeightReference: "GROUND" | "LENS" | "CUSTOM";
  papiCenterHeightCustomM: number | "";
  hoverBearing: number | "";
  hoverBearingReference: "RUNWAY" | "COMPASS";
  angleLocked: boolean;
  onAngleLockedToggle: () => void;
  computedMehtHeight: number | null;
  speedWarning: boolean;
  opticalZoom: number | "";
}

export default function MethodSpecificSections({
  slot,
  inspection,
  disabled,
  droneProfile,
  targetAgls,
  surfaces,
  template,
  configOverride,
  onChange,
  onNumberChange,
  missingSettingAngleUnits,
  horizontalDistance,
  sweepAngle,
  angleOffsetAbove,
  angleOffsetBelow,
  angleStart,
  angleEnd,
  angleSource,
  verticalProfilePapiMissing,
  verticalProfilePreview,
  bufferDistance,
  lhaSettingAngleOverrideId,
  computedObservationAngle,
  heightAboveLights,
  lateralOffset,
  distanceFromLha,
  heightAboveLha,
  cameraGimbalAngle,
  descentStartDistance,
  descentGlideSlopeOverride,
  papiCenterHeightReference,
  papiCenterHeightCustomM,
  hoverBearing,
  hoverBearingReference,
  angleLocked,
  onAngleLockedToggle,
  computedMehtHeight,
  speedWarning,
  opticalZoom,
}: MethodSpecificSectionsProps) {
  /** method-specific geometry/field sections plus the inline validation warnings. */
  const { t } = useTranslation();
  const horizontalDistanceId = useId();
  const bufferDistanceId = useId();
  const caps = methodCaps(inspection.method);

  // the method's own fields - rendered inside the shared "method specific"
  // FormSection, which slot it lands in is driven by caps.formSlot below.
  function renderMethodFields() {
    switch (inspection.method) {
      case "FLY_OVER":
        return (
          <FlyOverFields
            heightAboveLights={heightAboveLights}
            cameraGimbalAngle={cameraGimbalAngle}
            onNumberChange={onNumberChange}
          />
        );
      case "APPROACH_DESCENT":
        return (
          <ApproachDescentFields
            descentStartDistance={descentStartDistance}
            descentGlideSlopeOverride={descentGlideSlopeOverride}
            onNumberChange={onNumberChange}
          />
        );
      case "PARALLEL_SIDE_SWEEP":
        return (
          <ParallelSideSweepFields
            lateralOffset={lateralOffset}
            heightAboveLights={heightAboveLights}
            onNumberChange={onNumberChange}
          />
        );
      case "HOVER_POINT_LOCK":
        return (
          <HoverPointLockFields
            distanceFromLha={distanceFromLha}
            heightAboveLha={heightAboveLha}
            cameraGimbalAngle={cameraGimbalAngle}
            hoverBearing={hoverBearing}
            hoverBearingReference={hoverBearingReference}
            angleLocked={angleLocked}
            onAngleLockedToggle={onAngleLockedToggle}
            configOverride={configOverride}
            onChange={onChange}
            onNumberChange={onNumberChange}
          />
        );
      case "MEHT_CHECK":
        return <MehtCheckFields computedMehtHeight={computedMehtHeight} />;
      case "SURFACE_SCAN":
        return (
          <SurfaceScanFields
            surfaces={surfaces ?? []}
            savedConfig={inspection.config}
            defaultConfig={template?.default_config ?? null}
            droneProfile={droneProfile}
            configOverride={configOverride}
            onChange={onChange}
            onNumberChange={onNumberChange}
          />
        );
      default:
        return null;
    }
  }

  if (slot === "geometry") {
    return (
      <>
        {/* missing setting angle warning */}
        {inspection.method === "HORIZONTAL_RANGE" &&
          missingSettingAngleUnits.length > 0 && (
          <div
            className="flex items-center gap-2 p-3 rounded-2xl border border-tv-warning bg-tv-warning/10"
            data-testid="missing-setting-angle-warning"
          >
            <AlertTriangle className="h-4 w-4 text-tv-warning flex-shrink-0" />
            <p className="text-xs text-tv-warning">
              {t("mission.config.missingSettingAngleWarning", {
                units: missingSettingAngleUnits.join(", "),
              })}
            </p>
          </div>
        )}

        {/* geometry overrides - only methods that consume them */}
        {(inspection.method === "VERTICAL_PROFILE" ||
          inspection.method === "HORIZONTAL_RANGE") && (
          <FormSection title={t("mission.config.sections.geometry")} testId="section-geometry">
          <div
            className="grid grid-cols-2 gap-3"
            data-testid="geometry-override-fields"
          >
            <div>
              <label
                htmlFor={horizontalDistanceId}
                className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
              >
                <span>{t("mission.config.horizontalDistance")}</span>
                <InfoHint
                  text={t("mission.config.horizontalDistanceHelp")}
                  label={t("mission.config.horizontalDistance")}
                  testId="hint-inspection-horizontal-distance"
                />
              </label>
              <input
                id={horizontalDistanceId}
                type="number"
                step="1"
                min="50"
                value={horizontalDistance}
                onChange={(e) =>
                  onNumberChange("horizontal_distance", e.target.value)
                }
                placeholder={t("mission.config.horizontalDistanceHint")}
                className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
                data-testid="inspection-horizontal-distance"
              />
            </div>
            {inspection.method === "HORIZONTAL_RANGE" && (
              <HorizontalRangeGeometry
                sweepAngle={sweepAngle}
                angleOffsetAbove={angleOffsetAbove}
                bufferDistance={bufferDistance}
                lhaSettingAngleOverrideId={lhaSettingAngleOverrideId}
                computedObservationAngle={computedObservationAngle}
                targetAgls={targetAgls}
                configOverride={configOverride}
                onChange={onChange}
                onNumberChange={onNumberChange}
              />
            )}
            {inspection.method === "VERTICAL_PROFILE" && (
              <VerticalProfileGeometry
                angleSource={angleSource}
                disabled={disabled}
                verticalProfilePapiMissing={verticalProfilePapiMissing}
                angleOffsetBelow={angleOffsetBelow}
                angleOffsetAbove={angleOffsetAbove}
                angleStart={angleStart}
                angleEnd={angleEnd}
                verticalProfilePreview={verticalProfilePreview}
                configOverride={configOverride}
                onChange={onChange}
                onNumberChange={onNumberChange}
              />
            )}
          </div>
          </FormSection>
        )}

        {/* buffer distance override - inlined into the top grid for hover point lock,
            and into the geometry grid for horizontal range */}
        {inspection.method !== "HOVER_POINT_LOCK" &&
          inspection.method !== "HORIZONTAL_RANGE" && (
        <div>
          <label
            htmlFor={bufferDistanceId}
            className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
          >
            <span>{t("mission.config.bufferDistanceOverride")}</span>
            <InfoHint
              text={t("mission.config.bufferDistanceOverrideHelp")}
              label={t("mission.config.bufferDistanceOverride")}
              testId="hint-inspection-buffer-distance"
            />
          </label>
          <input
            id={bufferDistanceId}
            type="number"
            step="0.5"
            min="0"
            value={bufferDistance}
            onChange={(e) =>
              onNumberChange("buffer_distance", e.target.value)
            }
            placeholder={t("mission.config.bufferDistanceOverrideHint")}
            className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
            data-testid="inspection-buffer-distance"
          />
        </div>
        )}

        {/* papi camera center-height reference - glide-slope methods only */}
        {(inspection.method === "HORIZONTAL_RANGE" ||
          inspection.method === "VERTICAL_PROFILE" ||
          inspection.method === "APPROACH_DESCENT") && (
          <PapiCenterHeightSection
            papiCenterHeightReference={papiCenterHeightReference}
            papiCenterHeightCustomM={papiCenterHeightCustomM}
            configOverride={configOverride}
            onChange={onChange}
            onNumberChange={onNumberChange}
          />
        )}

        {/* method fields that live in main config, not under camera settings */}
        {caps.formSlot === "geometry" && (
          <FormSection title={t("mission.config.sections.methodSpecific")} testId="section-method-specific">
            {renderMethodFields()}
          </FormSection>
        )}
      </>
    );
  }

  return (
    <>
      {/* method fields that render after the direction/camera blocks */}
      {caps.formSlot === "trailing" && (
        <FormSection title={t("mission.config.sections.methodSpecific")} testId="section-method-specific">
          {renderMethodFields()}
        </FormSection>
      )}

      {/* speed/framerate warning */}
      {speedWarning && (
        <div
          className="flex items-center gap-2 p-3 rounded-2xl border border-tv-warning bg-tv-warning/10"
          data-testid="speed-framerate-warning"
        >
          <AlertTriangle className="h-4 w-4 text-tv-warning flex-shrink-0" />
          <p className="text-xs text-tv-warning">
            {t("mission.config.speedFramerateWarning")}
          </p>
        </div>
      )}

      {/* zoom-over-optical validation warning */}
      {isZoomOverOptical(
        typeof opticalZoom === "number" ? opticalZoom : null,
        droneProfile?.max_optical_zoom ?? null,
      ) && (
        <div
          className="flex items-center gap-2 p-3 rounded-2xl border border-tv-warning bg-tv-warning/10"
          data-testid="zoom-over-optical-validation"
        >
          <AlertTriangle className="h-4 w-4 text-tv-warning flex-shrink-0" />
          <p className="text-xs text-tv-warning">
            {t("mission.config.cameraSettings.zoomOverOpticalWarning", {
              max: droneProfile?.max_optical_zoom,
            })}
          </p>
        </div>
      )}
    </>
  );
}
