import { describe, it, expect } from "vitest";
import {
  groupViolations,
  isGroupSelected,
  pickGroupForSelection,
} from "./warningsPanelGrouping";
import type { ValidationViolation, ViolationSeverity } from "@/types/flightPlan";

function v(
  id: string,
  severity: ViolationSeverity,
  constraintName: string | null,
  waypointRef: string | null,
  message = "msg",
  violationKind: string | null = null,
  waypointIds: string[] | null = null,
): ValidationViolation {
  /** test factory for ValidationViolation. */
  return {
    id,
    category: severity,
    is_warning: severity === "warning",
    severity,
    message,
    constraint_id: null,
    constraint_name: constraintName,
    violation_kind: violationKind,
    waypoint_ref: waypointRef,
    // explicit override lets legacy rows carry a regex ref with no structured ids
    waypoint_ids: waypointIds ?? (waypointRef ? [waypointRef] : []),
  };
}

describe("groupViolations", () => {
  it("returns three empty sections for empty input", () => {
    const sections = groupViolations([]);
    expect(sections.map((s) => s.severity)).toEqual([
      "violation",
      "warning",
      "suggestion",
    ]);
    sections.forEach((s) => {
      expect(s.groups).toEqual([]);
      expect(s.totalCount).toBe(0);
    });
  });

  it("returns three empty sections for null input", () => {
    const sections = groupViolations(null);
    expect(sections.every((s) => s.groups.length === 0)).toBe(true);
  });

  it("preserves severity ordering: violation, warning, suggestion", () => {
    const sections = groupViolations([
      v("a", "suggestion", "low priority", "WP1"),
      v("b", "violation", "obstacle", "WP2"),
      v("c", "warning", "speed", "WP3"),
    ]);
    expect(sections[0].severity).toBe("violation");
    expect(sections[1].severity).toBe("warning");
    expect(sections[2].severity).toBe("suggestion");
    expect(sections[0].totalCount).toBe(1);
    expect(sections[1].totalCount).toBe(1);
    expect(sections[2].totalCount).toBe(1);
  });

  it("collapses identical constraint_name across multiple waypoints into one group", () => {
    const sections = groupViolations([
      v("a", "warning", "speed limit", "WP1"),
      v("b", "warning", "speed limit", "WP3"),
      v("c", "warning", "speed limit", "WP7"),
    ]);
    const warning = sections.find((s) => s.severity === "warning")!;
    expect(warning.groups.length).toBe(1);
    expect(warning.groups[0].waypointRefs).toEqual(["WP1", "WP3", "WP7"]);
    expect(warning.groups[0].ids).toEqual(["a", "b", "c"]);
    expect(warning.totalCount).toBe(3);
  });

  it("dedupes the same waypoint ref appearing twice", () => {
    const sections = groupViolations([
      v("a", "warning", "speed limit", "WP1"),
      v("b", "warning", "speed limit", "WP1"),
    ]);
    const warning = sections.find((s) => s.severity === "warning")!;
    expect(warning.groups[0].waypointRefs).toEqual(["WP1"]);
    expect(warning.groups[0].ids).toEqual(["a", "b"]);
  });

  it("falls back to message when constraint_name is null", () => {
    const sections = groupViolations([
      v("a", "violation", null, "WP1", "obstacle blocks waypoint"),
      v("b", "violation", null, "WP2", "obstacle blocks waypoint"),
      v("c", "violation", null, "WP3", "different message"),
    ]);
    const violation = sections.find((s) => s.severity === "violation")!;
    expect(violation.groups.length).toBe(2);
    expect(violation.groups[0].waypointRefs).toEqual(["WP1", "WP2"]);
    expect(violation.groups[1].waypointRefs).toEqual(["WP3"]);
  });

  it("keeps groups in first-seen insertion order", () => {
    const sections = groupViolations([
      v("a", "warning", "battery", "WP1"),
      v("b", "warning", "speed limit", "WP2"),
      v("c", "warning", "battery", "WP3"),
    ]);
    const warning = sections.find((s) => s.severity === "warning")!;
    expect(warning.groups[0].constraintName).toBe("battery");
    expect(warning.groups[1].constraintName).toBe("speed limit");
  });

  it("ignores empty waypoint_ref on a global violation", () => {
    const sections = groupViolations([v("a", "violation", "global", null)]);
    const violation = sections.find((s) => s.severity === "violation")!;
    expect(violation.groups[0].waypointRefs).toEqual([]);
  });

  it("collects unique affectedWaypointIds across the group, including ids absent from waypoint_refs", () => {
    const a: ValidationViolation = {
      ...v("a", "violation", "runway buffer", "WP1"),
      waypoint_ids: ["wp-1", "wp-2"],
    };
    const b: ValidationViolation = {
      ...v("b", "violation", "runway buffer", null),
      waypoint_ids: ["wp-2", "wp-3", "wp-4"],
    };
    const sections = groupViolations([a, b]);
    const group = sections.find((s) => s.severity === "violation")!.groups[0];
    expect(group.affectedWaypointIds).toEqual(["wp-1", "wp-2", "wp-3", "wp-4"]);
    expect(group.waypointRefs).toEqual(["WP1"]);
  });

  it("groups by violation_kind regardless of constraint_name or message wording", () => {
    const sections = groupViolations([
      v("a", "warning", "runway_clearance", "WP1", "wp 3-4 crosses 09L", "surface_crossing"),
      v("b", "warning", "taxiway_clearance", "WP9", "wp 12-13 crosses Bravo", "surface_crossing"),
    ]);
    const warning = sections.find((s) => s.severity === "warning")!;
    expect(warning.groups.length).toBe(1);
    expect(warning.groups[0].key).toBe("surface_crossing");
    expect(warning.groups[0].violationKind).toBe("surface_crossing");
    expect(warning.groups[0].ids).toEqual(["a", "b"]);
  });

  it("unifies surface_crossing transit-format and grouped-measurement-format into one group", () => {
    const sections = groupViolations([
      v(
        "a",
        "warning",
        null,
        null,
        "wp 3-4 (TRANSIT): crosses RUNWAY 09L (12m)",
        "surface_crossing",
        ["idx:2", "idx:3"],
      ),
      v(
        "b",
        "warning",
        null,
        null,
        "inspection 2 crosses RUNWAY 09L during measurement (5 segments)",
        "surface_crossing",
        ["idx:10", "idx:11"],
      ),
    ]);
    const warning = sections.find((s) => s.severity === "warning")!;
    expect(warning.groups.length).toBe(1);
    expect(warning.groups[0].violationKind).toBe("surface_crossing");
    expect(warning.groups[0].ids).toEqual(["a", "b"]);
    expect(warning.groups[0].affectedWaypointIds).toEqual([
      "idx:2",
      "idx:3",
      "idx:10",
      "idx:11",
    ]);
  });

  it("prefers violation_kind over constraint_name when both are present", () => {
    const sections = groupViolations([
      v("a", "violation", "obstacle_clearance", "WP1", "msg", "obstacle"),
      v("b", "violation", "different_constraint", "WP2", "msg", "obstacle"),
    ]);
    const violation = sections.find((s) => s.severity === "violation")!;
    expect(violation.groups.length).toBe(1);
    expect(violation.groups[0].key).toBe("obstacle");
  });

  it("legacy null-kind rows still group by constraint_name then message (parity)", () => {
    const sections = groupViolations([
      v("a", "warning", "speed limit", "WP1", "too fast at WP1", null, []),
      v("b", "warning", "speed limit", "WP2", "too fast at WP2", null, []),
      v("c", "warning", null, "WP3", "loose obstacle nearby", null, []),
      v("d", "warning", null, "WP4", "loose obstacle nearby", null, []),
    ]);
    const warning = sections.find((s) => s.severity === "warning")!;
    expect(warning.groups.length).toBe(2);
    expect(warning.groups[0].key).toBe("speed limit");
    expect(warning.groups[0].violationKind).toBeNull();
    expect(warning.groups[0].ids).toEqual(["a", "b"]);
    expect(warning.groups[1].key).toBe("__msg__:loose obstacle nearby");
    expect(warning.groups[1].ids).toEqual(["c", "d"]);
  });
});

describe("pickGroupForSelection", () => {
  it("returns the matching violation when selectedWarningId is in the group", () => {
    const sections = groupViolations([
      v("a", "warning", "speed", "WP1"),
      v("b", "warning", "speed", "WP2"),
    ]);
    const group = sections.find((s) => s.severity === "warning")!.groups[0];
    expect(pickGroupForSelection(group, "b").id).toBe("b");
  });

  it("falls back to first violation when selectedWarningId is unknown", () => {
    const sections = groupViolations([v("a", "warning", "speed", "WP1")]);
    const group = sections.find((s) => s.severity === "warning")!.groups[0];
    expect(pickGroupForSelection(group, "zzz").id).toBe("a");
    expect(pickGroupForSelection(group, null).id).toBe("a");
  });

  it("merges every waypoint_id across the group so the map highlights all affected waypoints", () => {
    const a: ValidationViolation = {
      ...v("a", "violation", "runway buffer", "WP1"),
      waypoint_ids: ["wp-1"],
    };
    const b: ValidationViolation = {
      ...v("b", "violation", "runway buffer", "WP3"),
      waypoint_ids: ["wp-3"],
    };
    const c: ValidationViolation = {
      ...v("c", "violation", "runway buffer", "WP7"),
      waypoint_ids: ["wp-7"],
    };
    const sections = groupViolations([a, b, c]);
    const group = sections.find((s) => s.severity === "violation")!.groups[0];
    const picked = pickGroupForSelection(group, null);
    expect(picked.waypoint_ids).toEqual(["wp-1", "wp-3", "wp-7"]);
    // structured ids present -> drop the joined ref so the detail panel falls
    // back to count, matching what the map highlights
    expect(picked.waypoint_ref).toBeNull();
  });

  it("drops the ref to the structured count for a single-violation group with waypoint_ids", () => {
    const sections = groupViolations([
      v("a", "warning", "speed", "WP1", "msg", "drone_speed"),
    ]);
    const group = sections.find((s) => s.severity === "warning")!.groups[0];
    const picked = pickGroupForSelection(group, null);
    expect(picked.waypoint_ids).toEqual(["WP1"]);
    expect(picked.waypoint_ref).toBeNull();
  });

  it("preserves the regex waypoint_ref only for a single-violation legacy group with no structured waypoint_ids", () => {
    // single-violation legacy row in the shape the backend actually emits:
    // violation_kind null => constraint_name null, empty waypoint_ids. keeps its ref
    const single = groupViolations([
      v("a", "warning", null, "WP1", "msg", null, []),
    ]);
    const singleGroup = single.find((s) => s.severity === "warning")!.groups[0];
    expect(pickGroupForSelection(singleGroup, null).waypoint_ref).toBe("WP1");

    // multi-violation legacy group drops the ref to null - byte-identical to
    // pre-#525 behavior (main returns null for any multi-violation group)
    const multi = groupViolations([
      v("a", "warning", null, "WP1", "msg", null, []),
      v("b", "warning", null, "WP2", "msg", null, []),
    ]);
    const multiGroup = multi.find((s) => s.severity === "warning")!.groups[0];
    const picked = pickGroupForSelection(multiGroup, null);
    expect(picked.waypoint_ids).toEqual([]);
    expect(picked.waypoint_ref).toBeNull();
  });
});

describe("isGroupSelected", () => {
  it("is true when selection matches any id in the group", () => {
    const sections = groupViolations([
      v("a", "warning", "speed", "WP1"),
      v("b", "warning", "speed", "WP2"),
    ]);
    const group = sections.find((s) => s.severity === "warning")!.groups[0];
    expect(isGroupSelected(group, "b")).toBe(true);
  });

  it("is false when selection is null or unrelated", () => {
    const sections = groupViolations([v("a", "warning", "speed", "WP1")]);
    const group = sections.find((s) => s.severity === "warning")!.groups[0];
    expect(isGroupSelected(group, null)).toBe(false);
    expect(isGroupSelected(group, "elsewhere")).toBe(false);
  });
});
