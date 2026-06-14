import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Lightbulb,
  XCircle,
} from "lucide-react";
import type { ValidationViolation, ViolationSeverity } from "@/types/flightPlan";
import { cleanMessage, humanizeConstraintLabel } from "@/utils/violations";
import {
  type SeveritySection,
  type ViolationGroup,
  groupViolations,
  isGroupSelected,
  pickGroupForSelection,
} from "./warningsPanelGrouping";

interface WarningsPanelProps {
  warnings: ValidationViolation[] | null;
  hasTrajectory: boolean;
  onWarningClick?: (violation: ValidationViolation | null) => void;
  selectedWarningId?: string | null;
}

const WARNING_AUTO_COLLAPSE_THRESHOLD = 5;

interface SeverityStyle {
  iconBg: string;
  iconColor: string;
  Icon: typeof XCircle;
  borderAccent: string;
  badgeBg: string;
  bgSelected: string;
}

const SEVERITY_STYLES: Record<ViolationSeverity, SeverityStyle> = {
  violation: {
    iconBg: "bg-tv-error/20",
    iconColor: "text-tv-error",
    Icon: XCircle,
    borderAccent: "border-l-tv-error",
    badgeBg: "bg-tv-error",
    bgSelected: "bg-tv-error/15",
  },
  warning: {
    iconBg: "bg-tv-warning/20",
    iconColor: "text-tv-warning",
    Icon: AlertTriangle,
    borderAccent: "border-l-tv-warning",
    badgeBg: "bg-tv-warning",
    bgSelected: "bg-tv-warning/15",
  },
  suggestion: {
    iconBg: "bg-tv-text-muted/20",
    iconColor: "text-tv-text-muted",
    Icon: Lightbulb,
    borderAccent: "border-l-tv-text-muted",
    badgeBg: "bg-tv-text-muted",
    bgSelected: "bg-tv-text-muted/15",
  },
};

function defaultExpandFor(section: SeveritySection): boolean {
  /** violations always open, warnings open under threshold, suggestions collapsed by default. */
  if (section.totalCount === 0) return false;
  if (section.severity === "violation") return true;
  if (section.severity === "warning") return section.totalCount <= WARNING_AUTO_COLLAPSE_THRESHOLD;
  return false;
}

function buildInitialExpanded(sections: SeveritySection[]): Record<ViolationSeverity, boolean> {
  /** seed expanded state from the per-section default rule. */
  return {
    violation: defaultExpandFor(sections[0]),
    warning: defaultExpandFor(sections[1]),
    suggestion: defaultExpandFor(sections[2]),
  };
}

export default function WarningsPanel({
  warnings,
  hasTrajectory,
  onWarningClick,
  selectedWarningId,
}: WarningsPanelProps) {
  /** grouped, collapsible warnings panel - violations / warnings / suggestions. */
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  const sections = useMemo(() => groupViolations(warnings), [warnings]);
  const totalCount = sections.reduce((acc, s) => acc + s.totalCount, 0);
  const violationCount = sections[0].totalCount;
  const warningCount = sections[1].totalCount;

  const [expanded, setExpanded] = useState<Record<ViolationSeverity, boolean>>(() =>
    buildInitialExpanded(sections),
  );

  // resync expanded state when totals change so the auto-rule still applies after recompute.
  const totalsKey = `${sections[0].totalCount}|${sections[1].totalCount}|${sections[2].totalCount}`;
  const [lastTotalsKey, setLastTotalsKey] = useState(totalsKey);
  if (totalsKey !== lastTotalsKey) {
    setLastTotalsKey(totalsKey);
    setExpanded(buildInitialExpanded(sections));
  }

  function toggleSection(severity: ViolationSeverity) {
    /** flip the collapsed state of a single severity section. */
    setExpanded((prev) => ({ ...prev, [severity]: !prev[severity] }));
  }

  function handleGroupClick(group: ViolationGroup) {
    /** forward the click as a representative violation, or null when toggling the same group off. */
    if (!onWarningClick) return;
    if (isGroupSelected(group, selectedWarningId)) {
      onWarningClick(null);
      return;
    }
    onWarningClick(pickGroupForSelection(group, selectedWarningId));
  }

  return (
    <div data-testid="warnings-panel">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-between w-full text-sm font-semibold text-tv-text-primary"
      >
        <span className="rounded-full px-3 py-1 bg-tv-bg border border-tv-border">
          {t("mission.config.warningsPanel.title")}
        </span>
        <div className="flex items-center gap-2">
          {warningCount > 0 && (
            <span className="flex items-center justify-center min-w-[1.5rem] h-6 rounded-full px-1.5 text-xs font-semibold text-white bg-tv-warning">
              {warningCount}
            </span>
          )}
          {violationCount > 0 && (
            <span className="flex items-center justify-center min-w-[1.5rem] h-6 rounded-full px-1.5 text-xs font-semibold text-white bg-tv-error">
              {violationCount}
            </span>
          )}
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`}
          />
        </div>
      </button>
      {!collapsed && <div className="border-b border-tv-border -mx-4 mt-3" />}

      {!collapsed && (
        <div className="mt-3">
          {!hasTrajectory && (
            <p className="text-sm text-tv-text-muted">
              {t("mission.config.warningsPanel.noTrajectory")}
            </p>
          )}

          {hasTrajectory && totalCount === 0 && (
            <div
              data-testid="warnings-empty-state"
              className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-tv-border bg-tv-bg px-4 py-6 text-center"
            >
              <CheckCircle2 className="h-7 w-7 text-tv-accent" />
              <span className="text-sm font-semibold text-tv-text-primary">
                {t("mission.config.warningsPanel.noIssues")}
              </span>
              <span className="text-xs text-tv-text-muted">
                {t("mission.config.warningsPanel.noIssuesHint")}
              </span>
            </div>
          )}

          {hasTrajectory && totalCount > 0 && (
            <div className="flex flex-col gap-2" data-testid="warnings-sections">
              {sections.map((section) => (
                <SeveritySectionView
                  key={section.severity}
                  section={section}
                  expanded={expanded[section.severity]}
                  onToggle={() => toggleSection(section.severity)}
                  onGroupClick={handleGroupClick}
                  rowClickable={Boolean(onWarningClick)}
                  selectedWarningId={selectedWarningId}
                  density="default"
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface SeveritySectionViewProps {
  section: SeveritySection;
  expanded: boolean;
  onToggle: () => void;
  onGroupClick: (group: ViolationGroup) => void;
  rowClickable: boolean;
  selectedWarningId?: string | null;
  density: "default" | "compact";
}

function SeveritySectionView({
  section,
  expanded,
  onToggle,
  onGroupClick,
  rowClickable,
  selectedWarningId,
  density,
}: SeveritySectionViewProps) {
  /** one severity bucket header + body shared between WarningsPanel and MapWarningsPanel. */
  const { t } = useTranslation();
  if (section.totalCount === 0) return null;

  const labelKey: Record<ViolationSeverity, string> = {
    violation: "mission.config.warningsPanel.violations",
    warning: "mission.config.warningsPanel.warnings",
    suggestion: "mission.config.warningsPanel.suggestions",
  };
  const style = SEVERITY_STYLES[section.severity];
  const compact = density === "compact";

  const headerPad = compact ? "px-2.5 py-1.5" : "px-3 py-2";
  const headerText = compact ? "text-[11px]" : "text-xs";
  const sectionTestId =
    density === "compact"
      ? `map-warnings-section-${section.severity}`
      : `warnings-section-${section.severity}`;

  return (
    <div
      data-testid={sectionTestId}
      data-expanded={expanded}
      className="rounded-2xl border border-tv-border bg-tv-bg overflow-hidden"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={
          expanded
            ? t("mission.config.warningsPanel.collapseSection")
            : t("mission.config.warningsPanel.expandSection")
        }
        className={`flex w-full items-center justify-between ${headerPad} hover:bg-tv-surface-hover transition-colors`}
        data-testid={`${sectionTestId}-toggle`}
      >
        <span className="flex items-center gap-2">
          <span
            className={`flex items-center justify-center ${compact ? "h-4 w-4" : "h-5 w-5"} rounded-full ${style.iconBg}`}
          >
            <style.Icon className={`${compact ? "h-2.5 w-2.5" : "h-3 w-3"} ${style.iconColor}`} />
          </span>
          <span className={`${headerText} font-semibold uppercase tracking-wide text-tv-text-secondary`}>
            {t(labelKey[section.severity])}
          </span>
          <span
            className={`flex items-center justify-center ${compact ? "min-w-[1.25rem] h-5 text-[10px]" : "min-w-[1.5rem] h-6 text-xs"} rounded-full px-1.5 font-semibold text-white ${style.badgeBg}`}
          >
            {section.totalCount}
          </span>
        </span>
        <ChevronDown
          className={`${compact ? "h-3 w-3" : "h-4 w-4"} text-tv-text-secondary transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <ul className="border-t border-tv-border divide-y divide-tv-border max-h-72 overflow-y-auto">
          {section.groups.map((group) => (
            <ViolationGroupRow
              key={group.key}
              group={group}
              severity={section.severity}
              onClick={() => onGroupClick(group)}
              selected={isGroupSelected(group, selectedWarningId)}
              clickable={rowClickable}
              density={density}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface ViolationGroupRowProps {
  group: ViolationGroup;
  severity: ViolationSeverity;
  onClick: () => void;
  selected: boolean;
  clickable: boolean;
  density: "default" | "compact";
}

function ViolationGroupRow({
  group,
  severity,
  onClick,
  selected,
  clickable,
  density,
}: ViolationGroupRowProps) {
  /** single grouped row: humanized constraint label + waypoint chips, raw message in tooltip. */
  const { t } = useTranslation();
  const compact = density === "compact";
  const style = SEVERITY_STYLES[severity];
  const label = humanizeConstraintLabel(group.constraintName, group.message);
  const rawMessage = cleanMessage(group.message);

  const padding = compact ? "px-2.5 py-1.5" : "px-3 py-2.5";
  const labelClass = compact ? "text-[12px]" : "text-sm";
  const subClass = compact ? "text-[10px]" : "text-xs";

  const rowSelectedAccent = selected ? `border-l-4 ${style.borderAccent} ${style.bgSelected}` : "";

  return (
    <li
      onClick={clickable ? onClick : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      data-testid={`warnings-row-${group.key}`}
      data-selected={selected}
      className={`flex flex-col gap-1.5 ${padding} ${
        clickable ? "cursor-pointer hover:bg-tv-surface-hover" : ""
      } ${rowSelectedAccent}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={`${labelClass} text-tv-text-primary leading-snug`}
          title={rawMessage}
        >
          {label}
        </span>
        {group.affectedWaypointIds.length > 1 && (
          <span className={`${subClass} text-tv-text-muted whitespace-nowrap mt-0.5`}>
            ×{group.affectedWaypointIds.length}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {group.waypointRefs.length === 0 ? (
          <span
            className={`${subClass} rounded-full border border-tv-border bg-tv-surface px-2 py-0.5 text-tv-text-muted`}
          >
            {t("mission.config.warningsPanel.global")}
          </span>
        ) : (
          group.waypointRefs.map((ref) => (
            <span
              key={ref}
              className={`${subClass} rounded-full border border-tv-border bg-tv-surface px-2 py-0.5 text-tv-text-secondary`}
            >
              {ref}
            </span>
          ))
        )}
      </div>
    </li>
  );
}
