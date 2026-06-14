import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Crosshair, Info, RotateCcw } from "lucide-react";
import type { InspectionConfigOverride } from "@/types/mission";
import InfoHint from "@/components/common/InfoHint";
import useAngleLock from "@/hooks/useAngleLock";

interface HoverPointLockFieldsProps {
  distanceFromLha: number | "";
  heightAboveLha: number | "";
  cameraGimbalAngle: number | "";
  hoverBearing: number | "";
  hoverBearingReference: "RUNWAY" | "COMPASS";
  angleLocked: boolean;
  onAngleLockedToggle: () => void;
  configOverride: InspectionConfigOverride;
  onChange: (override: InspectionConfigOverride) => void;
  onNumberChange: (field: keyof InspectionConfigOverride, raw: string) => void;
}

export default function HoverPointLockFields({
  distanceFromLha,
  heightAboveLha,
  cameraGimbalAngle,
  hoverBearing,
  hoverBearingReference,
  angleLocked,
  onAngleLockedToggle,
  configOverride,
  onChange,
  onNumberChange,
}: HoverPointLockFieldsProps) {
  /** hover-point-lock geometry: angle-lock triangle, distance/height/gimbal, approach bearing. */
  const { t } = useTranslation();
  const distanceId = useId();
  const heightId = useId();
  const gimbalId = useId();
  const { onDistanceChange, onHeightChange, onAngleChange } = useAngleLock({
    angleLocked,
    configOverride,
    onChange,
    distanceFromLha,
    cameraGimbalAngle,
  });

  return (
    <div className="space-y-3" data-testid="hover-point-lock-fields">
      {/* auto-aim toggle: trig-locks the distance/height/angle triangle */}
      <div className="rounded-2xl border border-tv-border bg-tv-bg/50 p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <Crosshair className="h-3.5 w-3.5 text-tv-text-secondary flex-shrink-0" />
            <label className="flex items-center gap-1 text-xs font-medium text-tv-text-primary truncate">
              <span>{t("mission.config.angleLock")}</span>
              <InfoHint
                text={t("mission.config.angleLockHelp")}
                label={t("mission.config.angleLock")}
                testId="hint-inspection-angle-lock"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={onAngleLockedToggle}
            role="switch"
            aria-checked={angleLocked}
            aria-label={t("mission.config.angleLock")}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
              angleLocked ? "bg-tv-accent" : "bg-tv-border"
            }`}
            data-testid="angle-lock-toggle"
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                angleLocked ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
        <div className="flex items-start gap-1.5 text-xs text-tv-text-secondary leading-snug">
          <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span>{t("mission.config.angleLockHint")}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label
            htmlFor={distanceId}
            className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
          >
            <span>{t("mission.config.distanceFromLha")}</span>
            <InfoHint
              text={t("mission.config.distanceFromLhaHelp")}
              label={t("mission.config.distanceFromLha")}
              testId="hint-inspection-distance-from-lha"
            />
          </label>
          <input
            id={distanceId}
            type="number"
            step="0.5"
            min="0"
            value={distanceFromLha}
            onChange={(e) => onDistanceChange(e.target.value)}
            placeholder={t("mission.config.distanceFromLhaHint")}
            className="w-full px-2 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
            data-testid="inspection-distance-from-lha"
          />
        </div>
        <div>
          <label
            htmlFor={heightId}
            className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
          >
            <span>{t("mission.config.heightAboveLha")}</span>
            <InfoHint
              text={t("mission.config.heightAboveLhaHelp")}
              label={t("mission.config.heightAboveLha")}
              testId="hint-inspection-height-above-lha"
            />
          </label>
          <input
            id={heightId}
            type="number"
            step="0.5"
            min="0"
            value={heightAboveLha}
            onChange={(e) => onHeightChange(e.target.value)}
            placeholder={t("mission.config.heightAboveLhaHint")}
            className="w-full px-2 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
            data-testid="inspection-height-above-lha"
          />
        </div>
        <div>
          <label
            htmlFor={gimbalId}
            className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary"
          >
            <span>{t("mission.config.cameraGimbalAngle")}</span>
            <InfoHint
              text={t("mission.config.cameraGimbalAngleHelp")}
              label={t("mission.config.cameraGimbalAngle")}
              testId="hint-inspection-hpl-gimbal-angle"
            />
          </label>
          <input
            id={gimbalId}
            type="number"
            step="1"
            min="-90"
            max="0"
            value={cameraGimbalAngle}
            onChange={(e) => onAngleChange(e.target.value)}
            placeholder={t("mission.config.cameraGimbalAngleHint")}
            className="w-full px-2 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
            data-testid="inspection-camera-gimbal-angle"
          />
        </div>
      </div>

      {/* approach bearing: where the drone sits relative to the LHA */}
      <div className="rounded-2xl border border-tv-border bg-tv-bg/50 p-3 space-y-2">
        <label className="flex items-center gap-1 text-xs font-medium text-tv-text-primary">
          <span>{t("mission.config.hoverBearing")}</span>
          <InfoHint
            text={t("mission.config.hoverBearingHelp")}
            label={t("mission.config.hoverBearing")}
            testId="hint-inspection-hover-bearing"
          />
        </label>
        <div className="flex gap-1 rounded-full bg-tv-bg border border-tv-border p-0.5">
          {(["RUNWAY", "COMPASS"] as const).map((ref) => (
            <button
              key={ref}
              type="button"
              onClick={() =>
                onChange({ ...configOverride, hover_bearing_reference: ref })
              }
              className={`flex-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                hoverBearingReference === ref
                  ? "bg-tv-accent text-tv-accent-text"
                  : "text-tv-text-secondary hover:text-tv-text-primary"
              }`}
              data-testid={`hover-bearing-ref-${ref.toLowerCase()}`}
            >
              {t(`mission.config.hoverBearingRef.${ref}`)}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 items-center justify-end">
          <input
            type="number"
            step="1"
            min="-360"
            max="360"
            value={hoverBearing}
            aria-label={t("mission.config.hoverBearing")}
            onChange={(e) =>
              onNumberChange("hover_bearing", e.target.value)
            }
            placeholder={t(
              hoverBearingReference === "COMPASS"
                ? "mission.config.hoverBearingCompassHint"
                : "mission.config.hoverBearingRunwayHint",
            )}
            className="w-48 px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary text-right placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
            data-testid="inspection-hover-bearing"
          />
          <button
            type="button"
            onClick={() => {
              const current = parseFloat(String(hoverBearing));
              if (!isNaN(current)) {
                onChange({ ...configOverride, hover_bearing: (current + 180) % 360 });
              }
            }}
            className="flex items-center gap-1 px-2 py-1.5 rounded-full text-[10px] border border-tv-border text-tv-text-secondary hover:bg-tv-surface-hover transition-colors flex-shrink-0"
            title={t("coordinator.detail.oppositeHeading")}
            data-testid="inspection-hover-bearing-opposite"
          >
            <RotateCcw className="h-3 w-3" />
            {t("coordinator.detail.opposite")}
          </button>
        </div>
        <p className="text-xs text-tv-text-secondary leading-snug">
          {t(
            hoverBearingReference === "COMPASS"
              ? "mission.config.hoverBearingCompassHelp"
              : "mission.config.hoverBearingRunwayHelp",
          )}
        </p>
      </div>
    </div>
  );
}
