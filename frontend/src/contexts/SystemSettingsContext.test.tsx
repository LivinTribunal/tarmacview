/**
 * tests for SystemSettingsContext fetch policy and auth coupling.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { type ReactNode } from "react";
import client from "@/api/client";
import { getSystemSettings } from "@/api/admin";
import { AuthProvider, useAuth } from "./AuthContext";
import { SystemSettingsProvider, useSystemSettings } from "./SystemSettingsContext";

vi.mock("@/api/client", () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
  isAxiosError: vi.fn(),
}));

vi.mock("@/api/admin", () => ({
  getSystemSettings: vi.fn(),
}));

const MOCK_USER = {
  id: "u-1",
  email: "test@example.com",
  name: "Test User",
  role: "SUPER_ADMIN",
  airports: [],
};

const MOCK_SETTINGS = {
  maintenance_mode: false,
  cesium_ion_token: "ion-token",
  elevation_api_url: "https://elevation.example.com",
  elevation_api_fallback_enabled: false,
  elevation_api_provider: "OPEN_ELEVATION" as const,
  elevation_api_key: null,
};

/**
 * wrapper that mounts the provider under test inside a real AuthProvider.
 */
function wrapper({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <SystemSettingsProvider>{children}</SystemSettingsProvider>
    </AuthProvider>
  );
}

function useAuthAndSettings() {
  return { auth: useAuth(), sys: useSystemSettings() };
}

// queue the mount-time POST /auth/refresh + GET /auth/me as a valid session
function mockSessionRehydrate() {
  vi.mocked(client.post).mockResolvedValueOnce({ data: { access_token: "tok" } });
  vi.mocked(client.get).mockResolvedValueOnce({ data: MOCK_USER });
}

describe("SystemSettingsContext", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("throws when useSystemSettings is used outside the provider", () => {
    expect(() => renderHook(() => useSystemSettings())).toThrow(
      "useSystemSettings must be used within SystemSettingsProvider",
    );
  });

  it("fetches settings on mount when a session rehydrates", async () => {
    mockSessionRehydrate();
    vi.mocked(getSystemSettings).mockResolvedValue(MOCK_SETTINGS);

    const { result } = renderHook(() => useAuthAndSettings(), { wrapper });

    await waitFor(() => {
      expect(result.current.sys.settings).toEqual(MOCK_SETTINGS);
    });
    expect(getSystemSettings).toHaveBeenCalledTimes(1);
  });

  it("does not fetch while unauthenticated", async () => {
    vi.mocked(client.post).mockRejectedValueOnce(new Error("no cookie"));

    const { result } = renderHook(() => useAuthAndSettings(), { wrapper });

    await waitFor(() => {
      expect(result.current.auth.isLoading).toBe(false);
    });
    expect(getSystemSettings).not.toHaveBeenCalled();
    expect(result.current.sys.settings).toBeNull();
  });

  it("refetches when login flips auth from false to true", async () => {
    // mount-time refresh fails, then login succeeds
    vi.mocked(client.post)
      .mockRejectedValueOnce(new Error("no cookie"))
      .mockResolvedValueOnce({
        data: { access_token: "tok", user: MOCK_USER },
      });
    vi.mocked(getSystemSettings).mockResolvedValue(MOCK_SETTINGS);

    const { result } = renderHook(() => useAuthAndSettings(), { wrapper });
    await waitFor(() => {
      expect(result.current.auth.isLoading).toBe(false);
    });
    expect(getSystemSettings).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.auth.login("test@example.com", "password123");
    });

    await waitFor(() => {
      expect(result.current.sys.settings).toEqual(MOCK_SETTINGS);
    });
    expect(getSystemSettings).toHaveBeenCalledTimes(1);
  });

  it("clears settings on logout without refetching", async () => {
    mockSessionRehydrate();

    // logout fires a POST /auth/logout
    vi.mocked(client.post).mockResolvedValueOnce({});
    vi.mocked(getSystemSettings).mockResolvedValue(MOCK_SETTINGS);

    const { result } = renderHook(() => useAuthAndSettings(), { wrapper });
    await waitFor(() => {
      expect(result.current.sys.settings).toEqual(MOCK_SETTINGS);
    });

    act(() => {
      result.current.auth.logout();
    });

    await waitFor(() => {
      expect(result.current.sys.settings).toBeNull();
    });
    expect(getSystemSettings).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous value when a refetch is rejected", async () => {
    mockSessionRehydrate();
    vi.mocked(getSystemSettings)
      .mockResolvedValueOnce(MOCK_SETTINGS)
      .mockRejectedValueOnce(new Error("403 forbidden"));

    const { result } = renderHook(() => useAuthAndSettings(), { wrapper });
    await waitFor(() => {
      expect(result.current.sys.settings).toEqual(MOCK_SETTINGS);
    });

    // must resolve silently - non-privileged users get a 403 here
    await act(async () => {
      await result.current.sys.refresh();
    });

    expect(result.current.sys.settings).toEqual(MOCK_SETTINGS);
    expect(result.current.sys.loading).toBe(false);
    expect(getSystemSettings).toHaveBeenCalledTimes(2);
  });

  it("refresh is a no-op while unauthenticated", async () => {
    vi.mocked(client.post).mockRejectedValueOnce(new Error("no cookie"));

    const { result } = renderHook(() => useAuthAndSettings(), { wrapper });
    await waitFor(() => {
      expect(result.current.auth.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.sys.refresh();
    });

    expect(getSystemSettings).not.toHaveBeenCalled();
    expect(result.current.sys.settings).toBeNull();
  });
});
