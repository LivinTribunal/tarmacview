import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DroneMissionsPanel from "./DroneMissionsPanel";
import type { MissionResponse } from "@/types/mission";

function mission(overrides: Partial<MissionResponse> = {}): MissionResponse {
  /** build a minimal mission for tests. */
  return {
    id: "m-1",
    name: "Runway 09L sweep",
    status: "PLANNED",
    created_at: "2026-03-19T00:00:00Z",
    updated_at: "2026-03-20T00:00:00Z",
    ...overrides,
  } as MissionResponse;
}

describe("DroneMissionsPanel", () => {
  it("shows the empty state when there are no missions", () => {
    render(
      <DroneMissionsPanel missions={[]} expanded onToggle={vi.fn()} />,
    );
    expect(
      screen.getByText("coordinator.drones.detail.noMissions"),
    ).toBeInTheDocument();
  });

  it("lists missions with a status badge when populated", () => {
    render(
      <DroneMissionsPanel
        missions={[mission(), mission({ id: "m-2", name: "Taxiway check" })]}
        expanded
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("Runway 09L sweep")).toBeInTheDocument();
    expect(screen.getByText("Taxiway check")).toBeInTheDocument();
    expect(screen.getAllByText("missionStatus.PLANNED")).toHaveLength(2);
  });

  it("hides the body when collapsed", () => {
    render(
      <DroneMissionsPanel
        missions={[mission()]}
        expanded={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.queryByText("Runway 09L sweep")).toBeNull();
  });

  it("calls onToggle when the header is clicked", () => {
    const onToggle = vi.fn();
    render(
      <DroneMissionsPanel missions={[]} expanded onToggle={onToggle} />,
    );
    fireEvent.click(screen.getByTestId("missions-panel-toggle"));
    expect(onToggle).toHaveBeenCalled();
  });

  it("exposes clickable rows as buttons and activates them via keyboard", () => {
    const onMissionClick = vi.fn();
    render(
      <DroneMissionsPanel
        missions={[mission()]}
        expanded
        onToggle={vi.fn()}
        onMissionClick={onMissionClick}
      />,
    );
    const row = screen.getByRole("button", { name: /Runway 09L sweep/ });
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onMissionClick).toHaveBeenCalledTimes(1);
    fireEvent.click(row);
    expect(onMissionClick).toHaveBeenCalledTimes(2);
  });

  it("renders non-interactive rows when no click handler is provided", () => {
    render(
      <DroneMissionsPanel missions={[mission()]} expanded onToggle={vi.fn()} />,
    );
    expect(
      screen.queryByRole("button", { name: /Runway 09L sweep/ }),
    ).toBeNull();
    expect(screen.getByText("Runway 09L sweep")).toBeInTheDocument();
  });
});
