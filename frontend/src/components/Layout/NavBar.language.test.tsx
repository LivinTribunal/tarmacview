import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import NavBar from "./NavBar";

// shared mock state - lets tests inspect changeLanguage calls and flip the active language
const i18nState = {
  language: "en",
  resolvedLanguage: "en",
  changeLanguage: vi.fn((lang: string) => {
    i18nState.language = lang;
    i18nState.resolvedLanguage = lang;
    return Promise.resolve();
  }),
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: i18nState,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

// override the global @/i18n mock from setupTests.ts (which exports {})
vi.mock("@/i18n", () => ({
  SUPPORTED_LANGUAGES: [
    { code: "en", label: "English", short: "EN" },
    { code: "sk", label: "Slovenčina", short: "SK" },
  ] as const,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { name: "Test User", role: "OPERATOR" },
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

describe("NavBar language switcher", () => {
  /** test suite for the EN/SK language pill switcher inside the user dropdown. */
  beforeEach(() => {
    i18nState.language = "en";
    i18nState.resolvedLanguage = "en";
    i18nState.changeLanguage.mockClear();
  });

  function renderAndOpenMenu() {
    /** render the navbar and open the user dropdown so the switcher is visible. */
    render(
      <MemoryRouter initialEntries={["/operator-center/dashboard"]}>
        <NavBar
          items={[{ label: "Dashboard", to: "/operator-center/dashboard" }]}
          role="operator"
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("user-menu-button"));
  }

  it("renders both EN and SK pills with the active language pressed", () => {
    /** both pills render; the EN pill is aria-pressed when language is en. */
    renderAndOpenMenu();
    const en = screen.getByTestId("language-switcher-en");
    const sk = screen.getByTestId("language-switcher-sk");
    expect(en).toBeInTheDocument();
    expect(sk).toBeInTheDocument();
    expect(en).toHaveAttribute("aria-pressed", "true");
    expect(sk).toHaveAttribute("aria-pressed", "false");
  });

  it("calls i18n.changeLanguage('sk') when the SK pill is clicked", () => {
    /** clicking the inactive pill fires changeLanguage with the right code. */
    renderAndOpenMenu();
    fireEvent.click(screen.getByTestId("language-switcher-sk"));
    expect(i18nState.changeLanguage).toHaveBeenCalledTimes(1);
    expect(i18nState.changeLanguage).toHaveBeenCalledWith("sk");
  });

  it("does not call changeLanguage when the active pill is clicked", () => {
    /** clicking the already-active pill is a no-op - prevents redundant work. */
    renderAndOpenMenu();
    fireEvent.click(screen.getByTestId("language-switcher-en"));
    expect(i18nState.changeLanguage).not.toHaveBeenCalled();
  });
});
