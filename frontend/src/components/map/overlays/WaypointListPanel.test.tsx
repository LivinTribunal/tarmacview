import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WaypointListPanel from "./WaypointListPanel";
import type { WaypointResponse } from "@/types/flightPlan";

function wp(overrides: Partial<WaypointResponse> = {}): WaypointResponse {
  return {
    id: "wp1",
    mission_id: "m1",
    inspection_id: null,
    waypoint_type: "MEASUREMENT",
    sequence_order: 1,
    position: { type: "Point", coordinates: [14.5, 50.1, 100] },
    heading: 0,
    speed: 5,
    camera_action: null,
    camera_target: null,
    gimbal_pitch: 0,
    hover_duration: null,
    ...overrides,
  } as WaypointResponse;
}

describe("WaypointListPanel click behavior", () => {
  it("single-click calls onSelect and does NOT call onLocate", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    render(
      <WaypointListPanel
        waypoints={[wp({ id: "wp-a", sequence_order: 1 })]}
        selectedId={null}
        onSelect={onSelect}
        onLocate={onLocate}
      />,
    );

    const row = screen.getByTestId("waypoint-item-wp-a");
    fireEvent.click(row);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("wp-a");
    expect(onLocate).not.toHaveBeenCalled();
  });

  it("double-click invokes onLocate", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    render(
      <WaypointListPanel
        waypoints={[wp({ id: "wp-a", sequence_order: 1 })]}
        selectedId={null}
        onSelect={onSelect}
        onLocate={onLocate}
      />,
    );

    const row = screen.getByTestId("waypoint-item-wp-a");
    fireEvent.doubleClick(row);

    expect(onLocate).toHaveBeenCalledTimes(1);
    expect(onLocate).toHaveBeenCalledWith("wp-a");
  });

  it("single-click on standalone takeoff calls onSelect only", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    render(
      <WaypointListPanel
        waypoints={[]}
        selectedId={null}
        onSelect={onSelect}
        onLocate={onLocate}
        takeoffCoordinate={{ type: "Point", coordinates: [14.5, 50.1, 0] }}
      />,
    );

    const row = screen.getByTestId("waypoint-item-takeoff");
    fireEvent.click(row);

    expect(onSelect).toHaveBeenCalledWith("takeoff");
    expect(onLocate).not.toHaveBeenCalled();
  });

  it("double-click on standalone takeoff invokes onLocate", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    render(
      <WaypointListPanel
        waypoints={[]}
        selectedId={null}
        onSelect={onSelect}
        onLocate={onLocate}
        takeoffCoordinate={{ type: "Point", coordinates: [14.5, 50.1, 0] }}
      />,
    );

    const row = screen.getByTestId("waypoint-item-takeoff");
    fireEvent.doubleClick(row);

    expect(onLocate).toHaveBeenCalledWith("takeoff");
  });

  it("collapses bookend + middle MEASUREMENTs into one 'Inspection N (count)' bundle, with start/stop labels inside on expand", () => {
    // bookend MEASUREMENTs stay inside the measurement group so the bundle
    // header maps 1:1 to one inspection; the start/stop labels only surface
    // once the user expands the chevron.
    const waypoints = [
      wp({
        id: "wp-start",
        inspection_id: "insp-1",
        sequence_order: 1,
        camera_action: "RECORDING_START",
      }),
      wp({ id: "wp-mid", inspection_id: "insp-1", sequence_order: 2 }),
      wp({
        id: "wp-stop",
        inspection_id: "insp-1",
        sequence_order: 3,
        camera_action: "RECORDING_STOP",
      }),
    ];
    render(
      <WaypointListPanel
        waypoints={waypoints}
        selectedId={null}
        onSelect={vi.fn()}
        inspectionIndexMap={{ "insp-1": 1 }}
      />,
    );
    // header reads "Inspection 1 (3)" via the index map fallback (t() returns
    // the key in tests, so the localized prefix is "dashboard.inspection")
    const header = screen.getByText("dashboard.inspection 1 (3)");
    expect(header).toBeInTheDocument();
    // bookend rows aren't surfaced until the group expands
    expect(screen.queryByTestId("waypoint-item-wp-start")).not.toBeInTheDocument();

    fireEvent.click(header);

    expect(screen.getByTestId("waypoint-item-wp-start")).toHaveTextContent(
      "mission.config.captureMode.recordingStart",
    );
    expect(screen.getByTestId("waypoint-item-wp-stop")).toHaveTextContent(
      "mission.config.captureMode.recordingStop",
    );
  });

  it("skips the second click of a double-click to prevent select flicker", () => {
    const onSelect = vi.fn();
    const onLocate = vi.fn();
    render(
      <WaypointListPanel
        waypoints={[wp({ id: "wp-a", sequence_order: 1 })]}
        selectedId={null}
        onSelect={onSelect}
        onLocate={onLocate}
      />,
    );

    const row = screen.getByTestId("waypoint-item-wp-a");
    // browser fires two click events before dblclick on a double-click;
    // the second click (detail === 2) must not toggle selection back off
    fireEvent.click(row, { detail: 1 });
    fireEvent.click(row, { detail: 2 });
    fireEvent.doubleClick(row);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("wp-a");
    expect(onLocate).toHaveBeenCalledWith("wp-a");
  });
});
