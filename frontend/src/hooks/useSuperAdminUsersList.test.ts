import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import useSuperAdminUsersList from "./useSuperAdminUsersList";

// stable t reference so the memoized filterSpec keeps a stable identity
const stableT = (k: string) => k;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT, i18n: { language: "en" } }),
}));

const mockListUsers = vi.fn();
const mockListAirportsAdmin = vi.fn();
const mockDeactivateUser = vi.fn();

vi.mock("@/api/admin", () => ({
  listUsers: (...a: unknown[]) => mockListUsers(...a),
  listAirportsAdmin: (...a: unknown[]) => mockListAirportsAdmin(...a),
  deactivateUser: (...a: unknown[]) => mockDeactivateUser(...a),
  activateUser: vi.fn(),
  deleteUser: vi.fn(),
}));

const USER_A = {
  id: "u-1",
  email: "a@x.com",
  name: "A",
  role: "OPERATOR",
  is_active: true,
  airports: [],
  last_login: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const USER_B = { ...USER_A, id: "u-2", name: "B", role: "COORDINATOR" };

describe("useSuperAdminUsersList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListUsers.mockResolvedValue({ data: [USER_A, USER_B], meta: { total: 2 } });
    mockListAirportsAdmin.mockResolvedValue({ data: [] });
    mockDeactivateUser.mockResolvedValue({});
  });

  it("fetches with only limit/offset when search and status are unset", async () => {
    renderHook(() => useSuperAdminUsersList());
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(1));
    expect(mockListUsers).toHaveBeenLastCalledWith({ limit: 20, offset: 0 });
  });

  it("adds search and derives is_active from the status param", async () => {
    const { result } = renderHook(() => useSuperAdminUsersList());
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(1));
    act(() => result.current.setSearch("alpha"));
    await waitFor(() =>
      expect(mockListUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "alpha", limit: 20, offset: 0 }),
      ),
    );
    expect(mockListUsers).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ is_active: expect.anything() }),
    );
  });

  it("confirmed deactivate calls the api and refetches", async () => {
    const { result } = renderHook(() => useSuperAdminUsersList());
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(1));
    act(() => result.current.setConfirmAction({ type: "deactivate", user: USER_A }));
    await act(async () => {
      await result.current.handleConfirmAction();
    });
    expect(mockDeactivateUser).toHaveBeenCalledWith("u-1");
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(2));
  });
});
