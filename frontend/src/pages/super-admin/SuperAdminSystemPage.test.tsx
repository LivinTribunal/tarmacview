import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SuperAdminSystemPage from "./SuperAdminSystemPage";
import type { SystemSettingsResponse } from "@/types/admin";

const stableT = (key: string) => key;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT, i18n: { language: "en" } }),
}));

const mockGet = vi.fn();
const mockUpdate = vi.fn();
vi.mock("@/api/admin", () => ({
  getSystemSettings: (...args: unknown[]) => mockGet(...args),
  updateSystemSettings: (...args: unknown[]) => mockUpdate(...args),
}));

const mockRefresh = vi.fn(async () => undefined);
vi.mock("@/contexts/SystemSettingsContext", () => ({
  useSystemSettings: () => ({ settings: null, loading: false, refresh: mockRefresh }),
}));

function makeSettings(overrides: Partial<SystemSettingsResponse> = {}): SystemSettingsResponse {
  return {
    maintenance_mode: false,
    cesium_ion_token: "",
    elevation_api_url: "https://api.open-elevation.com",
    elevation_api_fallback_enabled: true,
    elevation_api_provider: "OPEN_ELEVATION",
    elevation_api_key: null,
    ...overrides,
  };
}

describe("SuperAdminSystemPage - remote elevation panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders provider dropdown, masked key input, master toggle, warning chip", async () => {
    mockGet.mockResolvedValue(makeSettings({ elevation_api_key: "••••••" }));
    render(<SuperAdminSystemPage />);

    await waitFor(() => expect(screen.getByTestId("elevation-api-panel")).toBeTruthy());
    expect(screen.getByTestId("elevation-api-provider-select")).toBeTruthy();
    expect(screen.getByTestId("elevation-api-key-input")).toBeTruthy();
    expect(screen.getByTestId("elevation-api-fallback-checkbox")).toBeTruthy();
    expect(screen.getByTestId("elevation-api-warning")).toBeTruthy();
  });

  it("does not send the masked sentinel back when the key field is left untouched", async () => {
    mockGet.mockResolvedValue(makeSettings({ elevation_api_key: "••••••" }));
    mockUpdate.mockResolvedValue(makeSettings({ elevation_api_key: "••••••" }));
    render(<SuperAdminSystemPage />);

    await waitFor(() => expect(screen.getByTestId("elevation-api-panel")).toBeTruthy());

    fireEvent.click(screen.getByTestId("save-button"));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const sent = mockUpdate.mock.calls[0][0];
    expect(sent.elevation_api_key).toBeUndefined();
    expect(sent.elevation_api_provider).toBe("OPEN_ELEVATION");
  });

  it("disables provider + key controls when master toggle is off", async () => {
    mockGet.mockResolvedValue(makeSettings({ elevation_api_fallback_enabled: false }));
    render(<SuperAdminSystemPage />);

    await waitFor(() => expect(screen.getByTestId("elevation-api-panel")).toBeTruthy());

    const select = screen.getByTestId("elevation-api-provider-select") as HTMLSelectElement;
    const keyInput = screen.getByTestId("elevation-api-key-input") as HTMLInputElement;
    expect(select.disabled).toBe(true);
    expect(keyInput.disabled).toBe(true);
  });
});
