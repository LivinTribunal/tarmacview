import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { AirportDetailResponse } from "@/types/airport";
import type { InspectionTemplateResponse } from "@/types/inspectionTemplate";
import useTemplateAutosave from "./useTemplateAutosave";

const getInspectionTemplate = vi.fn();
const listInspectionTemplates = vi.fn().mockResolvedValue({ data: [] });
const updateInspectionTemplate = vi.fn();
const deleteInspectionTemplate = vi.fn().mockResolvedValue({});
const createInspectionTemplate = vi.fn().mockResolvedValue({ id: "new-id" });

vi.mock("@/api/inspectionTemplates", () => ({
  getInspectionTemplate: (...a: unknown[]) => getInspectionTemplate(...a),
  listInspectionTemplates: (...a: unknown[]) => listInspectionTemplates(...a),
  updateInspectionTemplate: (...a: unknown[]) => updateInspectionTemplate(...a),
  deleteInspectionTemplate: (...a: unknown[]) => deleteInspectionTemplate(...a),
  createInspectionTemplate: (...a: unknown[]) => createInspectionTemplate(...a),
}));

const airportDetail = { id: "apt-1", surfaces: [] } as unknown as AirportDetailResponse;

// stable across re-renders - fetchData is memoized on [id, airportDetail, t]
const stableT = (k: string) => k;

function tpl(over: Partial<InspectionTemplateResponse> = {}): InspectionTemplateResponse {
  return {
    id: "t-1",
    name: "Tmpl",
    methods: ["HORIZONTAL_RANGE"],
    target_agl_ids: [],
    default_config: null,
    updated_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    mission_count: 0,
    ...over,
  } as unknown as InspectionTemplateResponse;
}

function setup() {
  const navigate = vi.fn();
  const showNotif = vi.fn();
  const setShowCreate = vi.fn();
  const setShowDelete = vi.fn();
  const view = renderHook(() =>
    useTemplateAutosave({
      id: "t-1",
      airportDetail,
      navigate,
      t: stableT,
      showNotif,
      setShowCreate,
      setShowDelete,
    }),
  );
  return { view, navigate, showNotif, setShowCreate, setShowDelete };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("useTemplateAutosave hydration", () => {
  it("hydrates a 47-key null config when default_config is absent", async () => {
    getInspectionTemplate.mockResolvedValue(tpl({ default_config: null }));
    const { view } = setup();
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    const cfg = view.result.current.editConfig!;
    expect(Object.keys(cfg)).toHaveLength(47);
    expect(Object.values(cfg).every((v) => v === null)).toBe(true);
  });

  it("copies the 47 config keys when default_config is present", async () => {
    getInspectionTemplate.mockResolvedValue(
      tpl({ default_config: { id: "c", altitude_offset: 5, iso: 100 } as never }),
    );
    const { view } = setup();
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    const cfg = view.result.current.editConfig!;
    expect(Object.keys(cfg)).toHaveLength(47);
    expect(cfg.altitude_offset).toBe(5);
    expect(cfg.iso).toBe(100);
    expect("id" in cfg).toBe(false);
  });
});

describe("useTemplateAutosave debounced save", () => {
  it("fires the latest performSave once after the debounce window", async () => {
    getInspectionTemplate.mockResolvedValue(tpl());
    updateInspectionTemplate.mockResolvedValue(tpl({ name: "Saved" }));
    const { view } = setup();
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    act(() => view.result.current.handleNameChange("A"));
    act(() => view.result.current.handleNameChange("AB"));
    expect(updateInspectionTemplate).not.toHaveBeenCalled();

    // AUTOSAVE_DEBOUNCE_MS is 1000ms
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1100));
    });

    expect(updateInspectionTemplate).toHaveBeenCalledTimes(1);
    const [, payload] = updateInspectionTemplate.mock.calls[0];
    expect(payload.name).toBe("AB");
    expect(payload.methods).toEqual(["HORIZONTAL_RANGE"]);
  });
});

describe("useTemplateAutosave lha re-seed guard", () => {
  it("keeps a manual lha selection across an autosave template refresh", async () => {
    const agl = {
      id: "agl-x",
      lhas: [{ id: "lha-1" }, { id: "lha-2" }, { id: "lha-3" }],
    };
    const detail = {
      id: "apt-1",
      surfaces: [{ agls: [agl] }],
    } as unknown as AirportDetailResponse;

    // null config => the re-seed would fall back to "all lhas" without the guard
    getInspectionTemplate.mockResolvedValue(
      tpl({ target_agl_ids: ["agl-x"], default_config: null }),
    );
    updateInspectionTemplate.mockResolvedValue(
      tpl({ target_agl_ids: ["agl-x"], default_config: null }),
    );

    const view = renderHook(() =>
      useTemplateAutosave({
        id: "t-1",
        airportDetail: detail,
        navigate: vi.fn(),
        t: stableT,
        showNotif: vi.fn(),
        setShowCreate: vi.fn(),
        setShowDelete: vi.fn(),
      }),
    );

    await waitFor(() => expect(view.result.current.loading).toBe(false));
    // initial seed selects every lha
    await waitFor(() => expect(view.result.current.selectedLhaIds.size).toBe(3));

    act(() => view.result.current.handleToggleLha("lha-2"));
    act(() => view.result.current.handleToggleLha("lha-3"));
    expect([...view.result.current.selectedLhaIds]).toEqual(["lha-1"]);

    // the debounced autosave bumps the template identity and re-fires the re-seed
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1100));
    });

    expect(updateInspectionTemplate).toHaveBeenCalled();
    expect([...view.result.current.selectedLhaIds]).toEqual(["lha-1"]);
  });
});

describe("useTemplateAutosave crud", () => {
  it("closes the delete dialog and navigates away after delete", async () => {
    getInspectionTemplate.mockResolvedValue(tpl());
    const { view, navigate, setShowDelete } = setup();
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    await act(async () => {
      await view.result.current.handleDelete();
    });
    expect(setShowDelete).toHaveBeenCalledWith(false);
    expect(navigate).toHaveBeenCalledWith("/coordinator-center/inspections");
  });

  it("navigates to the new template id on create", async () => {
    getInspectionTemplate.mockResolvedValue(tpl());
    const { view, navigate, setShowCreate } = setup();
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    await act(async () => {
      await view.result.current.handleCreate({ name: "X", aglId: "", method: "HORIZONTAL_RANGE" });
    });
    expect(setShowCreate).toHaveBeenCalledWith(false);
    expect(navigate).toHaveBeenCalledWith("/coordinator-center/inspections/new-id");
  });
});
