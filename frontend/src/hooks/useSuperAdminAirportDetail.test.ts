import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import useSuperAdminAirportDetail from "./useSuperAdminAirportDetail";

const mockListAirportsAdmin = vi.fn();
const mockListAuditLogs = vi.fn();
const mockListUsers = vi.fn();
const mockUpdateUserAirports = vi.fn();
const mockGetAirport = vi.fn();

vi.mock("@/api/admin", () => ({
  listAirportsAdmin: (...a: unknown[]) => mockListAirportsAdmin(...a),
  listAuditLogs: (...a: unknown[]) => mockListAuditLogs(...a),
  listUsers: (...a: unknown[]) => mockListUsers(...a),
  updateUserAirports: (...a: unknown[]) => mockUpdateUserAirports(...a),
}));

vi.mock("@/api/airports", () => ({
  getAirport: (...a: unknown[]) => mockGetAirport(...a),
}));

const AIRPORT = { id: "apt-1", icao_code: "LZIB", name: "Bratislava" };
const AIRPORT_DETAIL = { id: "apt-1", name: "Bratislava", surfaces: [] };
const ASSIGNED = {
  id: "u-1",
  name: "Alice",
  email: "a@x.com",
  role: "OPERATOR",
  airports: [{ id: "apt-1", icao_code: "LZIB", name: "Bratislava" }],
};
const UNASSIGNED = {
  id: "u-2",
  name: "Bob",
  email: "b@x.com",
  role: "OPERATOR",
  airports: [{ id: "apt-2", icao_code: "OTHR", name: "Other" }],
};

function setup(airportId: string | undefined = "apt-1") {
  const navigate = vi.fn();
  const selectAirport = vi.fn();
  const view = renderHook(() =>
    useSuperAdminAirportDetail({ airportId, navigate, selectAirport }),
  );
  return { ...view, navigate, selectAirport };
}

describe("useSuperAdminAirportDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAirportsAdmin.mockResolvedValue({ data: [AIRPORT] });
    mockGetAirport.mockResolvedValue(AIRPORT_DETAIL);
    mockListUsers.mockImplementation((params: { airport_id?: string }) =>
      Promise.resolve(
        params.airport_id
          ? { data: [ASSIGNED], meta: { total: 1 } }
          : { data: [ASSIGNED, UNASSIGNED], meta: { total: 2 } },
      ),
    );
    mockListAuditLogs.mockResolvedValue({ data: [{ id: "log-1" }], meta: { total: 1 } });
    mockUpdateUserAirports.mockResolvedValue({});
  });

  it("loads airport, detail, users, and scoped activity", async () => {
    const { result } = setup("apt-1");
    await waitFor(() => expect(result.current.airport).not.toBeNull());
    expect(result.current.airportDetail).toEqual(AIRPORT_DETAIL);
    expect(result.current.assignedUsers).toEqual([ASSIGNED]);
    expect(mockListAuditLogs).toHaveBeenCalledWith({
      airport_id: "apt-1",
      limit: 20,
      sort_by: "timestamp",
      sort_dir: "desc",
    });
  });

  it("computes unassigned as all users minus assigned", async () => {
    const { result } = setup("apt-1");
    await waitFor(() => expect(result.current.unassigned).toEqual([UNASSIGNED]));
  });

  it("adds this airport to a user's existing assignment ids", async () => {
    const { result } = setup("apt-1");
    await waitFor(() => expect(result.current.unassigned).toEqual([UNASSIGNED]));
    await act(async () => {
      await result.current.handleAddUser("u-2");
    });
    expect(mockUpdateUserAirports).toHaveBeenCalledWith("u-2", {
      airport_ids: ["apt-2", "apt-1"],
    });
  });

  it("removes this airport from a user's assignment ids", async () => {
    const { result } = setup("apt-1");
    await waitFor(() => expect(result.current.assignedUsers).toEqual([ASSIGNED]));
    await act(async () => {
      await result.current.handleRemoveUser("u-1");
    });
    expect(mockUpdateUserAirports).toHaveBeenCalledWith("u-1", {
      airport_ids: [],
    });
  });

  it("openInCoordinator selects the airport and navigates, with optional query", async () => {
    const { result, navigate, selectAirport } = setup("apt-1");
    await waitFor(() => expect(result.current.airportDetail).not.toBeNull());
    act(() => result.current.openInCoordinator());
    expect(selectAirport).toHaveBeenCalledWith(AIRPORT_DETAIL);
    expect(navigate).toHaveBeenCalledWith("/coordinator-center/airports/apt-1");
    act(() => result.current.openInCoordinator("action=bulk-change-drone"));
    expect(navigate).toHaveBeenLastCalledWith(
      "/coordinator-center/airports/apt-1?action=bulk-change-drone",
    );
  });
});
