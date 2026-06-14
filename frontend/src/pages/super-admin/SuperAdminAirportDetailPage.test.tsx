import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import SuperAdminAirportDetailPage from "./SuperAdminAirportDetailPage";

const stableT = (key: string, opts?: Record<string, unknown>) => {
  if (opts && typeof opts.defaultValue === "string") return opts.defaultValue;
  if (opts && typeof opts.name === "string") return `${key}:${opts.name}`;
  return key;
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT, i18n: { language: "en" } }),
}));

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>(
    "react-router",
  );
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockListAirportsAdmin = vi.fn();
const mockListAuditLogs = vi.fn();
const mockListUsers = vi.fn();
const mockUpdateUserAirports = vi.fn();
const mockGetAirport = vi.fn();
const mockSelectAirport = vi.fn();

vi.mock("@/api/admin", () => ({
  listAirportsAdmin: (...args: unknown[]) => mockListAirportsAdmin(...args),
  listAuditLogs: (...args: unknown[]) => mockListAuditLogs(...args),
  listUsers: (...args: unknown[]) => mockListUsers(...args),
  updateUserAirports: (...args: unknown[]) => mockUpdateUserAirports(...args),
}));

vi.mock("@/api/airports", () => ({
  getAirport: (...args: unknown[]) => mockGetAirport(...args),
}));

vi.mock("@/contexts/AirportContext", () => ({
  useAirport: () => ({ selectAirport: mockSelectAirport }),
}));

vi.mock("@/components/map/AirportMap", () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="airport-map">{children}</div>
  ),
}));

vi.mock("@/components/map/overlays/LegendPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="legend-panel" />,
}));

vi.mock("@/components/map/overlays/AirportInfoPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="airport-info-panel" />,
}));

vi.mock("@/components/map/overlays/TerrainToggle", () => ({
  __esModule: true,
  default: () => <div data-testid="terrain-toggle" />,
}));

const AIRPORT = {
  id: "apt-1",
  icao_code: "LZIB",
  name: "Bratislava",
  city: "Bratislava",
  country: "Slovakia",
  user_count: 2,
  coordinator_count: 1,
  operator_count: 1,
  mission_count: 5,
  drone_count: 1,
  terrain_source: "FLAT",
};

const AIRPORT_ORPHAN = { ...AIRPORT, coordinator_count: 0, operator_count: 0 };

const USER_ALICE = {
  id: "u-1",
  email: "alice@example.com",
  name: "Alice",
  role: "OPERATOR",
  is_active: true,
  airports: [{ id: "apt-1", icao_code: "LZIB", name: "Bratislava" }],
  last_login: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const ENTRY = {
  id: "log-1",
  timestamp: "2026-04-01T12:00:00Z",
  user_email: "alice@example.com",
  action: "CREATE",
  entity_type: "Mission",
  entity_name: "Mission Alpha",
  entity_id: "m-1",
  airport_id: "apt-1",
  details: null,
  user_id: "u-1",
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/super-admin/airports/apt-1"]}>
      <Routes>
        <Route
          path="/super-admin/airports/:id"
          element={<SuperAdminAirportDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const AIRPORT_DETAIL = {
  id: "apt-1",
  icao_code: "LZIB",
  name: "Bratislava",
  city: "Bratislava",
  country: "Slovakia",
  surfaces: [],
  obstacles: [],
  safety_zones: [],
};

describe("SuperAdminAirportDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAirportsAdmin.mockResolvedValue({ data: [AIRPORT] });
    mockListUsers.mockResolvedValue({ data: [USER_ALICE], meta: { total: 1 } });
    mockListAuditLogs.mockResolvedValue({ data: [ENTRY], meta: { total: 1 } });
    mockGetAirport.mockResolvedValue(AIRPORT_DETAIL);
  });

  it("renders airport overview, assigned users, and a 20-row activity panel", async () => {
    /** happy path: overview shows counts, assigned users are listed, activity rows render. */
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("admin-airport-detail-page")).toBeInTheDocument(),
    );
    // overview
    expect(screen.getByText("Bratislava")).toBeInTheDocument();
    expect(screen.getByText("LZIB")).toBeInTheDocument();
    // assigned users panel
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });
    // activity panel
    await waitFor(() => {
      expect(screen.getByTestId("airport-activity-panel")).toBeInTheDocument();
    });
    expect(screen.getByText(/Mission Alpha/)).toBeInTheDocument();

    // activity request was scoped to this airport with limit=20
    expect(mockListAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        airport_id: "apt-1",
        limit: 20,
      }),
    );
  });

  it("renders an orphaned warning when the airport has no coordinator", async () => {
    /** coordinator_count === 0 surfaces the prominent orphaned banner. */
    mockListAirportsAdmin.mockResolvedValue({ data: [AIRPORT_ORPHAN] });
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("orphaned-warning")).toBeInTheDocument();
    });
  });

  it("hides the orphaned warning when a coordinator is assigned", async () => {
    /** the banner only fires for orphaned airports, not assigned ones. */
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("admin-airport-detail-page")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("orphaned-warning")).not.toBeInTheDocument();
  });

  it("shows the empty state when no activity rows exist", async () => {
    /** activity panel falls back to the no-activity message when the response is empty. */
    mockListAuditLogs.mockResolvedValue({ data: [], meta: { total: 0 } });
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("airport-activity-panel")).toBeInTheDocument(),
    );
    expect(
      screen.getByText("admin.airportDetail.noActivity"),
    ).toBeInTheDocument();
  });

  it("'view all' link carries the airport_id query param", async () => {
    /** the deep-link to the audit log preserves the per-airport scope. */
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("view-all-link")).toBeInTheDocument();
    });
    const link = screen.getByTestId("view-all-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      "/super-admin/audit-log?airport_id=apt-1",
    );
  });

  it("renders the embedded airport map once airport detail loads", async () => {
    /** map is fetched via getAirport(id) and rendered in the centre column. */
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("airport-map")).toBeInTheDocument();
    });
    expect(mockGetAirport).toHaveBeenCalledWith("apt-1");
  });

  it("places quick actions below the recent activity panel", async () => {
    /** quick-actions card lives in the right column under the activity panel. */
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("airport-quick-actions")).toBeInTheDocument();
    });
    const activity = screen.getByTestId("airport-activity-panel");
    const quickActions = screen.getByTestId("airport-quick-actions");
    expect(activity.parentElement).toBe(quickActions.parentElement);
    // sibling order: activity comes before quick actions
    expect(
      activity.compareDocumentPosition(quickActions) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("'open in coordinator center' selects airport and navigates to the detail url", async () => {
    /** clicking the renamed button pre-selects the airport in context, then navigates. */
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("open-coordinator-center-button")).toBeInTheDocument();
    });
    // wait for airportDetail to load so the button is enabled
    await waitFor(() => {
      expect(
        screen.getByTestId("open-coordinator-center-button"),
      ).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId("open-coordinator-center-button"));
    expect(mockSelectAirport).toHaveBeenCalledWith(AIRPORT_DETAIL);
    expect(mockNavigate).toHaveBeenCalledWith("/coordinator-center/airports/apt-1");
  });

  it("'bulk-change drone' carries the action query param", async () => {
    /** bulk-change deep-link routes through the same coordinator-center selection path. */
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("bulk-change-drone-button")).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId("bulk-change-drone-button"));
    expect(mockSelectAirport).toHaveBeenCalledWith(AIRPORT_DETAIL);
    expect(mockNavigate).toHaveBeenCalledWith(
      "/coordinator-center/airports/apt-1?action=bulk-change-drone",
    );
  });
});
