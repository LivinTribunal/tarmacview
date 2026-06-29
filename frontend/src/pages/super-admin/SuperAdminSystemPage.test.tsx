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
const mockListBackups = vi.fn();
const mockTriggerBackup = vi.fn();
vi.mock("@/api/admin", () => ({
  getSystemSettings: (...args: unknown[]) => mockGet(...args),
  updateSystemSettings: (...args: unknown[]) => mockUpdate(...args),
  listBackups: (...args: unknown[]) => mockListBackups(...args),
  triggerBackup: (...args: unknown[]) => mockTriggerBackup(...args),
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
    backup_enabled: false,
    backup_interval_hours: 24,
    backup_retention_count: 3,
    last_backup_at: null,
    last_backup_status: null,
    ...overrides,
  };
}

describe("SuperAdminSystemPage - remote elevation panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListBackups.mockResolvedValue({
      backups: [],
      last_backup_at: null,
      last_backup_status: null,
    });
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

describe("SuperAdminSystemPage - backups panel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListBackups.mockResolvedValue({
      backups: [],
      last_backup_at: null,
      last_backup_status: null,
    });
  });

  it("renders the backup section with toggle, interval, retention, and empty state", async () => {
    mockGet.mockResolvedValue(makeSettings());
    render(<SuperAdminSystemPage />);

    await waitFor(() => expect(screen.getByTestId("backup-panel")).toBeTruthy());
    expect(screen.getByTestId("backup-enabled-toggle")).toBeTruthy();
    expect(screen.getByTestId("backup-interval-input")).toBeTruthy();
    expect(screen.getByTestId("backup-retention-input")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("backup-list-empty")).toBeTruthy());
  });

  it("renders recent backups when present", async () => {
    mockGet.mockResolvedValue(makeSettings());
    mockListBackups.mockResolvedValue({
      backups: [
        { key: "tarmacview-20260621-000000.dump", size: 1024, last_modified: "2026-06-21T00:00:00Z" },
      ],
      last_backup_at: "2026-06-21T00:00:00Z",
      last_backup_status: "success",
    });
    render(<SuperAdminSystemPage />);

    await waitFor(() => expect(screen.getByTestId("backup-list")).toBeTruthy());
    expect(screen.getByText("tarmacview-20260621-000000.dump")).toBeTruthy();
  });

  it("save sends the backup fields", async () => {
    mockGet.mockResolvedValue(makeSettings());
    mockUpdate.mockResolvedValue(makeSettings({ backup_enabled: true }));
    render(<SuperAdminSystemPage />);

    await waitFor(() => expect(screen.getByTestId("backup-panel")).toBeTruthy());

    fireEvent.click(screen.getByTestId("backup-enabled-toggle"));
    fireEvent.change(screen.getByTestId("backup-interval-input"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByTestId("backup-retention-input"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByTestId("save-button"));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const sent = mockUpdate.mock.calls[0][0];
    expect(sent.backup_enabled).toBe(true);
    expect(sent.backup_interval_hours).toBe(12);
    expect(sent.backup_retention_count).toBe(5);
  });

  it("back up now triggers a backup and refreshes the list", async () => {
    mockGet.mockResolvedValue(makeSettings());
    mockTriggerBackup.mockResolvedValue({ status: "queued" });
    render(<SuperAdminSystemPage />);

    await waitFor(() => expect(screen.getByTestId("trigger-backup-button")).toBeTruthy());
    // one initial load on mount
    expect(mockListBackups).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("trigger-backup-button"));

    await waitFor(() => expect(mockTriggerBackup).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockListBackups).toHaveBeenCalledTimes(2));
  });
});
