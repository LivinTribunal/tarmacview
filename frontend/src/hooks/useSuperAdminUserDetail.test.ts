import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import useSuperAdminUserDetail from "./useSuperAdminUserDetail";

const mockGetUser = vi.fn();
const mockUpdateUser = vi.fn();
const mockResetPassword = vi.fn();
const mockUpdateUserAirports = vi.fn();
const mockListAuditLogs = vi.fn();

vi.mock("@/api/admin", () => ({
  getUser: (...a: unknown[]) => mockGetUser(...a),
  updateUser: (...a: unknown[]) => mockUpdateUser(...a),
  resetPassword: (...a: unknown[]) => mockResetPassword(...a),
  updateUserAirports: (...a: unknown[]) => mockUpdateUserAirports(...a),
  listAuditLogs: (...a: unknown[]) => mockListAuditLogs(...a),
}));

const USER = {
  id: "u-1",
  email: "alpha@example.com",
  name: "Alpha",
  role: "OPERATOR",
  is_active: true,
  airports: [
    { id: "apt-1", icao_code: "AAAA", name: "A" },
    { id: "apt-2", icao_code: "BBBB", name: "B" },
  ],
  last_login: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function setup(selectedUserId: string | undefined) {
  const fetchUsers = vi.fn();
  const navigate = vi.fn();
  const view = renderHook(() =>
    useSuperAdminUserDetail({ selectedUserId, fetchUsers, navigate }),
  );
  return { ...view, fetchUsers, navigate };
}

describe("useSuperAdminUserDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue(USER);
    mockUpdateUser.mockResolvedValue({ ...USER, name: "Edited" });
    mockResetPassword.mockResolvedValue({ invitation_link: "/setup-password?t=x" });
    mockUpdateUserAirports.mockResolvedValue(USER);
    mockListAuditLogs.mockResolvedValue({ data: [{ id: "log-1" }], meta: { total: 1 } });
  });

  it("loads the user, seeds edit fields, and fetches its audit logs", async () => {
    const { result } = setup("u-1");
    await waitFor(() => expect(result.current.selectedUser).not.toBeNull());
    expect(result.current.editName).toBe("Alpha");
    expect(result.current.editEmail).toBe("alpha@example.com");
    expect(result.current.editRole).toBe("OPERATOR");
    expect(result.current.userLogs).toHaveLength(1);
    expect(mockListAuditLogs).toHaveBeenCalledWith({
      user_id: "u-1",
      limit: 20,
      sort_by: "timestamp",
      sort_dir: "desc",
    });
  });

  it("clears state when there is no selected user id", async () => {
    const { result } = setup(undefined);
    await waitFor(() => expect(result.current.selectedUser).toBeNull());
    expect(result.current.userLogs).toEqual([]);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("redirects to the list when the user fetch fails", async () => {
    mockGetUser.mockRejectedValue(new Error("nope"));
    const { navigate } = setup("u-9");
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/super-admin/users"));
  });

  it("saves edited fields and refreshes the list", async () => {
    const { result, fetchUsers } = setup("u-1");
    await waitFor(() => expect(result.current.selectedUser).not.toBeNull());
    await act(async () => {
      await result.current.handleSaveUser();
    });
    expect(mockUpdateUser).toHaveBeenCalledWith("u-1", {
      name: "Alpha",
      email: "alpha@example.com",
      role: "OPERATOR",
    });
    expect(fetchUsers).toHaveBeenCalled();
  });

  it("builds the reset link from window origin + invitation link", async () => {
    const { result } = setup("u-1");
    await waitFor(() => expect(result.current.selectedUser).not.toBeNull());
    await act(async () => {
      await result.current.handleResetPassword();
    });
    expect(result.current.resetLink).toBe(
      window.location.origin + "/setup-password?t=x",
    );
  });

  it("removes an airport by filtering it out of the id list", async () => {
    const { result } = setup("u-1");
    await waitFor(() => expect(result.current.selectedUser).not.toBeNull());
    await act(async () => {
      await result.current.handleRemoveAirport("apt-1");
    });
    expect(mockUpdateUserAirports).toHaveBeenCalledWith("u-1", {
      airport_ids: ["apt-2"],
    });
  });

  it("adds an airport by appending it to the current id list", async () => {
    const { result } = setup("u-1");
    await waitFor(() => expect(result.current.selectedUser).not.toBeNull());
    await act(async () => {
      await result.current.handleAddAirport("apt-9");
    });
    expect(mockUpdateUserAirports).toHaveBeenCalledWith("u-1", {
      airport_ids: ["apt-1", "apt-2", "apt-9"],
    });
  });
});
