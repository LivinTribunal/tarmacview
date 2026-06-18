import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { AirportDetailResponse } from "@/types/airport";
import type { MapFeature } from "@/types/map";
import type { PendingChange } from "@/hooks/useDirtyHistory";
import useAirportCrud from "./useAirportCrud";

vi.mock("@/api/airports", () => ({
  deleteAirport: vi.fn().mockResolvedValue({}),
  deleteSurface: vi.fn().mockResolvedValue({}),
  deleteObstacle: vi.fn().mockResolvedValue({}),
  deleteSafetyZone: vi.fn().mockResolvedValue({}),
  deleteAGL: vi.fn().mockResolvedValue({}),
  deleteLHA: vi.fn().mockResolvedValue({}),
  updateSurface: vi.fn().mockResolvedValue({}),
  updateObstacle: vi.fn().mockResolvedValue({}),
  updateSafetyZone: vi.fn().mockResolvedValue({}),
  updateAGL: vi.fn().mockResolvedValue({}),
  updateLHA: vi.fn().mockResolvedValue({}),
  updateAirport: vi.fn().mockResolvedValue({}),
}));

import * as api from "@/api/airports";

const airport = {
  id: "apt-1",
  elevation: 100,
  surfaces: [
    {
      id: "srf-1",
      agls: [{ id: "agl-1", lhas: [{ id: "lha-1" }] }],
    },
  ],
  obstacles: [],
  safety_zones: [],
} as unknown as AirportDetailResponse;

// one agl with three lhas - exercises the same-agl reorder chain
const multiLhaAirport = {
  id: "apt-1",
  elevation: 100,
  surfaces: [
    {
      id: "srf-1",
      agls: [{ id: "agl-1", lhas: [{ id: "lha-1" }, { id: "lha-2" }, { id: "lha-3" }] }],
    },
  ],
  obstacles: [],
  safety_zones: [],
} as unknown as AirportDetailResponse;

// two agls, one lha each - exercises cross-group concurrency
const multiAglAirport = {
  id: "apt-1",
  elevation: 100,
  surfaces: [
    {
      id: "srf-1",
      agls: [
        { id: "agl-1", lhas: [{ id: "lha-1" }] },
        { id: "agl-2", lhas: [{ id: "lha-4" }] },
      ],
    },
  ],
  obstacles: [],
  safety_zones: [],
} as unknown as AirportDetailResponse;

function setup(overrides: Partial<Parameters<typeof useAirportCrud>[0]> = {}) {
  /** render the hook with vi.fn stubs for every collaborator. */
  const fetchAirport = vi.fn().mockResolvedValue(airport);
  const getPendingChanges = vi.fn<() => PendingChange[]>().mockReturnValue([]);
  const clearAll = vi.fn();
  const setSelectedFeature = vi.fn();
  const clearAirport = vi.fn();
  const navigate = vi.fn();
  const getMap = vi.fn().mockReturnValue(null);
  const params = {
    id: "apt-1",
    airport,
    fetchAirport,
    getPendingChanges,
    clearAll,
    selectedFeature: null as MapFeature | null,
    setSelectedFeature,
    clearAirport,
    navigate,
    t: (key: string) => key,
    getMap,
    ...overrides,
  };
  const view = renderHook((p: Parameters<typeof useAirportCrud>[0]) => useAirportCrud(p), {
    initialProps: params,
  });
  return { view, ...params };
}

describe("useAirportCrud delete error asymmetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("surface delete swallows the error and sets deleteError", async () => {
    vi.mocked(api.deleteSurface).mockRejectedValueOnce(new Error("boom"));
    const { view } = setup();
    await act(async () => {
      // does not throw - error is swallowed
      await view.result.current.handleDeleteSurface("srf-1");
    });
    expect(view.result.current.deleteError).toBe(true);
  });

  it("obstacle delete swallows the error and sets deleteError", async () => {
    vi.mocked(api.deleteObstacle).mockRejectedValueOnce(new Error("boom"));
    const { view } = setup();
    await act(async () => {
      await view.result.current.handleDeleteObstacle("obs-1");
    });
    expect(view.result.current.deleteError).toBe(true);
  });

  it("safety zone delete swallows the error and sets deleteError", async () => {
    vi.mocked(api.deleteSafetyZone).mockRejectedValueOnce(new Error("boom"));
    const { view } = setup();
    await act(async () => {
      await view.result.current.handleDeleteSafetyZone("zone-1");
    });
    expect(view.result.current.deleteError).toBe(true);
  });

  it("agl delete re-throws while still setting deleteError", async () => {
    vi.mocked(api.deleteAGL).mockRejectedValueOnce(new Error("boom"));
    const { view } = setup();
    await act(async () => {
      await expect(view.result.current.handleDeleteAgl("agl-1")).rejects.toThrow("boom");
    });
    expect(view.result.current.deleteError).toBe(true);
  });

  it("lha delete re-throws while still setting deleteError", async () => {
    vi.mocked(api.deleteLHA).mockRejectedValueOnce(new Error("boom"));
    const { view } = setup();
    await act(async () => {
      await expect(view.result.current.handleDeleteLha("lha-1")).rejects.toThrow("boom");
    });
    expect(view.result.current.deleteError).toBe(true);
  });
});

describe("useAirportCrud handleFeatureDelete dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches by feature type then clears the selection", async () => {
    const { view, setSelectedFeature } = setup();
    await act(async () => {
      await view.result.current.handleFeatureDelete("surface", "srf-1");
    });
    expect(api.deleteSurface).toHaveBeenCalledWith("apt-1", "srf-1");
    expect(setSelectedFeature).toHaveBeenCalledWith(null);
  });

  it("routes lha deletes through the lha endpoint", async () => {
    const { view } = setup();
    await act(async () => {
      await view.result.current.handleFeatureDelete("lha", "lha-1");
    });
    expect(api.deleteLHA).toHaveBeenCalledWith("apt-1", "srf-1", "agl-1", "lha-1");
  });
});

describe("useAirportCrud handleSave", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches only update changes per entity type and clears history", async () => {
    const pending: PendingChange[] = [
      { entityType: "surface", entityId: "srf-1", action: "update", data: { width: 50 } },
      { entityType: "agl", entityId: "agl-1", action: "update", data: { name: "x" } },
      { entityType: "lha", entityId: "lha-1", action: "update", data: { tolerance: 1 } },
      { entityType: "airport", entityId: "apt-1", action: "update", data: { name: "y" } },
      { entityType: "surface", entityId: "srf-1", action: "create", data: { foo: 1 } },
      { entityType: "obstacle", entityId: "obs-1", action: "delete" },
    ];
    const { view, clearAll } = setup({
      getPendingChanges: vi.fn<() => PendingChange[]>().mockReturnValue(pending),
    });
    await act(async () => {
      await view.result.current.handleSave();
    });
    expect(api.updateSurface).toHaveBeenCalledWith("apt-1", "srf-1", { width: 50 });
    expect(api.updateAGL).toHaveBeenCalledWith("apt-1", "srf-1", "agl-1", { name: "x" });
    expect(api.updateLHA).toHaveBeenCalledWith("apt-1", "srf-1", "agl-1", "lha-1", { tolerance: 1 });
    expect(api.updateLHA).toHaveBeenCalledTimes(1);
    expect(api.updateAirport).toHaveBeenCalledWith("apt-1", { name: "y" });
    expect(api.updateObstacle).not.toHaveBeenCalled();
    expect(clearAll).toHaveBeenCalledTimes(1);
  });
});

describe("useAirportCrud handleSave lha reorder dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // restore the shared resolved-value stub for the other describes
    vi.mocked(api.updateLHA).mockReset();
    vi.mocked(api.updateLHA).mockResolvedValue({} as never);
  });

  // mock updateLHA so each call resolves a microtask later and tracks how many
  // requests overlap. one-at-a-time => maxInFlight 1; a concurrent fan-out spikes higher.
  function trackInFlight() {
    /** install an in-flight-counting updateLHA mock and return its trackers. */
    const callOrder: string[] = [];
    const callSeq: Array<number | undefined> = [];
    const tracker = { inFlight: 0, maxInFlight: 0 };
    vi.mocked(api.updateLHA).mockImplementation(((
      _apt: string,
      _sid: string,
      _agl: string,
      lhaId: string,
      data: { sequence_number?: number },
    ) => {
      tracker.inFlight += 1;
      tracker.maxInFlight = Math.max(tracker.maxInFlight, tracker.inFlight);
      callOrder.push(lhaId);
      callSeq.push(data.sequence_number);
      return Promise.resolve().then(() => {
        tracker.inFlight -= 1;
        return {};
      });
    }) as unknown as typeof api.updateLHA);
    return { callOrder, callSeq, tracker };
  }

  it("dispatches same-agl lha reorders sequentially in ascending target order", async () => {
    const { callOrder, callSeq, tracker } = trackInFlight();
    const pending: PendingChange[] = [
      { entityType: "lha", entityId: "lha-1", action: "update", data: { sequence_number: 3 } },
      { entityType: "lha", entityId: "lha-2", action: "update", data: { sequence_number: 1 } },
      { entityType: "lha", entityId: "lha-3", action: "update", data: { sequence_number: 2 } },
    ];
    const { view } = setup({
      airport: multiLhaAirport,
      getPendingChanges: vi.fn<() => PendingChange[]>().mockReturnValue(pending),
    });
    await act(async () => {
      await view.result.current.handleSave();
    });
    // never two puts in flight at once
    expect(tracker.maxInFlight).toBe(1);
    // applied in ascending target order, not the staged order
    expect(callOrder).toEqual(["lha-2", "lha-3", "lha-1"]);
    expect(callSeq).toEqual([1, 2, 3]);
  });

  it("keeps distinct-agl lha updates and non-lha changes concurrent", async () => {
    const { tracker } = trackInFlight();
    const pending: PendingChange[] = [
      { entityType: "lha", entityId: "lha-1", action: "update", data: { sequence_number: 2 } },
      { entityType: "lha", entityId: "lha-4", action: "update", data: { sequence_number: 1 } },
      { entityType: "surface", entityId: "srf-1", action: "update", data: { width: 30 } },
    ];
    const { view } = setup({
      airport: multiAglAirport,
      getPendingChanges: vi.fn<() => PendingChange[]>().mockReturnValue(pending),
    });
    await act(async () => {
      await view.result.current.handleSave();
    });
    // separate agls dispatch in parallel - not serialized across groups
    expect(tracker.maxInFlight).toBe(2);
    expect(api.updateLHA).toHaveBeenCalledTimes(2);
    expect(api.updateSurface).toHaveBeenCalledWith("apt-1", "srf-1", { width: 30 });
  });

  it("sorts seq-less lha edits stably after sequenced ones in the same chain", async () => {
    const { callOrder, tracker } = trackInFlight();
    const pending: PendingChange[] = [
      { entityType: "lha", entityId: "lha-1", action: "update", data: { tolerance: 5 } },
      { entityType: "lha", entityId: "lha-2", action: "update", data: { sequence_number: 1 } },
      { entityType: "lha", entityId: "lha-3", action: "update", data: { tolerance: 7 } },
    ];
    const { view } = setup({
      airport: multiLhaAirport,
      getPendingChanges: vi.fn<() => PendingChange[]>().mockReturnValue(pending),
    });
    await act(async () => {
      await view.result.current.handleSave();
    });
    expect(tracker.maxInFlight).toBe(1);
    // sequenced edit first, seq-less edits keep their staged order behind it
    expect(callOrder).toEqual(["lha-2", "lha-1", "lha-3"]);
  });
});

describe("useAirportCrud handleDeleteAirport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears airport context and navigates on success", async () => {
    const { view, clearAirport, navigate } = setup();
    await act(async () => {
      await view.result.current.handleDeleteAirport();
    });
    expect(clearAirport).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/coordinator-center/airports");
  });

  it("surfaces an inline error and does not navigate on failure", async () => {
    vi.mocked(api.deleteAirport).mockRejectedValueOnce(new Error("nope"));
    const { view, clearAirport, navigate } = setup();
    await act(async () => {
      await view.result.current.handleDeleteAirport();
    });
    expect(clearAirport).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(view.result.current.deleteAirportError).toBe("coordinator.detail.deleteAirportError");
  });
});
