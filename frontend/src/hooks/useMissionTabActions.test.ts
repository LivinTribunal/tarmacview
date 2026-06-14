import { renderHook, act, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useMissionTabActions } from "./useMissionTabActions";
import { updateMission, duplicateMission } from "@/api/missions";
import { SLOW_NOTIFICATION_TIMEOUT_MS } from "@/constants/ui";
import type { MissionResponse } from "@/types/mission";

const { mockNavigate, router } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  router: { pathname: "/operator-center/missions/m-1/map" },
}));

vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: router.pathname }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("@/api/missions", () => ({
  updateMission: vi.fn(),
  duplicateMission: vi.fn(),
  deleteMission: vi.fn(),
}));

const MISSIONS = [
  { id: "m-1", name: "Alpha" },
  { id: "m-2", name: "Beta" },
] as MissionResponse[];

function setup(over: { compactLeftPanel?: boolean } = {}) {
  const refreshMissions = vi.fn().mockResolvedValue(undefined);
  const view = renderHook(() =>
    useMissionTabActions({
      id: "m-1",
      missions: MISSIONS,
      refreshMissions,
      compactLeftPanel: over.compactLeftPanel ?? false,
    }),
  );
  return { view, refreshMissions };
}

describe("useMissionTabActions tab preservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    router.pathname = "/operator-center/missions/m-1/map";
  });

  it("preserves a non-default tab segment when switching missions", () => {
    const { view } = setup();
    act(() => {
      view.result.current.handleMissionSwitch("m-2");
    });
    expect(mockNavigate).toHaveBeenCalledWith("/operator-center/missions/m-2/map");
  });

  it("falls back to the configuration tab when no segment matches", () => {
    router.pathname = "/operator-center/missions";
    const { view } = setup();
    act(() => {
      view.result.current.handleMissionSwitch("m-2");
    });
    expect(mockNavigate).toHaveBeenCalledWith(
      "/operator-center/missions/m-2/configuration",
    );
  });

  it("preserves the active tab segment when duplicating", async () => {
    vi.mocked(duplicateMission).mockResolvedValue({ id: "copy-1" } as never);
    const { view, refreshMissions } = setup();
    await act(async () => {
      await view.result.current.handleDuplicate();
    });
    expect(vi.mocked(duplicateMission)).toHaveBeenCalledWith("m-1");
    expect(refreshMissions).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/operator-center/missions/copy-1/map");
  });
});

describe("useMissionTabActions rename error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    router.pathname = "/operator-center/missions/m-1/map";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets a transient error on rename failure and auto-clears it", async () => {
    vi.mocked(updateMission).mockRejectedValue(new Error("boom"));
    const { view } = setup();

    act(() => {
      view.result.current.startRename();
    });
    expect(view.result.current.renaming).toBe(true);
    expect(view.result.current.renameValue).toBe("Alpha");

    act(() => {
      view.result.current.setRenameValue("Alpha 2");
    });
    await act(async () => {
      await view.result.current.confirmRename();
    });

    expect(vi.mocked(updateMission)).toHaveBeenCalledWith("m-1", { name: "Alpha 2" });
    expect(view.result.current.renaming).toBe(false);
    expect(view.result.current.renameError).toBe("mission.renameError");

    act(() => {
      vi.advanceTimersByTime(SLOW_NOTIFICATION_TIMEOUT_MS);
    });
    expect(view.result.current.renameError).toBeNull();
  });
});

describe("useMissionTabActions compact dropdown outside click", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    router.pathname = "/operator-center/missions/m-1/map";
  });

  it("closes the dropdown and clears the search on an outside mousedown", () => {
    const { view } = setup({ compactLeftPanel: true });
    const inside = document.createElement("div");
    document.body.appendChild(inside);
    (
      view.result.current.compactSelectorRef as React.MutableRefObject<HTMLDivElement | null>
    ).current = inside;

    act(() => {
      view.result.current.toggleCompactDropdown();
    });
    expect(view.result.current.missionDropdownOpen).toBe(true);
    act(() => {
      view.result.current.setMissionSearch("alp");
    });

    // a mousedown inside the selector keeps it open
    act(() => {
      fireEvent.mouseDown(inside);
    });
    expect(view.result.current.missionDropdownOpen).toBe(true);
    expect(view.result.current.missionSearch).toBe("alp");

    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(view.result.current.missionDropdownOpen).toBe(false);
    expect(view.result.current.missionSearch).toBe("");
    inside.remove();
  });
});
