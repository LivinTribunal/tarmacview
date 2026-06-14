import { useTranslation } from "react-i18next";
import { Lightbulb, Navigation } from "lucide-react";
import type { ValidationViolation, ViolationSeverity } from "@/types/flightPlan";
import FeatureInfoPanel from "@/components/common/FeatureInfoPanel";
import Button from "@/components/common/Button";
import { cleanMessage } from "@/utils/violations";

interface WarningInfoPanelProps {
  violation: ValidationViolation;
  onClose: () => void;
  onGoToWaypoint?: (id: string) => void;
}

const TITLE_KEY_BY_SEVERITY: Record<ViolationSeverity, string> = {
  violation: "map.violationInfoTitle",
  warning: "map.warningInfoTitle",
  suggestion: "map.suggestionInfoTitle",
};

const TITLE_BORDER_BY_SEVERITY: Record<ViolationSeverity, string | undefined> = {
  violation: "border-2 border-tv-error",
  warning: "border-2 border-tv-warning",
  suggestion: undefined,
};

interface ParsedValues {
  actual?: string;
  actualKey?: string;
  expected?: string;
  suggestionKey?: string;
  suggestionParams?: Record<string, string>;
}

/** structured-kind suggestion i18n keys; independent of message wording. */
const SUGGESTION_KEY_BY_KIND: Record<string, string> = {
  surface_crossing: "map.warningSuggestion.surfaceCrossing",
  camera_obstruction: "map.warningSuggestion.cameraObstruction",
  safety_zone: "map.warningSuggestion.safetyZone",
  battery: "map.warningSuggestion.battery",
  measurement_density: "map.warningSuggestion.measurementDensity",
};

/** parse details from a violation: kind drives classification, message text is fallback. */
function parseMessageValues(message: string, kind: string | null): ParsedValues {
  const result: ParsedValues = {};

  // kind-driven branch first - does not depend on message format. surface
  // crossings come in two message shapes (per-transit "(Nm)" and grouped
  // "(K segments)"); kind unifies them so detail renders for both.
  if (kind && kind in SUGGESTION_KEY_BY_KIND) {
    if (kind === "surface_crossing") {
      const cross = message.match(/crosses\s+(\w+\s+\S+)\s+\((\d+)m\)/i);
      if (cross) {
        result.actual = `${cross[2]}m crossing ${cross[1]}`;
      } else {
        result.actualKey = "map.warningActualCrossing";
      }
    }
    result.suggestionKey = SUGGESTION_KEY_BY_KIND[kind];
    return result;
  }

  // speed exceeds: "speed 5.0 m/s exceeds optimal 3.2 m/s for frame rate 30 fps"
  const speedMatch = message.match(/speed ([\d.]+\s*m\/s).*(?:optimal|max speed) ([\d.]+\s*m\/s)/i);
  if (speedMatch) {
    result.actual = speedMatch[1];
    result.expected = `≤ ${speedMatch[2]}`;
    result.suggestionKey = "map.warningSuggestion.speed";
    return result;
  }

  // altitude exceeds: "waypoint alt 350m exceeds drone max altitude 300m"
  const altMatch = message.match(/alt(?:itude)? ([\d.]+\s*m).*max altitude ([\d.]+\s*m)/i);
  if (altMatch) {
    result.actual = altMatch[1];
    result.expected = `≤ ${altMatch[2]}`;
    result.suggestionKey = "map.warningSuggestion.altitude";
    return result;
  }

  // obstacle: "waypoint at 350m intersects obstacle 'X' (top: 360m)"
  const obsMatch = message.match(/at ([\d.]+\s*m).*obstacle.*top:\s*([\d.]+\s*m)/i);
  if (obsMatch) {
    result.actual = obsMatch[1];
    result.expected = `> ${obsMatch[2]}`;
    result.suggestionKey = "map.warningSuggestion.obstacle";
    return result;
  }

  // FOV: "LHA array span 95.0 exceeds sensor FOV 84.0 at 50m"
  const fovMatch = message.match(/span ([\d.]+).*FOV ([\d.]+).*at ([\d.]+\s*m)/i);
  if (fovMatch) {
    result.actual = `${fovMatch[1]}°`;
    result.expected = `≤ ${fovMatch[2]}°`;
    result.suggestionKey = "map.warningSuggestion.fov";
    result.suggestionParams = { distance: fovMatch[3] };
    return result;
  }

  // crossing: "crosses RUNWAY X (150m)"
  const crossMatch = message.match(/crosses\s+(\w+\s+\S+)\s+\((\d+)m\)/i);
  if (crossMatch) {
    result.actual = `${crossMatch[2]}m crossing ${crossMatch[1]}`;
    result.suggestionKey = "map.warningSuggestion.surfaceCrossing";
    return result;
  }

  // legacy message fallbacks below - reached only when kind is null (kinds in
  // SUGGESTION_KEY_BY_KIND already returned above).

  // camera obstruction
  if (message.includes("obstructed")) {
    result.suggestionKey = "map.warningSuggestion.cameraObstruction";
    return result;
  }

  // safety zone
  if (message.includes("zone")) {
    result.suggestionKey = "map.warningSuggestion.safetyZone";
    return result;
  }

  // battery
  if (message.includes("battery")) {
    result.suggestionKey = "map.warningSuggestion.battery";
    return result;
  }

  // density
  if (message.includes("density")) {
    result.suggestionKey = "map.warningSuggestion.measurementDensity";
    return result;
  }

  // default suggestions
  if (message.includes("default")) {
    result.suggestionKey = "map.warningSuggestion.defaultOverride";
    return result;
  }

  return result;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  /** key-value row for violation details. */
  return (
    <div className="flex justify-between text-xs">
      <span className="text-tv-text-muted">{label}</span>
      <span className="text-tv-text-primary font-medium">{value}</span>
    </div>
  );
}

export default function WarningInfoPanel({
  violation,
  onClose,
  onGoToWaypoint,
}: WarningInfoPanelProps) {
  /** detail panel for a selected warning/violation. */
  const { t } = useTranslation();

  const hasWaypoints = violation.waypoint_ids.length > 0;
  const isSingleWaypoint = violation.waypoint_ids.length === 1;
  const parsed = parseMessageValues(violation.message, violation.violation_kind ?? null);

  return (
    <FeatureInfoPanel
      title={t(TITLE_KEY_BY_SEVERITY[violation.severity])}
      titleBorderClass={TITLE_BORDER_BY_SEVERITY[violation.severity]}
      onClose={onClose}
      actions={
        isSingleWaypoint && onGoToWaypoint ? (
          <Button
            variant="secondary"
            onClick={() => onGoToWaypoint(violation.waypoint_ids[0])}
            className="text-xs"
          >
            <Navigation className="h-3 w-3 mr-1" />
            {t("map.warningGoToWaypoint")}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-2">
        {violation.constraint_name && (
          <InfoRow label={t("map.warningConstraint")} value={violation.constraint_name} />
        )}

        <p className="text-sm text-tv-text-primary leading-relaxed">
          {cleanMessage(violation.message)}
        </p>

        {(parsed.actual || parsed.actualKey) && (
          <InfoRow
            label={t("map.warningActual")}
            value={parsed.actual ?? t(parsed.actualKey as string)}
          />
        )}

        {parsed.expected && (
          <InfoRow label={t("map.warningExpected")} value={parsed.expected} />
        )}

        {parsed.suggestionKey && (
          <div className="flex gap-1 text-xs">
            <Lightbulb className="h-3 w-3 text-tv-text-muted flex-shrink-0 mt-0.5" />
            <span className="text-tv-text-muted italic">
              {t(parsed.suggestionKey, parsed.suggestionParams)}
            </span>
          </div>
        )}

        {hasWaypoints ? (
          <InfoRow
            label={t("map.warningAffectedWaypoints")}
            value={violation.waypoint_ref ?? String(violation.waypoint_ids.length)}
          />
        ) : (
          <p className="text-xs text-tv-text-muted italic">
            {t("map.warningGlobalWarning")}
          </p>
        )}
      </div>
    </FeatureInfoPanel>
  );
}
