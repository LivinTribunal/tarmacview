import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import useWaypointEditing from "./useWaypointEditing";
import {
  getMission,
  batchUpdateWaypoints,
  insertTransitWaypoint,
} from "@/api/missions";
import type { FlightPlanResponse, WaypointResponse } from "@/types/flightPlan";

vi.mock("@/api/missions", () => ({
  getMission: vi.fn(),
  updateMission: vi.fn(),
  batchUpdateWaypoints: vi.fn(),
  insertTransitWaypoint: vi.fn(),
  deleteTransitWaypoint: vi.fn(),
}));

function makeWaypoint(
  id: string,
  type: WaypointResponse["waypoint_type"],
  coords: [number, number, number],
): WaypointResponse {
  return {
    id,
    flight_plan_id: "fp-1",
    inspection_id: null,
    sequence_order: 1,
    position: { type: "Point", coordinates: coords },
    heading: null,
    speed: null,
    hover_duration: null,
    camera_action: null,
    waypoint_type: type,
    camera_target: null,
    gimbal_pitch: null,
  } as WaypointResponse;
}

function makeFlightPlan(waypoints: WaypointResponse[]): FlightPlanResponse {
  return {
    id: "fp-1",
    mission_id: "m-1",
    airport_id: "apt-1",
    total_distance: 0,
    estimated_duration: 0,
    is_validated: false,
    generated_at: "2026-01-01T00:00:00Z",
    waypoints,
    validation_result: null,
  } as unknown as FlightPlanResponse;
}

function setup(flightPlan: FlightPlanResponse | null) {
  const resolveElevation = vi.fn();
  const showNotification = vi.fn();
  const setFlightPlan = vi.fn();
  const setMission = vi.fn();
  const setLastSaved = vi.fn();
  const refreshMissions = vi.fn().mockResolvedValue(undefined);
  const updateMissionFromPage = vi.fn();
  const hook = renderHook(() =>
    useWaypointEditing({
      id: "m-1",
      flightPlan,
      setFlightPlan,
      setMission,
      setLastSaved,
      resolveElevation,
      useTakeoffAsLanding: false,
      refreshMissions,
      updateMissionFromPage,
      showNotification,
      t: (k: string) => k,
    }),
  );
  return {
    hook,
    resolveElevation,
    showNotification,
    setFlightPlan,
    setMission,
    setLastSaved,
  };
}

describe("useWaypointEditing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drag marks dirty and save snaps TAKEOFF alt to resolved ground", async () => {
    /** dragging an in-plan TAKEOFF waypoint stages a dirty edit; save replaces
     *  the dragged alt with the elevation resolver result. */
    const fp = makeFlightPlan([makeWaypoint("wp-t", "TAKEOFF", [17.2, 48.1, 0])]);
    const { hook, resolveElevation } = setup(fp);

    vi.mocked(resolveElevation).mockResolvedValue(212);
    vi.mocked(batchUpdateWaypoints).mockResolvedValue(fp);
    vi.mocked(getMission).mockResolvedValue({ status: "DRAFT" } as never);

    await act(async () => {
      await hook.result.current.handleWaypointDrag("wp-t", [17.25, 48.15, 999]);
    });
    expect(hook.result.current.isDirty).toBe(true);

    await act(async () => {
      await hook.result.current.handleSave();
    });

    expect(resolveElevation).toHaveBeenCalledWith(48.15, 17.25);
    const updates = vi.mocked(batchUpdateWaypoints).mock.calls[0][1];
    expect(updates[0].position.coordinates).toEqual([17.25, 48.15, 212]);
    expect(hook.result.current.isDirty).toBe(false);
  });

  it("undo of the first edit removes the dirty entry entirely", async () => {
    /** hadDirtyBefore=false on the first drag -> undo drops the entry, returning to clean. */
    const fp = makeFlightPlan([makeWaypoint("wp-a", "MEASUREMENT", [17.2, 48.1, 60])]);
    const { hook } = setup(fp);

    await act(async () => {
      await hook.result.current.handleWaypointDrag("wp-a", [17.3, 48.2, 70]);
    });
    expect(hook.result.current.isDirty).toBe(true);
    expect(hook.result.current.canUndo).toBe(true);

    act(() => {
      hook.result.current.handleUndo();
    });
    expect(hook.result.current.isDirty).toBe(false);
  });

  it("transit insert clears dirty edits and undo history", async () => {
    /** a transit insert is a server-side mutation - it discards local dirty/undo state. */
    const fp = makeFlightPlan([makeWaypoint("wp-a", "MEASUREMENT", [17.2, 48.1, 60])]);
    const { hook } = setup(fp);

    await act(async () => {
      await hook.result.current.handleWaypointDrag("wp-a", [17.3, 48.2, 70]);
    });
    expect(hook.result.current.isDirty).toBe(true);
    expect(hook.result.current.canUndo).toBe(true);

    vi.mocked(insertTransitWaypoint).mockResolvedValue(fp);
    vi.mocked(getMission).mockResolvedValue({ status: "DRAFT" } as never);

    await act(async () => {
      await hook.result.current.handleTransitInsert([17.25, 48.15, 65], 1);
    });

    expect(insertTransitWaypoint).toHaveBeenCalled();
    expect(hook.result.current.isDirty).toBe(false);
    expect(hook.result.current.canUndo).toBe(false);
  });
});
