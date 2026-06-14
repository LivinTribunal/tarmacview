/**
 * groups validation violations by severity and violation kind for compact display.
 */

import type { ValidationViolation, ViolationSeverity } from "@/types/flightPlan";

const SEVERITY_ORDER: ViolationSeverity[] = ["violation", "warning", "suggestion"];

export interface ViolationGroup {
  /** stable key identifying the group within its severity. */
  key: string;
  /** structured violation_kind when present, else null (legacy rows). */
  violationKind: string | null;
  /** raw constraint_name when present, else null. */
  constraintName: string | null;
  /** representative message used as fallback label. */
  message: string;
  /** waypoint refs collected across collapsed violations, deduped, in input order. */
  waypointRefs: string[];
  /** ids of every violation absorbed into this group. */
  ids: string[];
  /** unique waypoint ids touched by this group (matches what the map highlights). */
  affectedWaypointIds: string[];
  /** the violations folded into this group, kept for click-through. */
  violations: ValidationViolation[];
}

export interface SeveritySection {
  severity: ViolationSeverity;
  groups: ViolationGroup[];
  totalCount: number;
}

/** group violations by severity, then collapse same-kind violations into one group with waypoint chips. */
export function groupViolations(
  violations: ValidationViolation[] | null | undefined,
): SeveritySection[] {
  const sections: SeveritySection[] = SEVERITY_ORDER.map((severity) => ({
    severity,
    groups: [],
    totalCount: 0,
  }));
  if (!violations || violations.length === 0) return sections;

  const indexBySeverity: Record<ViolationSeverity, Map<string, ViolationGroup>> = {
    violation: new Map(),
    warning: new Map(),
    suggestion: new Map(),
  };

  for (const v of violations) {
    const section = sections.find((s) => s.severity === v.severity);
    if (!section) continue;
    section.totalCount += 1;

    // prefer structured violation_kind so two warnings of the same kind collapse
    // regardless of message wording; constraint_name -> __msg__ stays the
    // legacy fallback for rows persisted before violation_kind existed.
    const groupKey = v.violation_kind ?? v.constraint_name ?? `__msg__:${v.message}`;
    const groups = indexBySeverity[v.severity];
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        key: groupKey,
        violationKind: v.violation_kind,
        constraintName: v.constraint_name,
        message: v.message,
        waypointRefs: [],
        ids: [],
        affectedWaypointIds: [],
        violations: [],
      };
      groups.set(groupKey, group);
      section.groups.push(group);
    }
    group.ids.push(v.id);
    group.violations.push(v);
    if (v.waypoint_ref && !group.waypointRefs.includes(v.waypoint_ref)) {
      group.waypointRefs.push(v.waypoint_ref);
    }
    for (const wpid of v.waypoint_ids) {
      if (!group.affectedWaypointIds.includes(wpid)) {
        group.affectedWaypointIds.push(wpid);
      }
    }
  }

  return sections;
}

/** representative violation with waypoint_ids merged across the whole group, so the map highlights every affected waypoint. */
export function pickGroupForSelection(
  group: ViolationGroup,
  selectedWarningId: string | null | undefined,
): ValidationViolation {
  let representative = group.violations[0];
  if (selectedWarningId) {
    const hit = group.violations.find((v) => v.id === selectedWarningId);
    if (hit) representative = hit;
  }
  const mergedWaypointIds: string[] = [];
  for (const v of group.violations) {
    for (const wpid of v.waypoint_ids) {
      if (!mergedWaypointIds.includes(wpid)) mergedWaypointIds.push(wpid);
    }
  }
  // prefer the structured ids: when the group touches any waypoint_ids, drop
  // the regex-parsed ref so the detail panel falls back to displaying
  // waypoint_ids.length, which matches the map highlight count. multi-violation
  // groups also drop the ref - a single joined ref is misleading once several
  // violations collapsed (regex-parsed waypoint_refs only cover violations
  // whose message names a wp). the ref survives only for a single-violation
  // legacy group with no structured ids - byte-identical to the legacy
  // (pre-structured-id) grouping behavior.
  const mergedRef =
    mergedWaypointIds.length > 0 || group.violations.length > 1
      ? null
      : group.waypointRefs[0] ?? representative.waypoint_ref;
  return {
    ...representative,
    waypoint_ids: mergedWaypointIds,
    waypoint_ref: mergedRef,
  };
}

/** true when the current selection points at any violation in this group. */
export function isGroupSelected(
  group: ViolationGroup,
  selectedWarningId: string | null | undefined,
): boolean {
  if (!selectedWarningId) return false;
  return group.ids.includes(selectedWarningId);
}
