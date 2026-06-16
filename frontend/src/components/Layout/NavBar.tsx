import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import { useAirport } from "@/contexts/AirportContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useSystemSettings } from "@/contexts/SystemSettingsContext";
import AirportSelector from "@/components/common/AirportSelector";
import UserMenu from "./UserMenu";

export interface NavItem {
  label: string;
  to: string;
  disabled?: boolean;
}

interface NavBarProps {
  items: NavItem[];
  role: "operator" | "coordinator" | "admin";
  roleSwitchItems?: NavItem[];
}

const EMPTY_NAV_ITEMS: NavItem[] = [];

/** top nav bar with role-aware pills, airport selector, theme toggle, and user menu. */
export default function NavBar({ items, role, roleSwitchItems = EMPTY_NAV_ITEMS }: NavBarProps) {
  const { selectedAirport } = useAirport();
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();

  const { settings: systemSettings } = useSystemSettings();
  const maintenanceMode = role === "admin"
    ? (systemSettings?.maintenance_mode ?? false)
    : false;

  return (
    <nav
      className="flex items-center px-4 py-5 bg-tv-bg"
      data-testid="navbar"
    >
      {/* left section - 30% */}
      <div className="w-[30%] flex-shrink-0 flex">
        <div className="flex-1 overflow-hidden" style={{ scrollbarGutter: "stable" }}>
          <NavLink
            to={
              role === "admin"
                ? "/super-admin/users"
                : role === "operator"
                  ? "/operator-center/dashboard"
                  : "/coordinator-center/airports"
            }
            className="flex w-full items-center justify-center gap-2 rounded-full bg-tv-surface px-4 h-11"
          >
            <svg
              className="h-6 w-6 text-tv-accent"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            <span className="text-sm font-semibold text-tv-text-primary">
              {t(
                role === "admin"
                  ? "common.appTitleAdmin"
                  : role === "coordinator"
                    ? "common.appTitleCoordinator"
                    : "common.appTitle",
              )}
            </span>
          </NavLink>
        </div>
        <div className="w-6 flex-shrink-0" />
      </div>

      {/* right section - 70% */}
      <div className="flex-1 flex items-center gap-4 min-w-0">
        {/* nav pills - role-switch group rendered first, divided from in-role page nav */}
        <div
          className="flex flex-1 items-center justify-center gap-1 rounded-full bg-tv-surface p-1 h-11"
          data-testid="navbar-pills"
        >
          {roleSwitchItems.length > 0 && (
            <div className="flex items-center gap-1" data-testid="navbar-role-switch-group">
              {roleSwitchItems.map((item) => {
                const disabled = item.disabled;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={(e) => disabled && e.preventDefault()}
                    className={({ isActive }) =>
                      `px-5 h-9 rounded-full text-sm font-medium transition-colors flex items-center justify-center text-center ${
                        disabled
                          ? "opacity-50 cursor-not-allowed text-tv-text-muted"
                          : isActive
                            ? "bg-tv-nav-active-bg text-tv-nav-active-text"
                            : "text-tv-text-primary hover:bg-tv-surface-hover"
                      }`
                    }
                    data-testid={`navbar-role-switch-${item.to}`}
                  >
                    {item.label}
                  </NavLink>
                );
              })}
              <span
                aria-hidden="true"
                className="h-5 w-px bg-tv-border mx-1"
                data-testid="navbar-divider"
              />
            </div>
          )}
          {items.map((item) => {
            const disabled = item.disabled || (role === "operator" && !selectedAirport);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={(e) => disabled && e.preventDefault()}
                className={({ isActive }) =>
                  `px-5 h-9 rounded-full text-sm font-medium transition-colors flex items-center justify-center text-center ${
                    disabled
                      ? "opacity-50 cursor-not-allowed text-tv-text-muted"
                      : isActive
                        ? "bg-tv-nav-active-bg text-tv-nav-active-text"
                        : "text-tv-text-primary hover:bg-tv-surface-hover"
                  }`
                }
              >
                {item.label}
              </NavLink>
            );
          })}
        </div>

        {/* airport selector or system status */}
        {role === "admin" ? (
          <div
            className="flex items-center gap-2 rounded-full px-4 h-11"
            style={
              maintenanceMode
                ? { backgroundColor: "color-mix(in srgb, var(--tv-warning) 15%, transparent)" }
                : { backgroundColor: "var(--tv-surface)" }
            }
          >
            <span
              className="h-2 w-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: maintenanceMode ? "var(--tv-warning)" : "var(--tv-success)" }}
            />
            <span
              className="text-sm font-medium whitespace-nowrap"
              style={{ color: maintenanceMode ? "var(--tv-warning)" : "var(--tv-success)" }}
            >
              {maintenanceMode ? t("admin.maintenanceActive") : t("admin.systemOnline")}
            </span>
          </div>
        ) : (
          <AirportSelector />
        )}

        {/* theme toggle */}
        <div className="flex items-center gap-1 rounded-full bg-tv-surface p-1 h-11">
          <button
            type="button"
            onClick={() => theme !== "light" && toggleTheme()}
            className={`rounded-full p-2 transition-colors ${
              theme === "light"
                ? "bg-tv-nav-active-bg text-tv-nav-active-text"
                : "text-tv-text-secondary hover:bg-tv-surface-hover"
            }`}
            aria-label={t("user.lightMode")}
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => theme !== "dark" && toggleTheme()}
            className={`rounded-full p-2 transition-colors ${
              theme === "dark"
                ? "bg-tv-nav-active-bg text-tv-nav-active-text"
                : "text-tv-text-secondary hover:bg-tv-surface-hover"
            }`}
            aria-label={t("user.darkMode")}
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
          </button>
        </div>

        {/* user dropdown - w-[140px] matches mission tab timestamp */}
        <UserMenu role={role} />
      </div>
    </nav>
  );
}
