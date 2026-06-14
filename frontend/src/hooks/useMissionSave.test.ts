import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import useMissionSave from "./useMissionSave";
import { getMission, updateInspection } from "@/api/missions";
import type {
  InspectionConfigOverride,
  MissionDetailResponse,
} from "@/types/mission";

vi.mock("@/api/missions", () => ({
  getMission: vi.fn(),
  updateMission: vi.fn(),
  updateInspection: vi.fn(),
}));

function makeMission(status: string): MissionDetailResponse {
  return { id: "m-1", status } as MissionDetailResponse;
}

function setup(opts: {
  mission: MissionDetailResponse;
  inspectionDirty: Record<string, InspectionConfigOverride>;
}) {
  const setInspectionDirty = vi.fn();
  const updateMissionState = vi.fn();
  const setLastSaved = vi.fn();
  const setSaveContext = vi.fn();
  const navigate = vi.fn();
  const showNotification = vi.fn();
  const hook = renderHook(() =>
    useMissionSave({
      id: "m-1",
      mission: opts.mission,
      inspectionDirty: opts.inspectionDirty,
      setInspectionDirty,
      updateMissionState,
      lastSaved: null,
      setLastSaved,
      setSaveContext,
      navigate,
      showNotification,
      t: (k: string) => k,
    }),
  );
  return {
    hook,
    setInspectionDirty,
    updateMissionState,
    setLastSaved,
    showNotification,
  };
}

describe("useMissionSave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the failed inspection dirty after a partial save", async () => {
    /** when one updateInspection rejects, that override stays in inspectionDirty
     *  and the partial-error toast fires. */
    const dirty: Record<string, InspectionConfigOverride> = {
      "insp-ok": { lha_ids: ["a"] },
      "insp-bad": { lha_ids: ["b"] },
    };
    const { hook, setInspectionDirty, showNotification, updateMissionState } =
      setup({ mission: makeMission("DRAFT"), inspectionDirty: dirty });

    vi.mocked(updateInspection).mockImplementation(async (_m, inspId) => {
      if (inspId === "insp-bad") throw new Error("boom");
      return {} as never;
    });
    vi.mocked(getMission).mockResolvedValue(makeMission("DRAFT") as never);

    await act(async () => {
      await hook.result.current.handleSave();
    });

    expect(setInspectionDirty).toHaveBeenLastCalledWith({
      "insp-bad": { lha_ids: ["b"] },
    });
    expect(showNotification).toHaveBeenCalledWith(
      "mission.config.savePartialError",
    );
    expect(updateMissionState).toHaveBeenCalledWith(
      expect.objectContaining({ status: "DRAFT" }),
      "DRAFT",
    );
  });

  it("suppresses the saved toast when status regresses", async () => {
    /** a save that drops PLANNED -> DRAFT must not show the success toast
     *  (the regression notice is owned by updateMissionState). */
    const { hook, showNotification, updateMissionState } = setup({
      mission: makeMission("PLANNED"),
      inspectionDirty: { "insp-1": { lha_ids: ["a"] } },
    });

    vi.mocked(updateInspection).mockResolvedValue({} as never);
    vi.mocked(getMission).mockResolvedValue(makeMission("DRAFT") as never);

    await act(async () => {
      await hook.result.current.handleSave();
    });

    expect(updateMissionState).toHaveBeenCalledWith(
      expect.objectContaining({ status: "DRAFT" }),
      "PLANNED",
    );
    expect(showNotification).not.toHaveBeenCalledWith("mission.config.saved");
  });

  it("shows the saved toast when status does not regress", async () => {
    /** a non-regressing save shows the success toast. */
    const { hook, showNotification } = setup({
      mission: makeMission("DRAFT"),
      inspectionDirty: { "insp-1": { lha_ids: ["a"] } },
    });

    vi.mocked(updateInspection).mockResolvedValue({} as never);
    vi.mocked(getMission).mockResolvedValue(makeMission("DRAFT") as never);

    await act(async () => {
      await hook.result.current.handleSave();
    });

    expect(showNotification).toHaveBeenCalledWith("mission.config.saved");
  });
});
