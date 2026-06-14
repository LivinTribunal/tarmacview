import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import WarningsPanel from "./WarningsPanel";
import type { ValidationViolation, ViolationSeverity } from "@/types/flightPlan";

function v(
  id: string,
  severity: ViolationSeverity,
  constraintName: string | null,
  waypointRef: string | null,
  message = "raw validator message",
): ValidationViolation {
  /** test factory for a ValidationViolation. */
  return {
    id,
    category: severity,
    is_warning: severity === "warning",
    severity,
    message,
    constraint_id: null,
    constraint_name: constraintName,
    violation_kind: null,
    waypoint_ref: waypointRef,
    waypoint_ids: waypointRef ? [waypointRef] : [],
  };
}

describe("WarningsPanel pre-trajectory + empty states", () => {
  it("shows pre-trajectory message when no trajectory exists", () => {
    render(<WarningsPanel warnings={null} hasTrajectory={false} />);
    expect(
      screen.getByText("mission.config.warningsPanel.noTrajectory"),
    ).toBeInTheDocument();
  });

  it("shows empty state when trajectory exists but no warnings", () => {
    render(<WarningsPanel warnings={[]} hasTrajectory />);
    const empty = screen.getByTestId("warnings-empty-state");
    expect(empty).toBeInTheDocument();
    expect(within(empty).getByText("mission.config.warningsPanel.noIssues")).toBeInTheDocument();
  });
});

describe("WarningsPanel grouped sections", () => {
  it("renders three severity sections in order with correct counts", () => {
    render(
      <WarningsPanel
        warnings={[
          v("1", "violation", "obstacle clearance", "WP1"),
          v("2", "warning", "speed limit", "WP2"),
          v("3", "warning", "speed limit", "WP3"),
          v("4", "suggestion", "frame rate compat", "WP4"),
        ]}
        hasTrajectory
      />,
    );
    const violation = screen.getByTestId("warnings-section-violation");
    const warning = screen.getByTestId("warnings-section-warning");
    const suggestion = screen.getByTestId("warnings-section-suggestion");
    expect(violation).toBeInTheDocument();
    expect(warning).toBeInTheDocument();
    expect(suggestion).toBeInTheDocument();
    expect(within(violation).getByText("1")).toBeInTheDocument();
    expect(within(warning).getByText("2")).toBeInTheDocument();
    expect(within(suggestion).getByText("1")).toBeInTheDocument();
  });

  it("violations open by default; suggestions collapsed by default", () => {
    render(
      <WarningsPanel
        warnings={[
          v("1", "violation", "obstacle", "WP1"),
          v("2", "suggestion", "low priority", "WP2"),
        ]}
        hasTrajectory
      />,
    );
    expect(screen.getByTestId("warnings-section-violation").getAttribute("data-expanded")).toBe(
      "true",
    );
    expect(screen.getByTestId("warnings-section-suggestion").getAttribute("data-expanded")).toBe(
      "false",
    );
  });

  it("warnings open when count is small", () => {
    render(
      <WarningsPanel
        warnings={[
          v("1", "warning", "speed", "WP1"),
          v("2", "warning", "speed", "WP2"),
          v("3", "warning", "speed", "WP3"),
        ]}
        hasTrajectory
      />,
    );
    expect(screen.getByTestId("warnings-section-warning").getAttribute("data-expanded")).toBe(
      "true",
    );
  });

  it("warnings collapse when count exceeds threshold", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      v(`w-${i}`, "warning", `c-${i}`, `WP${i}`),
    );
    render(<WarningsPanel warnings={many} hasTrajectory />);
    expect(screen.getByTestId("warnings-section-warning").getAttribute("data-expanded")).toBe(
      "false",
    );
  });

  it("section header toggles open/closed on click", () => {
    render(
      <WarningsPanel
        warnings={[v("1", "suggestion", "low priority", "WP1")]}
        hasTrajectory
      />,
    );
    const section = screen.getByTestId("warnings-section-suggestion");
    expect(section.getAttribute("data-expanded")).toBe("false");
    fireEvent.click(within(section).getByTestId("warnings-section-suggestion-toggle"));
    expect(section.getAttribute("data-expanded")).toBe("true");
    fireEvent.click(within(section).getByTestId("warnings-section-suggestion-toggle"));
    expect(section.getAttribute("data-expanded")).toBe("false");
  });

  it("collapses identical constraints into a single row with waypoint chips", () => {
    render(
      <WarningsPanel
        warnings={[
          v("1", "warning", "speed limit", "WP1"),
          v("2", "warning", "speed limit", "WP3"),
          v("3", "warning", "speed limit", "WP7"),
        ]}
        hasTrajectory
      />,
    );
    const warning = screen.getByTestId("warnings-section-warning");
    const rows = warning.querySelectorAll('[data-testid^="warnings-row-"]');
    expect(rows.length).toBe(1);
    const row = rows[0] as HTMLElement;
    expect(within(row).getByText("WP1")).toBeInTheDocument();
    expect(within(row).getByText("WP3")).toBeInTheDocument();
    expect(within(row).getByText("WP7")).toBeInTheDocument();
    expect(within(row).getByText("Speed limit")).toBeInTheDocument();
  });

  it("calls onWarningClick with a violation from the clicked group", () => {
    const onWarningClick = vi.fn();
    render(
      <WarningsPanel
        warnings={[
          v("1", "violation", "obstacle", "WP1"),
          v("2", "violation", "obstacle", "WP2"),
        ]}
        hasTrajectory
        onWarningClick={onWarningClick}
      />,
    );
    const row = screen.getByTestId("warnings-row-obstacle");
    fireEvent.click(row);
    expect(onWarningClick).toHaveBeenCalledTimes(1);
    const arg = onWarningClick.mock.calls[0][0];
    expect(["1", "2"]).toContain(arg.id);
  });

  it("toggles selection off when clicking the already-selected group", () => {
    const onWarningClick = vi.fn();
    render(
      <WarningsPanel
        warnings={[
          v("1", "violation", "obstacle", "WP1"),
          v("2", "violation", "obstacle", "WP2"),
        ]}
        hasTrajectory
        onWarningClick={onWarningClick}
        selectedWarningId="2"
      />,
    );
    fireEvent.click(screen.getByTestId("warnings-row-obstacle"));
    expect(onWarningClick).toHaveBeenCalledWith(null);
  });

  it("marks the row selected when selectedWarningId matches any violation in the group", () => {
    render(
      <WarningsPanel
        warnings={[
          v("1", "violation", "obstacle", "WP1"),
          v("2", "violation", "obstacle", "WP2"),
        ]}
        hasTrajectory
        onWarningClick={vi.fn()}
        selectedWarningId="2"
      />,
    );
    const row = screen.getByTestId("warnings-row-obstacle");
    expect(row.getAttribute("data-selected")).toBe("true");
  });

  it("exposes the raw validator message via the title attribute on the constraint label", () => {
    render(
      <WarningsPanel
        warnings={[
          v("1", "warning", "speed_limit", "WP1", "speed exceeds 12.5 m/s at WP1"),
        ]}
        hasTrajectory
      />,
    );
    const label = screen.getByText("Speed limit");
    expect(label).toHaveAttribute("title", "speed exceeds 12.5 m/s at WP1");
  });

  it("falls back to the message excerpt when constraint_name is null", () => {
    render(
      <WarningsPanel
        warnings={[v("1", "warning", null, "WP1", "battery margin tight")]}
        hasTrajectory
      />,
    );
    expect(screen.getByText("battery margin tight")).toBeInTheDocument();
  });
});
