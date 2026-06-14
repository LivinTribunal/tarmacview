import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { AuditLogEntry, UserAdminResponse } from "@/types/admin";
import SuperAdminUserDetail from "./SuperAdminUserDetail";

// pinned mid-day local time so day-boundary math is deterministic
const NOW = new Date(2026, 5, 12, 12, 0, 0);

const USER: UserAdminResponse = {
  id: "u-1",
  email: "alpha@example.com",
  name: "Alpha",
  role: "OPERATOR",
  is_active: true,
  airports: [],
  last_login: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function makeLog(
  overrides: Partial<AuditLogEntry> & Pick<AuditLogEntry, "id" | "timestamp">,
): AuditLogEntry {
  return {
    user_id: "u-1",
    user_email: "alpha@example.com",
    action: "CREATE",
    entity_type: "Mission",
    entity_id: "m-1",
    entity_name: "Some Mission",
    airport_id: null,
    details: null,
    ip_address: null,
    ...overrides,
  };
}

function renderDetail(userLogs: AuditLogEntry[]) {
  return render(
    <MemoryRouter>
      <SuperAdminUserDetail
        user={USER}
        allAirports={[]}
        userLogs={userLogs}
        editName="Alpha"
        editEmail="alpha@example.com"
        editRole="OPERATOR"
        saving={false}
        resetLink=""
        onEditNameChange={vi.fn()}
        onEditEmailChange={vi.fn()}
        onEditRoleChange={vi.fn()}
        onBack={vi.fn()}
        onSave={vi.fn()}
        onResetPassword={vi.fn()}
        onRemoveAirport={vi.fn()}
        onAddAirport={vi.fn()}
        onConfirmAction={vi.fn()}
      />
    </MemoryRouter>,
  );
}

function minutesBefore(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

describe("SuperAdminUserDetail", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("entityLink", () => {
    it("maps each known entity type to its detail route", () => {
      renderDetail([
        makeLog({
          id: "log-1",
          timestamp: minutesBefore(1),
          entity_type: "User",
          entity_id: "u-9",
          entity_name: "User Nine",
        }),
        makeLog({
          id: "log-2",
          timestamp: minutesBefore(2),
          entity_type: "Airport",
          entity_id: "apt-9",
          entity_name: "Airport Nine",
        }),
        makeLog({
          id: "log-3",
          timestamp: minutesBefore(3),
          entity_type: "Mission",
          entity_id: "m-9",
          entity_name: "Mission Nine",
        }),
      ]);

      const hrefs = screen
        .getAllByTestId("activity-entity-link")
        .map((el) => el.getAttribute("href"));
      expect(hrefs).toEqual([
        "/super-admin/users/u-9",
        "/super-admin/airports/apt-9",
        "/operator-center/missions/m-9/overview",
      ]);
    });

    it("renders plain text for unknown entity types and null entity ids", () => {
      renderDetail([
        makeLog({
          id: "log-1",
          timestamp: minutesBefore(1),
          entity_type: "DroneProfile",
          entity_id: "dp-1",
          entity_name: "Drone X",
        }),
        makeLog({
          id: "log-2",
          timestamp: minutesBefore(2),
          entity_type: "User",
          entity_id: null,
          entity_name: "Ghost User",
        }),
      ]);

      expect(screen.queryAllByTestId("activity-entity-link")).toHaveLength(0);
      expect(screen.getByText("Drone X")).toBeInTheDocument();
      expect(screen.getByText("Ghost User")).toBeInTheDocument();
    });
  });

  describe("day grouping", () => {
    it("labels groups today, yesterday, and older locale date at day boundaries", () => {
      renderDetail([
        // midnight today still counts as today
        makeLog({
          id: "log-1",
          timestamp: new Date(2026, 5, 12, 0, 0, 0).toISOString(),
        }),
        // one second before midnight is yesterday, not a rounding artifact
        makeLog({
          id: "log-2",
          timestamp: new Date(2026, 5, 11, 23, 59, 59).toISOString(),
        }),
        makeLog({
          id: "log-3",
          timestamp: new Date(2026, 5, 9, 15, 0, 0).toISOString(),
        }),
      ]);

      const labels = screen
        .getAllByTestId("activity-date-group")
        .map((el) => el.textContent);
      expect(labels).toEqual([
        "admin.today",
        "admin.yesterday",
        new Date(2026, 5, 9).toLocaleDateString(),
      ]);
    });

    it("merges consecutive same-day rows into a single group", () => {
      renderDetail([
        makeLog({
          id: "log-1",
          timestamp: new Date(2026, 5, 12, 10, 0, 0).toISOString(),
          entity_name: "First Mission",
        }),
        makeLog({
          id: "log-2",
          timestamp: new Date(2026, 5, 12, 9, 0, 0).toISOString(),
          entity_name: "Second Mission",
        }),
      ]);

      expect(screen.getAllByTestId("activity-date-group")).toHaveLength(1);
      expect(screen.getByText("First Mission")).toBeInTheDocument();
      expect(screen.getByText("Second Mission")).toBeInTheDocument();
    });

    it("buckets future timestamps as today and clamps relative time to just now", () => {
      renderDetail([
        makeLog({
          id: "log-1",
          timestamp: new Date(2026, 5, 13, 8, 0, 0).toISOString(),
        }),
      ]);

      expect(screen.getByTestId("activity-date-group")).toHaveTextContent(
        "admin.today",
      );
      expect(screen.getByText("common.justNow")).toBeInTheDocument();
    });
  });

  describe("relative timestamps", () => {
    it("switches buckets at the 30s, 60m, and 24h boundaries", () => {
      renderDetail([
        // 29s rounds to 0 minutes -> just now; 30s rounds to 1 minute
        makeLog({ id: "log-1", timestamp: minutesBefore(29 / 60) }),
        makeLog({ id: "log-2", timestamp: minutesBefore(30 / 60) }),
        // 59m stays in minutes; 60m becomes 1 hour
        makeLog({ id: "log-3", timestamp: minutesBefore(59) }),
        makeLog({ id: "log-4", timestamp: minutesBefore(60) }),
        // 23h stays in hours; 24h becomes 1 day
        makeLog({ id: "log-5", timestamp: minutesBefore(23 * 60) }),
        makeLog({ id: "log-6", timestamp: minutesBefore(24 * 60) }),
        makeLog({ id: "log-7", timestamp: minutesBefore(3 * 24 * 60) }),
      ]);

      expect(screen.getAllByText("common.justNow")).toHaveLength(1);
      expect(screen.getAllByText("admin.relative.minutesAgo")).toHaveLength(2);
      expect(screen.getAllByText("admin.relative.hoursAgo")).toHaveLength(2);
      expect(screen.getAllByText("admin.relative.daysAgo")).toHaveLength(2);
    });
  });
});
