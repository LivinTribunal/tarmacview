import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ChevronDown,
  Lightbulb,
  XCircle,
} from "lucide-react";
import type { ValidationViolation, ViolationSeverity } from "@/types/flightPlan";
import {
  type ViolationGroup,
  groupViolations,
  isGroupSelected,
  pickGroupForSelection,
} from "@/components/mission/warningsPanelGrouping";
import { cleanMessage, humanizeConstraintLabel } from "@/utils/violations";

interface MapWarningsPanelProps {
  violations: ValidationViolation[];
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
  labelKey: string;
  bgSelected: string;
}

const SEVERITY_STYLES: Record<ViolationSeverity, SeverityStyle> = {
  violation: {
    iconBg: "bg-tv-error/20",
    iconColor: "text-tv-error",
    Icon: XCircle,
    borderAccent: "border-l-tv-error",
    badgeBg: "bg-tv-error",
    labelKey: "mission.config.warningsPanel.violations",
    bgSelected: "bg-tv-error/15",
  },
  warning: {
    iconBg: "bg-tv-warning/20",
    iconColor: "text-tv-warning",
    Icon: AlertTriangle,
    borderAccent: "border-l-tv-warning",
    badgeBg: "bg-tv-warning",
    labelKey: "mission.config.warningsPanel.warnings",
    bgSelected: "bg-tv-warning/15",
  },
  suggestion: {
    iconBg: "bg-tv-text-muted/20",
    iconColor: "text-tv-text-muted",
    Icon: Lightbulb,
    borderAccent: "border-l-tv-text-muted",
    badgeBg: "bg-tv-text-muted",
    labelKey: "mission.config.warningsPanel.suggestions",
    bgSelected: "bg-tv-text-muted/15",
  },
};

function buildInitial(
  totalsBySeverity: Record<ViolationSeverity, number>,
): Record<ViolationSeverity, boolean> {
  /** apply the same auto-expand rule as the side panel: violations open, warnings open if few. */
  return {
    violation: totalsBySeverity.violation > 0,
    warning:
      totalsBySeverity.warning > 0 &&
      totalsBySeverity.warning <= WARNING_AUTO_COLLAPSE_THRESHOLD,
    suggestion: false,
  };
}

export default function MapWarningsPanel({
  violations,
  onWarningClick,
  selectedWarningId,
}: MapWarningsPanelProps) {
  /** compact map-overlay version of WarningsPanel - same grouping helper, smaller density. */
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  const sections = useMemo(() => groupViolations(violations), [violations]);
  const totals = {
    violation: sections[0].totalCount,
    warning: sections[1].totalCount,
    suggestion: sections[2].totalCount,
  };

  const [expanded, setExpanded] = useState<Record<ViolationSeverity, boolean>>(() =>
    buildInitial(totals),
  );

  const totalsKey = `${totals.violation}|${totals.warning}|${totals.suggestion}`;
  const [lastTotalsKey, setLastTotalsKey] = useState(totalsKey);
  if (totalsKey !== lastTotalsKey) {
    setLastTotalsKey(totalsKey);
    setExpanded(buildInitial(totals));
  }

  if (violations.length === 0) return null;

  function toggleSection(severity: ViolationSeverity) {
    /** flip a single severity bucket open/closed. */
    setExpanded((prev) => ({ ...prev, [severity]: !prev[severity] }));
  }

  function handleGroupClick(group: ViolationGroup) {
    /** forward as a representative violation, toggling off when the same group is re-clicked. */
    if (!onWarningClick) return;
    if (isGroupSelected(group, selectedWarningId)) {
      onWarningClick(null);
      return;
    }
    onWarningClick(pickGroupForSelection(group, selectedWarningId));
  }

  const rowClickable = Boolean(onWarningClick);

  return (
    <div
      className="rounded-2xl border border-tv-border bg-tv-bg w-full overflow-hidden flex-shrink-0"
      data-testid="map-warnings-panel"
    >
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-tv-text-primary"
      >
        <span className="rounded-full px-3 py-1 bg-tv-surface border border-tv-border">
          {t("map.warnings")}
        </span>
        <div className="flex items-center gap-1">
          {totals.violation > 0 && (
            <span className="flex items-center justify-center min-w-[1.25rem] h-5 rounded-full px-1 text-[10px] font-semibold text-white bg-tv-error">
              {totals.violation}
            </span>
          )}
          {totals.warning > 0 && (
            <span className="flex items-center justify-center min-w-[1.25rem] h-5 rounded-full px-1 text-[10px] font-semibold text-white bg-tv-warning">
              {totals.warning}
            </span>
          )}
          <ChevronDown
            className={`h-3 w-3 text-tv-text-secondary transition-transform ${collapsed ? "" : "rotate-180"}`}
          />
        </div>
      </button>

      {!collapsed && (
        <div className="border-t border-tv-border p-2 flex flex-col gap-2">
          {sections.map((section) => {
            if (section.totalCount === 0) return null;
            const style = SEVERITY_STYLES[section.severity];
            const isExpanded = expanded[section.severity];
            return (
              <div
                key={section.severity}
                data-testid={`map-warnings-section-${section.severity}`}
                data-expanded={isExpanded}
                className="rounded-xl border border-tv-border bg-tv-surface overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleSection(section.severity)}
                  aria-expanded={isExpanded}
                  className="flex w-full items-center justify-between px-2.5 py-1.5 hover:bg-tv-surface-hover transition-colors"
                  data-testid={`map-warnings-section-${section.severity}-toggle`}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`flex items-center justify-center h-4 w-4 rounded-full ${style.iconBg}`}
                    >
                      <style.Icon className={`h-2.5 w-2.5 ${style.iconColor}`} />
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-tv-text-secondary">
                      {t(style.labelKey)}
                    </span>
                    <span
                      className={`flex items-center justify-center min-w-[1.25rem] h-5 rounded-full px-1 text-[10px] font-semibold text-white ${style.badgeBg}`}
                    >
                      {section.totalCount}
                    </span>
                  </span>
                  <ChevronDown
                    className={`h-3 w-3 text-tv-text-secondary transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                  />
                </button>

                {isExpanded && (
                  <ul className="border-t border-tv-border divide-y divide-tv-border bg-tv-bg max-h-56 overflow-y-auto">
                    {section.groups.map((group) => {
                      const selected = isGroupSelected(group, selectedWarningId);
                      const label = humanizeConstraintLabel(group.constraintName, group.message);
                      const rawMessage = cleanMessage(group.message);
                      return (
                        <li
                          key={group.key}
                          data-testid={`warnings-row-${group.key}`}
                          data-selected={selected}
                          onClick={rowClickable ? () => handleGroupClick(group) : undefined}
                          onKeyDown={
                            rowClickable
                              ? (e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    handleGroupClick(group);
                                  }
                                }
                              : undefined
                          }
                          role={rowClickable ? "button" : undefined}
                          tabIndex={rowClickable ? 0 : undefined}
                          className={`flex flex-col gap-1 px-2.5 py-1.5 ${
                            rowClickable ? "cursor-pointer hover:bg-tv-surface-hover" : ""
                          } ${selected ? `border-l-4 ${style.borderAccent} ${style.bgSelected}` : ""}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span
                              className="text-[12px] text-tv-text-primary leading-snug"
                              title={rawMessage}
                            >
                              {label}
                            </span>
                            {group.affectedWaypointIds.length > 1 && (
                              <span className="text-[10px] text-tv-text-muted whitespace-nowrap mt-0.5">
                                ×{group.affectedWaypointIds.length}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1">
                            {group.waypointRefs.length === 0 ? (
                              <span className="text-[10px] rounded-full border border-tv-border bg-tv-surface px-1.5 py-0.5 text-tv-text-muted">
                                {t("mission.config.warningsPanel.global")}
                              </span>
                            ) : (
                              group.waypointRefs.map((ref) => (
                                <span
                                  key={ref}
                                  className="text-[10px] rounded-full border border-tv-border bg-tv-surface px-1.5 py-0.5 text-tv-text-secondary"
                                >
                                  {ref}
                                </span>
                              ))
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
