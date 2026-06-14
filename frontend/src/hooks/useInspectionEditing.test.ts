import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import useInspectionEditing from "./useInspectionEditing";
import {
  getMission,
  addInspection,
  updateInspection,
  removeInspection,
  reorderInspections,
} from "@/api/missions";
import type { LhaSelectionRules, MissionDetailResponse } from "@/types/mission";
import type { InspectionTemplateResponse } from "@/types/inspectionTemplate";
import type { AGLResponse } from "@/types/airport";

vi.mock("@/api/missions", () => ({
  getMission: vi.fn(),
  addInspection: vi.fn(),
  updateInspection: vi.fn(),
  removeInspection: vi.fn(),
  reorderInspections: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  isAxiosError: (e: unknown) =>
    (e as { isAxiosError?: boolean } | null)?.isAxiosError === true,
}));

const AGLS = [
  { id: "agl-1", lhas: [{ id: "lha-1" }, { id: "lha-2" }] },
  { id: "agl-2", lhas: [{ id: "lha-3" }] },
] as unknown as AGLResponse[];

function makeMission(over: Partial<MissionDetailResponse> = {}): MissionDetailResponse {
  return { id: "m-1", status: "DRAFT", inspections: [], ...over } as MissionDetailResponse;
}

function setup(over: {
  mission?: MissionDetailResponse;
  templateMap?: Map<string, InspectionTemplateResponse>;
  selectedInspectionId?: string | null;
} = {}) {
  const setSelectedInspectionId = vi.fn();
  const setVisibleInspectionIds = vi.fn();
  const updateMissionState = vi.fn();
  const setLastSaved = vi.fn();
  const showNotification = vi.fn();
  const view = renderHook(() =>
    useInspectionEditing({
      id: "m-1",
      mission: over.mission ?? makeMission(),
      templateMap: over.templateMap ?? new Map(),
      allAgls: AGLS,
      selectedInspectionId: over.selectedInspectionId ?? null,
      setSelectedInspectionId,
      setVisibleInspectionIds,
      updateMissionState,
      setLastSaved,
      showNotification,
      t: (k: string) => k,
    }),
  );
  return {
    view,
    setSelectedInspectionId,
    setVisibleInspectionIds,
    updateMissionState,
    setLastSaved,
    showNotification,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useInspectionEditing add", () => {
  it("seeds every lha under the template's target agls and persists them", async () => {
    const template = {
      id: "t-1",
      target_agl_ids: ["agl-1"],
    } as unknown as InspectionTemplateResponse;
    const fresh = makeMission({
      inspections: [
        { id: "i-1", sequence_order: 1 },
        { id: "i-2", sequence_order: 2 },
      ] as never,
    });
    vi.mocked(addInspection).mockResolvedValue({} as never);
    vi.mocked(getMission).mockResolvedValue(fresh as never);
    vi.mocked(updateInspection).mockResolvedValue({} as never);
    const {
      view,
      updateMissionState,
      setVisibleInspectionIds,
      setLastSaved,
      showNotification,
    } = setup({ templateMap: new Map([["t-1", template]]) });

    await act(async () => {
      await view.result.current.handleAddInspection("t-1", "HORIZONTAL_RANGE");
    });

    expect(addInspection).toHaveBeenCalledWith("m-1", {
      template_id: "t-1",
      method: "HORIZONTAL_RANGE",
    });
    expect(updateMissionState).toHaveBeenCalledWith(fresh, "DRAFT");
    expect(setVisibleInspectionIds).toHaveBeenCalledWith(new Set(["i-1", "i-2"]));

    // the new inspection (highest sequence_order) gets the seeded lha_ids,
    // excluding lhas of agls outside the template targets
    expect(updateInspection).toHaveBeenCalledWith("m-1", "i-2", {
      config: { lha_ids: ["lha-1", "lha-2"] },
    });
    expect(view.result.current.selectedLhas["i-2"]).toEqual(
      new Set(["lha-1", "lha-2"]),
    );
    expect(setLastSaved).toHaveBeenCalled();
    expect(showNotification).toHaveBeenCalledWith("mission.config.saved");
  });
});

describe("useInspectionEditing change method", () => {
  it("updates the method, refetches the mission, and toasts saved", async () => {
    const fresh = makeMission();
    vi.mocked(updateInspection).mockResolvedValue({} as never);
    vi.mocked(getMission).mockResolvedValue(fresh as never);
    const { view, updateMissionState, setLastSaved, showNotification } = setup();

    await act(async () => {
      await view.result.current.handleChangeMethod("i-1", "VERTICAL_PROFILE");
    });

    expect(updateInspection).toHaveBeenCalledWith("m-1", "i-1", {
      method: "VERTICAL_PROFILE",
    });
    expect(updateMissionState).toHaveBeenCalledWith(fresh, "DRAFT");
    expect(setLastSaved).toHaveBeenCalled();
    expect(showNotification).toHaveBeenCalledWith("mission.config.saved");
  });
});

describe("useInspectionEditing remove", () => {
  it("clears dirty state and deselects the removed inspection on success", async () => {
    vi.mocked(removeInspection).mockResolvedValue({} as never);
    const fresh = makeMission();
    vi.mocked(getMission).mockResolvedValue(fresh as never);
    const { view, setSelectedInspectionId, updateMissionState, showNotification } =
      setup({ selectedInspectionId: "i-1" });

    // stage dirty state for the inspection about to be removed
    act(() => {
      view.result.current.handleToggleLha("i-1", "lha-1");
    });
    expect(view.result.current.inspectionDirty["i-1"]).toEqual({
      lha_ids: ["lha-1"],
    });

    await act(async () => {
      await view.result.current.handleRemoveInspection("i-1");
    });

    expect(removeInspection).toHaveBeenCalledWith("m-1", "i-1");
    expect(setSelectedInspectionId).toHaveBeenCalledWith(null);
    expect(view.result.current.inspectionDirty["i-1"]).toBeUndefined();
    expect(updateMissionState).toHaveBeenCalledWith(fresh, "DRAFT");
    expect(showNotification).toHaveBeenCalledWith("mission.config.saved");
  });

  it("leaves state untouched and toasts domainError on a 409 failure", async () => {
    vi.mocked(removeInspection).mockRejectedValue({
      isAxiosError: true,
      response: { status: 409 },
    });
    const { view, setSelectedInspectionId, updateMissionState, showNotification } =
      setup({ selectedInspectionId: "i-1" });
    act(() => {
      view.result.current.handleToggleLha("i-1", "lha-1");
    });

    await act(async () => {
      await view.result.current.handleRemoveInspection("i-1");
    });

    expect(getMission).not.toHaveBeenCalled();
    expect(updateMissionState).not.toHaveBeenCalled();
    expect(setSelectedInspectionId).not.toHaveBeenCalled();
    expect(view.result.current.inspectionDirty["i-1"]).toEqual({
      lha_ids: ["lha-1"],
    });
    expect(showNotification).toHaveBeenCalledWith("mission.config.domainError");
  });

  it("toasts removeError on a non-409 failure without refetching", async () => {
    vi.mocked(removeInspection).mockRejectedValue(new Error("boom"));
    const { view, updateMissionState, showNotification } = setup();

    await act(async () => {
      await view.result.current.handleRemoveInspection("i-1");
    });

    expect(getMission).not.toHaveBeenCalled();
    expect(updateMissionState).not.toHaveBeenCalled();
    expect(showNotification).toHaveBeenCalledWith("mission.config.removeError");
  });
});

describe("useInspectionEditing reorder", () => {
  it("suppresses the saved toast when reorder regresses the status", async () => {
    vi.mocked(reorderInspections).mockResolvedValue({} as never);
    vi.mocked(getMission).mockResolvedValue(makeMission({ status: "DRAFT" }) as never);
    const { view, updateMissionState, setLastSaved, showNotification } = setup({
      mission: makeMission({ status: "PLANNED" }),
    });

    await act(async () => {
      await view.result.current.handleReorder(["i-2", "i-1"]);
    });

    expect(reorderInspections).toHaveBeenCalledWith("m-1", {
      inspection_ids: ["i-2", "i-1"],
    });
    expect(updateMissionState).toHaveBeenCalledWith(
      expect.objectContaining({ status: "DRAFT" }),
      "PLANNED",
    );
    expect(setLastSaved).toHaveBeenCalled();
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("shows the saved toast when reorder keeps the status", async () => {
    vi.mocked(reorderInspections).mockResolvedValue({} as never);
    vi.mocked(getMission).mockResolvedValue(makeMission({ status: "DRAFT" }) as never);
    const { view, showNotification } = setup();

    await act(async () => {
      await view.result.current.handleReorder(["i-1"]);
    });

    expect(showNotification).toHaveBeenCalledWith("mission.config.saved");
  });
});

describe("useInspectionEditing lha selection", () => {
  it("toggles an lha on and off, syncing selection and dirty lha_ids", () => {
    const { view } = setup();

    act(() => {
      view.result.current.handleToggleLha("i-1", "lha-1");
    });
    expect(view.result.current.selectedLhas["i-1"]).toEqual(new Set(["lha-1"]));
    expect(view.result.current.inspectionDirty["i-1"].lha_ids).toEqual(["lha-1"]);

    act(() => {
      view.result.current.handleToggleLha("i-1", "lha-1");
    });
    expect(view.result.current.selectedLhas["i-1"]).toEqual(new Set());
    expect(view.result.current.inspectionDirty["i-1"].lha_ids).toEqual([]);
  });

  it("replaces only the changed agl's lhas on a per-agl selection change", () => {
    const { view } = setup();
    act(() => {
      view.result.current.handleToggleLha("i-1", "lha-1");
    });
    act(() => {
      view.result.current.handleToggleLha("i-1", "lha-3");
    });

    // agl-1's lhas are stripped and replaced; agl-2's selection survives
    act(() => {
      view.result.current.handleSelectionForAglChange("i-1", "agl-1", new Set(["lha-2"]));
    });
    expect(view.result.current.selectedLhas["i-1"]).toEqual(
      new Set(["lha-2", "lha-3"]),
    );
    expect(new Set(view.result.current.inspectionDirty["i-1"].lha_ids)).toEqual(
      new Set(["lha-2", "lha-3"]),
    );
  });

  it("stores lha selection rules in both rule state and dirty config", () => {
    const rules: LhaSelectionRules = { "agl-1": { mode: "ALL" } };
    const { view } = setup();

    act(() => {
      view.result.current.handleLhaRulesChange("i-1", rules);
    });
    expect(view.result.current.lhaRules["i-1"]).toBe(rules);
    expect(view.result.current.inspectionDirty["i-1"].lha_selection_rules).toBe(rules);
  });
});
