import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import NavBar from "./NavBar";
import type { NavItem } from "./NavBar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { name: "Test User", role: "SUPER_ADMIN" },
    logout: vi.fn(),
  }),
}));

vi.mock("@/contexts/AirportContext", () => ({
  useAirport: () => ({ selectedAirport: { id: "a-1", name: "BTS" } }),
}));

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));

vi.mock("@/contexts/SystemSettingsContext", () => ({
  useSystemSettings: () => ({
    settings: {
      maintenance_mode: false,
      cesium_ion_token: "",
      elevation_api_url: "",
      elevation_api_fallback_enabled: false,
    },
    loading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/components/common/AirportSelector", () => ({
  default: () => <div data-testid="airport-selector" />,
}));

vi.mock("@/api/admin", () => ({
  getSystemSettings: vi.fn().mockResolvedValue({ maintenance_mode: false }),
}));

describe("NavBar role-switch group", () => {
  /** test suite for the role-switch group + divider. */
  function renderNav(props: { roleSwitchItems?: NavItem[]; items: NavItem[]; role: "operator" | "coordinator" | "admin" }) {
    return render(
      <MemoryRouter initialEntries={["/coordinator-center/airports"]}>
        <NavBar {...props} />
      </MemoryRouter>,
    );
  }

  it("renders role-switch items in a separate group with a divider", () => {
    /** verify role-switch links sit in their own group and a divider is rendered. */
    renderNav({
      roleSwitchItems: [
        { label: "Mission Center", to: "/operator-center/dashboard" },
      ],
      items: [
        { label: "Airports", to: "/coordinator-center/airports" },
        { label: "Drones", to: "/coordinator-center/drones" },
      ],
      role: "coordinator",
    });
    expect(screen.getByTestId("navbar-role-switch-group")).toBeInTheDocument();
    expect(screen.getByTestId("navbar-divider")).toBeInTheDocument();
    expect(
      screen.getByTestId("navbar-role-switch-/operator-center/dashboard"),
    ).toBeInTheDocument();
  });

  it("renders role-switch links with the same primary text style as in-role items", () => {
    /** role-switch links share text-tv-text-primary with regular nav items - no role accent. */
    renderNav({
      roleSwitchItems: [
        { label: "Mission Center", to: "/operator-center/dashboard" },
        { label: "Configurator Center", to: "/coordinator-center/airports" },
      ],
      items: [{ label: "Users", to: "/super-admin/users" }],
      role: "admin",
    });
    const mission = screen.getByTestId("navbar-role-switch-/operator-center/dashboard");
    const configurator = screen.getByTestId("navbar-role-switch-/coordinator-center/airports");
    // inactive role-switch link uses text-tv-text-primary; active link uses bg-tv-nav-active
    expect(mission.className).toMatch(/text-tv-text-primary|bg-tv-nav-active/);
    expect(configurator.className).toMatch(/text-tv-text-primary|bg-tv-nav-active/);
    // and definitely no accent classes
    expect(mission.className).not.toMatch(/text-tv-(success|warning|error)/);
    expect(configurator.className).not.toMatch(/text-tv-(success|warning|error)/);
  });

  it("does not render a role-switch group when no items are passed", () => {
    /** verify the divider + group are absent when roleSwitchItems is empty. */
    renderNav({
      items: [{ label: "Dashboard", to: "/operator-center/dashboard" }],
      role: "operator",
    });
    expect(screen.queryByTestId("navbar-role-switch-group")).not.toBeInTheDocument();
    expect(screen.queryByTestId("navbar-divider")).not.toBeInTheDocument();
  });
});

describe("NavBar pill label layout", () => {
  /** test suite for single-line, centered pills and graceful narrow-width degradation. */
  function renderNav(props: { roleSwitchItems?: NavItem[]; items: NavItem[]; role: "operator" | "coordinator" | "admin" }) {
    return render(
      <MemoryRouter initialEntries={["/coordinator-center/airports"]}>
        <NavBar {...props} />
      </MemoryRouter>,
    );
  }

  it("keeps multi-word role-switch labels on one centered line", () => {
    /** role-switch pills get whitespace-nowrap + centering so labels never wrap left-aligned. */
    renderNav({
      roleSwitchItems: [{ label: "Mission Center", to: "/operator-center/dashboard" }],
      items: [{ label: "Airports", to: "/coordinator-center/airports" }],
      role: "admin",
    });
    const mission = screen.getByTestId("navbar-role-switch-/operator-center/dashboard");
    expect(mission.className).toMatch(/whitespace-nowrap/);
    expect(mission.className).toMatch(/justify-center/);
    expect(mission.className).toMatch(/text-center/);
    expect(mission.className).toMatch(/flex-shrink-0/);
  });

  it("keeps multi-word in-role labels on one centered line", () => {
    /** in-role pills share the same single-line, centered, non-shrinking styling. */
    renderNav({
      items: [{ label: "Audit Log", to: "/super-admin/audit" }],
      role: "admin",
    });
    const audit = screen.getByText("Audit Log");
    expect(audit.className).toMatch(/whitespace-nowrap/);
    expect(audit.className).toMatch(/justify-center/);
    expect(audit.className).toMatch(/text-center/);
    expect(audit.className).toMatch(/flex-shrink-0/);
  });

  it("lets the pills bar scroll horizontally when space is tight", () => {
    /** the navbar-pills container degrades to horizontal scroll instead of squeezing pills. */
    renderNav({
      items: [{ label: "Airports", to: "/coordinator-center/airports" }],
      role: "admin",
    });
    const pills = screen.getByTestId("navbar-pills");
    expect(pills.className).toMatch(/overflow-x-auto/);
    expect(pills.className).toMatch(/min-w-0/);
  });

  it("does not regress the active-pill highlight", () => {
    /** the active in-role pill keeps its active background/text tokens. */
    renderNav({
      items: [{ label: "Airports", to: "/coordinator-center/airports" }],
      role: "admin",
    });
    const active = screen.getByText("Airports");
    expect(active.className).toMatch(/bg-tv-nav-active-bg/);
    expect(active.className).toMatch(/text-tv-nav-active-text/);
  });

  it("does not regress the disabled-pill state", () => {
    /** a disabled in-role pill keeps opacity-50 + cursor-not-allowed. */
    renderNav({
      items: [{ label: "Drones", to: "/coordinator-center/drones", disabled: true }],
      role: "admin",
    });
    const disabled = screen.getByText("Drones");
    expect(disabled.className).toMatch(/opacity-50/);
    expect(disabled.className).toMatch(/cursor-not-allowed/);
  });
});
