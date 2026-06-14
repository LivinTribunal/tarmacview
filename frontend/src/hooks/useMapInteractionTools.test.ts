import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import useMapInteractionTools from "./useMapInteractionTools";
import { MapTool } from "./useMapTools";
import { getMission, updateMission } from "@/api/missions";
import {
  computePlacementUpdates,
  placementKeysFromUpdates,
} from "@/utils/takeoffLandingPlacement";
import type { MissionDetailResponse } from "@/types/mission";

vi.mock("@/api/missions", () => ({
  getMission: vi.fn(),
  updateMission: vi.fn(),
}));

vi.mock("@/utils/takeoffLandingPlacement", () => ({
  computePlacementUpdates: vi.fn(),
  placementKeysFromUpdates: vi.fn(),
}));

const mission = { id: "m-1", airport_id: "apt-1" } as MissionDetailResponse;

function setup(overrides: Partial<Parameters<typeof useMapInteractionTools>[0]> = {}) {
  const showNotification = vi.fn();
  const params = {
    id: "m-1",
    mission,
    setMission: vi.fn(),
    airportDetail: null,
    useTakeoffAsLanding: false,
    resolveElevation: undefined,
    refreshMissions: vi.fn().mockResolvedValue(undefined),
    showNotification,
    handleUndo: vi.fn(),
    handleRedo: vi.fn(),
    t: (key: string) => key,
    ...overrides,
  };
  const hook = renderHook(() => useMapInteractionTools(params));
  return { hook, ...params };
}

describe("useMapInteractionTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(computePlacementUpdates).mockResolvedValue({
      takeoff_coordinate: { type: "Point", coordinates: [17.2, 48.1, 130] },
    });
    vi.mocked(placementKeysFromUpdates).mockReturnValue(["takeoff"]);
  });

  it("surfaces a save error via showNotification when placement save fails", async () => {
    /** updateMission rejecting must route through the catch and toast map.saveError. */
    vi.mocked(updateMission).mockRejectedValue(new Error("boom"));
    const { hook, showNotification, setMission } = setup();

    act(() => {
      hook.result.current.setTool(MapTool.PLACE_TAKEOFF);
    });

    await act(async () => {
      await hook.result.current.handleMapClick({ lng: 17.2, lat: 48.1 });
    });

    expect(updateMission).toHaveBeenCalledTimes(1);
    expect(getMission).not.toHaveBeenCalled();
    expect(setMission).not.toHaveBeenCalled();
    expect(showNotification).toHaveBeenCalledWith("map.saveError");
    // pending placement is always cleared in finally
    expect(hook.result.current.pendingPlacement.size).toBe(0);
  });

  it("commits the placement and refreshes the mission on success", async () => {
    /** the happy path persists, re-reads the mission, and never toasts. */
    vi.mocked(updateMission).mockResolvedValue(undefined as never);
    const freshMission = { ...mission, name: "fresh" } as MissionDetailResponse;
    vi.mocked(getMission).mockResolvedValue(freshMission);
    const { hook, showNotification, setMission, refreshMissions } = setup();

    act(() => {
      hook.result.current.setTool(MapTool.PLACE_TAKEOFF);
    });

    await act(async () => {
      await hook.result.current.handleMapClick({ lng: 17.2, lat: 48.1 });
    });

    expect(updateMission).toHaveBeenCalledTimes(1);
    expect(setMission).toHaveBeenCalledWith(freshMission);
    expect(refreshMissions).toHaveBeenCalledTimes(1);
    expect(showNotification).not.toHaveBeenCalled();
  });
});
