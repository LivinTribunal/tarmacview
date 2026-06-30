import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { InspectionResponse, InspectionConfigOverride } from "@/types/mission";
import InfoHint from "@/components/common/InfoHint";
import FormSection from "@/components/common/FormSection";
import { aglTypesForMethod, methodCaps } from "@/utils/methodAglCompatibility";
import { DEFAULT_GLIDE_SLOPE_ANGLE_TOLERANCE } from "@/constants/infrastructureDefaults";

interface FlightParametersSectionProps {
  inspection: InspectionResponse;
  altitudeOffset: number | "";
  measurementSpeedOverride: number | "";
  measurementDensity: number | "";
  bufferDistance: number | "";
  hoverDuration: number | "";
  glideSlopeAngleTolerance: number | "";
  speedWarning: boolean;
  onNumberChange: (field: keyof InspectionConfigOverride, raw: string) => void;
}

export default function FlightParametersSection({
  inspection,
  altitudeOffset,
  measurementSpeedOverride,
  measurementDensity,
  bufferDistance,
  hoverDuration,
  glideSlopeAngleTolerance,
  speedWarning,
  onNumberChange,
}: FlightParametersSectionProps) {
  /** flight-parameters section: altitude offset, speed/density overrides, buffer + hover duration. */
  const { t } = useTranslation();
  const caps = methodCaps(inspection.method);
  // glidepath tolerance only makes sense for PAPI methods (results-time verdict)
  const isPapi = aglTypesForMethod(inspection.method).includes("PAPI");
  const altitudeOffsetId = useId();
  const speedId = useId();
  const densityId = useId();
  const bufferId = useId();
  const hoverId = useId();
  const glideSlopeToleranceId = useId();
  return (
    <FormSection title={t("mission.config.sections.flightParameters")} testId="section-flight-parameters">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor={altitudeOffsetId}
            className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
          >
            <span>{t("mission.config.altitudeOffset")}</span>
            <InfoHint
              text={t("mission.config.altitudeOffsetHelp")}
              label={t("mission.config.altitudeOffset")}
              testId="hint-inspection-altitude-offset"
            />
          </label>
          <input
            id={altitudeOffsetId}
            type="number"
            step="0.1"
            value={altitudeOffset}
            onChange={(e) =>
              onNumberChange("altitude_offset", e.target.value)
            }
            className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
            data-testid="inspection-altitude-offset"
          />
        </div>
        {caps.usesMeasurementSpeed && (
          <div>
            <label
              htmlFor={speedId}
              className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
            >
              <span>{t("mission.config.measurementSpeedOverride")}</span>
              <InfoHint
                text={t("mission.config.measurementSpeedOverrideHelp")}
                label={t("mission.config.measurementSpeedOverride")}
                testId="hint-inspection-measurement-speed"
              />
            </label>
            <input
              id={speedId}
              type="number"
              step="0.1"
              min="0"
              value={measurementSpeedOverride}
              onChange={(e) =>
                onNumberChange("measurement_speed_override", e.target.value)
              }
              placeholder={t("mission.config.measurementSpeedOverrideHint")}
              className={`w-full px-3 py-2 rounded-full text-sm border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors ${
                speedWarning ? "border-tv-warning" : "border-tv-border"
              }`}
              data-testid="inspection-measurement-speed-override"
            />
          </div>
        )}
        {caps.usesDensity && (
          <div>
            <label
              htmlFor={densityId}
              className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
            >
              <span>{t("mission.config.measurementDensity")}</span>
              <InfoHint
                text={t("mission.config.measurementDensityHelp")}
                label={t("mission.config.measurementDensity")}
                testId="hint-inspection-measurement-density"
              />
            </label>
            <input
              id={densityId}
              type="number"
              step="1"
              min="0"
              value={measurementDensity}
              onChange={(e) =>
                onNumberChange("measurement_density", e.target.value)
              }
              className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
              data-testid="inspection-measurement-density"
            />
          </div>
        )}
        {inspection.method === "HOVER_POINT_LOCK" && (
          <div>
            <label
              htmlFor={bufferId}
              className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
            >
              <span>{t("mission.config.bufferDistanceOverride")}</span>
              <InfoHint
                text={t("mission.config.bufferDistanceOverrideHelp")}
                label={t("mission.config.bufferDistanceOverride")}
                testId="hint-inspection-buffer-distance-hpl"
              />
            </label>
            <input
              id={bufferId}
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
        {/* a surface-scan snake has no hovers - the video dwell rides on
            recording_setup_duration instead */}
        {caps.usesHover && (
          <div>
            <label
              htmlFor={hoverId}
              className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
            >
              <span>{t("mission.config.hoverDuration")}</span>
              <InfoHint
                text={t("mission.config.hoverDurationHelp")}
                label={t("mission.config.hoverDuration")}
                testId="hint-inspection-hover-duration"
              />
            </label>
            <input
              id={hoverId}
              type="number"
              step="0.1"
              min="0"
              value={hoverDuration}
              onChange={(e) =>
                onNumberChange("hover_duration", e.target.value)
              }
              className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
              data-testid="inspection-hover-duration"
            />
          </div>
        )}
        {isPapi && (
          <div>
            <label
              htmlFor={glideSlopeToleranceId}
              className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
            >
              <span>{t("mission.config.glideSlopeAngleTolerance")}</span>
              <InfoHint
                text={t("mission.config.glideSlopeAngleToleranceHelp")}
                label={t("mission.config.glideSlopeAngleTolerance")}
                testId="hint-inspection-glide-slope-tolerance"
              />
            </label>
            <input
              id={glideSlopeToleranceId}
              type="number"
              step="0.1"
              min="0"
              value={glideSlopeAngleTolerance}
              onChange={(e) =>
                onNumberChange("glide_slope_angle_tolerance", e.target.value)
              }
              placeholder={DEFAULT_GLIDE_SLOPE_ANGLE_TOLERANCE}
              className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
              data-testid="inspection-glide-slope-tolerance"
            />
          </div>
        )}
      </div>
    </FormSection>
  );
}
