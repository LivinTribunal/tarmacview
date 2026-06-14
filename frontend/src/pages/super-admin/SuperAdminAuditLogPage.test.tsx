import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import SuperAdminAuditLogPage from "./SuperAdminAuditLogPage";

const stableT = (key: string, opts?: Record<string, unknown>) => {
  if (opts && typeof opts.name === "string") return `${key}:${opts.name}`;
  return key;
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT, i18n: { language: "en" } }),
}));

const mockListAuditLogs = vi.fn();
const mockExportAuditLog = vi.fn();
const mockListAirportsAdmin = vi.fn();

vi.mock("@/api/admin", () => ({
  listAuditLogs: (...args: unknown[]) => mockListAuditLogs(...args),
  exportAuditLog: (...args: unknown[]) => mockExportAuditLog(...args),
  listAirportsAdmin: (...args: unknown[]) => mockListAirportsAdmin(...args),
}));

const ENTRY_1 = {
  id: "log-1",
  timestamp: "2026-04-01T12:00:00Z",
  user_email: "alice@example.com",
  action: "LOGIN",
  entity_type: null,
  entity_name: null,
  entity_id: null,
  details: null,
  user_id: "u-1",
};

const ENTRY_2 = {
  id: "log-2",
  timestamp: "2026-04-02T12:00:00Z",
  user_email: "bob@example.com",
  action: "UPDATE",
  entity_type: "User",
  entity_name: "alice",
  entity_id: "u-1",
  details: { field: "role" },
  user_id: "u-2",
};

function renderPage(initialPath = "/super-admin/audit-log") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <SuperAdminAuditLogPage />
    </MemoryRouter>,
  );
}

describe("SuperAdminAuditLogPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAuditLogs.mockResolvedValue({
      data: [ENTRY_1, ENTRY_2],
      meta: { total: 2 },
    });
    mockListAirportsAdmin.mockResolvedValue({
      data: [
        {
          id: "apt-9",
          icao_code: "LZIB",
          name: "Bratislava",
          city: "Bratislava",
          country: "Slovakia",
          user_count: 0,
          coordinator_count: 0,
          mission_count: 0,
          drone_count: 0,
          terrain_source: "FLAT",
        },
      ],
    });
  });

  it("issues exactly one fetch on initial mount", async () => {
    /** initial render hits listAuditLogs a single time. */
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    });
    expect(mockListAuditLogs).toHaveBeenCalledTimes(1);
  });

  it("fires exactly one extra fetch per filter change", async () => {
    /** changing search, action, entity_type, and date range each triggers one refetch. */
    renderPage();
    await waitFor(() => expect(mockListAuditLogs).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByTestId("audit-log-search"), {
      target: { value: "alice" },
    });
    await waitFor(() => expect(mockListAuditLogs).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByTestId("action-pill-LOGIN"));
    await waitFor(() => expect(mockListAuditLogs).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByTestId("entity-type-pill-User"));
    await waitFor(() => expect(mockListAuditLogs).toHaveBeenCalledTimes(4));

    fireEvent.change(screen.getByTestId("date-from"), {
      target: { value: "2026-04-01" },
    });
    await waitFor(() => expect(mockListAuditLogs).toHaveBeenCalledTimes(5));

    expect(mockListAuditLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: "alice",
        action: "LOGIN",
        entity_type: "User",
        date_from: "2026-04-01",
      }),
    );
  });

  it("clicking the active action pill again clears it with one refetch", async () => {
    /** the inline action pills are single-select; clicking the same value toggles it off. */
    renderPage();
    await waitFor(() => expect(mockListAuditLogs).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId("action-pill-LOGIN"));
    await waitFor(() => expect(mockListAuditLogs).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByTestId("action-pill-LOGIN"));
    await waitFor(() => expect(mockListAuditLogs).toHaveBeenCalledTimes(3));
    expect(mockListAuditLogs).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ action: expect.anything() }),
    );
  });

  it("sort header click triggers exactly one refetch with new sort params", async () => {
    /** clicking a sortable header issues one fetch with updated sort_by/sort_dir. */
    renderPage();
    await waitFor(() => expect(mockListAuditLogs).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("admin.columns.user"));
    await waitFor(() => expect(mockListAuditLogs).toHaveBeenCalledTimes(2));
    expect(mockListAuditLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort_by: "user_email", sort_dir: "asc" }),
    );
  });

  it("dims non-selected color-identity pills once a filter is active", async () => {
    /** badgeStyle pills keep their colors and the unselected ones go opacity-40
        when at least one is active; the selected one stays at full opacity. */
    renderPage();
    await waitFor(() => expect(mockListAuditLogs).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("action-pill-LOGIN"));
    expect(screen.getByTestId("action-pill-LOGIN").className).not.toMatch(
      /\bopacity-40\b/,
    );
    expect(screen.getByTestId("action-pill-LOGOUT").className).toMatch(
      /\bopacity-40\b/,
    );
  });

  it("export button calls exportAuditLog with current date range", async () => {
    /** csv export reads the active date range from the filter spec. */
    mockExportAuditLog.mockResolvedValue(new Blob());
    // jsdom shim
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();

    renderPage();
    await waitFor(() => expect(mockListAuditLogs).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByTestId("date-from"), {
      target: { value: "2026-03-01" },
    });
    fireEvent.change(screen.getByTestId("date-to"), {
      target: { value: "2026-03-31" },
    });
    await waitFor(() => expect(mockListAuditLogs).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByTestId("export-button"));
    await waitFor(() =>
      expect(mockExportAuditLog).toHaveBeenCalledWith({
        date_from: "2026-03-01",
        date_to: "2026-03-31",
        airport_id: undefined,
      }),
    );

    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it("renders the airport scope chip when ?airport_id is present", async () => {
    /** ?airport_id=<uuid> populates a chip with the resolved airport name and forwards it to the api. */
    renderPage("/super-admin/audit-log?airport_id=apt-9");
    await waitFor(() => {
      expect(screen.getByTestId("airport-scope-chip")).toBeInTheDocument();
    });
    // chip resolves the airport name once listAirportsAdmin returns
    await waitFor(() => {
      expect(
        screen.getByTestId("airport-scope-chip").textContent,
      ).toContain("Bratislava");
    });
    // and the fetch carries the airport_id forward
    expect(mockListAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ airport_id: "apt-9" }),
    );
  });

  it("clearing the airport scope chip drops the param and refetches", async () => {
    /** clicking the X removes airport_id from the URL and the next fetch omits it. */
    renderPage("/super-admin/audit-log?airport_id=apt-9");
    await waitFor(() => {
      expect(screen.getByTestId("airport-scope-chip")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("airport-scope-clear"));

    await waitFor(() => {
      expect(screen.queryByTestId("airport-scope-chip")).not.toBeInTheDocument();
    });
    // last call no longer includes the airport_id
    expect(mockListAuditLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ airport_id: undefined }),
    );
  });
});
