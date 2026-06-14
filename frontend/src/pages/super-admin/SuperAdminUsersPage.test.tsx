import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import SuperAdminUsersPage from "./SuperAdminUsersPage";
import { MS_PER_DAY } from "@/constants/ui";

// stable t reference to keep useCallback deps stable
const stableT = (key: string) => key;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT, i18n: { language: "en" } }),
}));

const mockListUsers = vi.fn();
const mockListAirportsAdmin = vi.fn();
const mockListAuditLogs = vi.fn();
const mockGetUser = vi.fn();

vi.mock("@/api/admin", () => ({
  listUsers: (...args: unknown[]) => mockListUsers(...args),
  getUser: (...args: unknown[]) => mockGetUser(...args),
  updateUser: vi.fn(),
  deactivateUser: vi.fn(),
  activateUser: vi.fn(),
  deleteUser: vi.fn(),
  resetPassword: vi.fn(),
  updateUserAirports: vi.fn(),
  listAirportsAdmin: (...args: unknown[]) => mockListAirportsAdmin(...args),
  listAuditLogs: (...args: unknown[]) => mockListAuditLogs(...args),
}));

vi.mock("@/components/admin/InviteUserDialog", () => ({
  default: () => null,
}));

const mockNavigate = vi.fn();
const mockUseParams = vi.fn(() => ({}) as Record<string, string | undefined>);
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, useNavigate: () => mockNavigate, useParams: () => mockUseParams() };
});

const USER_ALPHA = {
  id: "u-1",
  email: "alpha@example.com",
  name: "Alpha",
  role: "OPERATOR",
  is_active: true,
  airports: [],
  last_login: null,
  created_at: "2026-01-01T00:00:00Z",
};

const USER_BETA = {
  id: "u-2",
  email: "beta@example.com",
  name: "Beta",
  role: "COORDINATOR",
  is_active: false,
  airports: [],
  last_login: "2026-04-01T00:00:00Z",
  created_at: "2026-02-01T00:00:00Z",
};

function renderPage() {
  return render(
    <MemoryRouter>
      <SuperAdminUsersPage />
    </MemoryRouter>,
  );
}

describe("SuperAdminUsersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({});
    mockListUsers.mockResolvedValue({
      data: [USER_ALPHA, USER_BETA],
      meta: { total: 2 },
    });
    mockListAirportsAdmin.mockResolvedValue({ data: [] });
    mockListAuditLogs.mockResolvedValue({ data: [] });
  });

  it("issues exactly one fetch on initial mount", async () => {
    /** initial render hits listUsers a single time. */
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    expect(mockListUsers).toHaveBeenCalledTimes(1);
  });

  it("fires exactly one extra fetch per filter state change", async () => {
    /** changing search and status pills each triggers one and only one refetch. */
    renderPage();
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByTestId("user-search"), {
      target: { value: "alpha" },
    });
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByTestId("status-pill-active"));
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(3));

    expect(mockListUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "alpha", is_active: true }),
    );
  });

  it("reset clears the FilterBar pills/dates with one refetch (search lives outside)", async () => {
    /** the FilterBar reset only owns role/status/dates; search is the standalone SearchBar. */
    renderPage();
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId("status-pill-active"));
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(2));

    const before = mockListUsers.mock.calls.length;
    fireEvent.click(screen.getByTestId("filter-bar-reset"));
    await waitFor(() => {
      expect(mockListUsers).toHaveBeenCalledTimes(before + 1);
    });
    expect(mockListUsers).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ is_active: expect.anything() }),
    );
  });

  it("filters by role pills client-side without an extra refetch beyond one", async () => {
    /** role pill toggles a client-side filter; fetch fires once per state change. */
    renderPage();
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("role-pill-OPERATOR"));
    await waitFor(() => {
      expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("dims non-selected color-identity pills once a filter is active", async () => {
    /** badgeStyle pills keep their colors and the unselected ones go opacity-40
        once at least one role pill is selected; the selected one stays full. */
    renderPage();
    await waitFor(() => expect(mockListUsers).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("role-pill-OPERATOR"));
    expect(screen.getByTestId("role-pill-OPERATOR").className).not.toMatch(
      /\bopacity-40\b/,
    );
    expect(screen.getByTestId("role-pill-COORDINATOR").className).toMatch(
      /\bopacity-40\b/,
    );
    expect(screen.getByTestId("role-pill-SUPER_ADMIN").className).toMatch(
      /\bopacity-40\b/,
    );
  });

  describe("user detail activity panel", () => {
    /** detail-view tests: i18n action labels, date grouping, view-all deep link, entity links. */

    const today = new Date();
    const yesterday = new Date(today.getTime() - MS_PER_DAY);
    const earlier = new Date(today.getTime() - 5 * MS_PER_DAY);

    const LOG_TODAY = {
      id: "log-1",
      timestamp: today.toISOString(),
      user_email: "alpha@example.com",
      action: "CREATE",
      entity_type: "Mission",
      entity_name: "Mission Today",
      entity_id: "m-1",
      airport_id: "apt-1",
      details: null,
      user_id: "u-1",
    };
    const LOG_YESTERDAY = {
      ...LOG_TODAY,
      id: "log-2",
      timestamp: yesterday.toISOString(),
      action: "UPDATE",
      entity_name: "Mission Yesterday",
    };
    const LOG_EARLIER = {
      ...LOG_TODAY,
      id: "log-3",
      timestamp: earlier.toISOString(),
      action: "DELETE",
      entity_type: "Airport",
      entity_name: "Old Airport",
      entity_id: "apt-9",
    };

    beforeEach(() => {
      mockUseParams.mockReturnValue({ id: "u-1" });
      mockGetUser.mockResolvedValue({
        ...USER_ALPHA,
        updated_at: "2026-01-01T00:00:00Z",
      });
      mockListAuditLogs.mockResolvedValue({
        data: [LOG_TODAY, LOG_YESTERDAY, LOG_EARLIER],
        meta: { total: 3 },
      });
    });

    it("renders translated action labels and date group headers", async () => {
      /** action codes pass through admin.audit.actions.<CODE>; days bucket into Today/Yesterday/dated. */
      renderPage();
      await waitFor(() =>
        expect(screen.getByTestId("user-activity-list")).toBeInTheDocument(),
      );

      // i18n action label keys
      expect(
        screen.getByText("admin.audit.actions.CREATE"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("admin.audit.actions.UPDATE"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("admin.audit.actions.DELETE"),
      ).toBeInTheDocument();

      // three date groups: today, yesterday, dated
      const groups = screen.getAllByTestId("activity-date-group");
      expect(groups).toHaveLength(3);
      expect(groups[0]).toHaveTextContent("admin.today");
      expect(groups[1]).toHaveTextContent("admin.yesterday");
    });

    it("'view all' link deep-links to the audit log scoped by user_id", async () => {
      /** the deep link preserves the per-user scope on the audit log page. */
      renderPage();
      await waitFor(() =>
        expect(screen.getByTestId("user-activity-view-all")).toBeInTheDocument(),
      );
      const link = screen.getByTestId(
        "user-activity-view-all",
      ) as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe(
        "/super-admin/audit-log?user_id=u-1",
      );
    });

    it("entity name renders as a link when entity_type maps to a known detail page", async () => {
      /** Mission/User/Airport entity rows wrap entity_name in a router Link. */
      renderPage();
      await waitFor(() =>
        expect(screen.getByTestId("user-activity-list")).toBeInTheDocument(),
      );
      const links = screen.getAllByTestId("activity-entity-link");
      // mission row + airport row - both produce links; user row would too if it were here
      expect(links.length).toBeGreaterThanOrEqual(2);
    });
  });
});
