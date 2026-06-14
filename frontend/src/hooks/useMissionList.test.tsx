import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import useMissionList from "./useMissionList";
import type { ReactNode } from "react";

const mockListMissions = vi.fn();
const mockDeleteMission = vi.fn();
const mockDuplicateMission = vi.fn();
const mockUpdateMission = vi.fn();
const mockListDroneProfiles = vi.fn();

vi.mock("@/api/missions", () => ({
  listMissions: (...a: unknown[]) => mockListMissions(...a),
  deleteMission: (...a: unknown[]) => mockDeleteMission(...a),
  duplicateMission: (...a: unknown[]) => mockDuplicateMission(...a),
  updateMission: (...a: unknown[]) => mockUpdateMission(...a),
}));
vi.mock("@/api/droneProfiles", () => ({
  listDroneProfiles: (...a: unknown[]) => mockListDroneProfiles(...a),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListMissions.mockResolvedValue({
    data: [
      {
        id: "m-1",
        name: "Mission One",
        status: "DRAFT",
        airport_id: "apt-1",
        drone_profile_id: "dp-1",
        created_at: "2026-03-01T00:00:00Z",
        updated_at: "2026-03-02T00:00:00Z",
      },
    ],
    meta: { total: 1 },
  });
  mockListDroneProfiles.mockResolvedValue({
    data: [{ id: "dp-1", name: "DJI" }],
    meta: { total: 1 },
  });
  mockDeleteMission.mockResolvedValue({});
  mockDuplicateMission.mockResolvedValue({});
  mockUpdateMission.mockResolvedValue({});
});

describe("useMissionList", () => {
  it("fetches missions for the airport with MAX_LIST_LIMIT", async () => {
    const { result } = renderHook(
      () => useMissionList({ airportId: "apt-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockListMissions).toHaveBeenCalledTimes(1);
    const params = mockListMissions.mock.calls[0][0];
    expect(params.airport_id).toBe("apt-1");
    expect(typeof params.limit).toBe("number");
  });

  it("does not fetch when no airport is selected", async () => {
    renderHook(() => useMissionList({ airportId: undefined }), { wrapper });
    expect(mockListMissions).not.toHaveBeenCalled();
  });

  it("delete/duplicate/rename refresh the list afterwards", async () => {
    const { result } = renderHook(
      () => useMissionList({ airportId: "apt-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleDelete({
        id: "m-1",
        name: "Mission One",
      } as never);
    });
    expect(mockDeleteMission).toHaveBeenCalledWith("m-1");

    await act(async () => {
      await result.current.handleDuplicate({
        id: "m-1",
        name: "Mission One",
      } as never);
    });
    expect(mockDuplicateMission).toHaveBeenCalledWith("m-1");

    await act(async () => {
      await result.current.handleRename(
        { id: "m-1", name: "Old" } as never,
        "  New  ",
      );
    });
    expect(mockUpdateMission).toHaveBeenCalledWith("m-1", { name: "New" });
  });

  it("rename with empty name is a no-op (does not call updateMission)", async () => {
    const { result } = renderHook(
      () => useMissionList({ airportId: "apt-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleRename(
        { id: "m-1", name: "Old" } as never,
        "   ",
      );
    });
    expect(mockUpdateMission).not.toHaveBeenCalled();
  });
});
