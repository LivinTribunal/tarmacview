import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { SUPPORTED_LANGUAGES } from "@/i18n";
import UserSettingsDialog from "./UserSettingsDialog";

interface UserMenuProps {
  role: "operator" | "coordinator" | "admin";
}

/** user dropdown - settings, language switcher, role navigation, and logout. */
export default function UserMenu({ role }: UserMenuProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeLang = (i18n.resolvedLanguage ?? i18n.language ?? "en")
    .split("-")[0]
    .toLowerCase();

  const hasCoordinatorRole =
    user?.role === "COORDINATOR" || user?.role === "SUPER_ADMIN";

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div ref={menuRef} className="relative w-[140px]">
      <button
        type="button"
        onClick={() => setUserMenuOpen(!userMenuOpen)}
        className="flex items-center gap-2 rounded-full px-4 h-11 text-sm font-medium
          bg-tv-surface text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
        data-testid="user-menu-button"
      >
        {user?.name ?? t("user.defaultName")}
        <svg
          className={`h-4 w-4 transition-transform duration-200 ${userMenuOpen ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {userMenuOpen && (
        <div
          className="absolute right-0 top-full mt-1 min-w-[200px] rounded-2xl border
            border-tv-border bg-tv-surface p-2 z-50"
          data-testid="user-menu"
        >
          <button
            type="button"
            onClick={() => {
              setUserMenuOpen(false);
              setSettingsOpen(true);
            }}
            className="block w-full text-left rounded-xl px-4 py-2.5 text-sm
              text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
            data-testid="user-menu-settings"
          >
            {t("user.settings")}
          </button>

          {/* language switcher */}
          <div
            className="px-4 pt-2 pb-1 text-xs font-medium uppercase tracking-wider
              text-tv-text-muted"
            data-testid="language-switcher-label"
          >
            {t("user.language")}
          </div>
          <fieldset
            className="mx-2 mb-1 flex min-w-0 items-center gap-1 rounded-full bg-tv-bg p-1"
            aria-label={t("user.language")}
            data-testid="language-switcher"
          >
            {SUPPORTED_LANGUAGES.map((lang) => {
              const isActive = activeLang === lang.code;
              return (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => {
                    if (!isActive) i18n.changeLanguage(lang.code);
                  }}
                  aria-pressed={isActive}
                  title={lang.label}
                  className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold
                    transition-colors ${
                      isActive
                        ? "bg-tv-nav-active-bg text-tv-nav-active-text"
                        : "text-tv-text-secondary hover:bg-tv-surface-hover"
                    }`}
                  data-testid={`language-switcher-${lang.code}`}
                >
                  {lang.short}
                </button>
              );
            })}
          </fieldset>
          <hr className="my-1 border-tv-border" />

          {role === "operator" && hasCoordinatorRole && (
            <button
              type="button"
              onClick={() => {
                setUserMenuOpen(false);
                navigate("/coordinator-center/airports");
              }}
              className="block w-full text-left rounded-xl px-4 py-2.5 text-sm
                text-tv-warning hover:bg-tv-surface-hover transition-colors"
            >
              {t("nav.configuratorCenter")}
            </button>
          )}
          {role === "coordinator" && (
            <button
              type="button"
              onClick={() => {
                setUserMenuOpen(false);
                navigate("/operator-center/dashboard");
              }}
              className="block w-full text-left rounded-xl px-4 py-2.5 text-sm
                text-tv-success hover:bg-tv-surface-hover transition-colors"
            >
              {t("nav.missionCenter")}
            </button>
          )}
          {role !== "admin" && user?.role === "SUPER_ADMIN" && (
            <button
              type="button"
              onClick={() => {
                setUserMenuOpen(false);
                navigate("/super-admin/users");
              }}
              className="block w-full text-left rounded-xl px-4 py-2.5 text-sm
                text-tv-error hover:bg-tv-surface-hover transition-colors"
            >
              {t("nav.superAdmin")}
            </button>
          )}
          {role === "admin" && (
            <>
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(false);
                  navigate("/operator-center/dashboard");
                }}
                className="block w-full text-left rounded-xl px-4 py-2.5 text-sm
                  text-tv-success hover:bg-tv-surface-hover transition-colors"
              >
                {t("nav.missionCenter")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(false);
                  navigate("/coordinator-center/airports");
                }}
                className="block w-full text-left rounded-xl px-4 py-2.5 text-sm
                  text-tv-warning hover:bg-tv-surface-hover transition-colors"
              >
                {t("nav.configuratorCenter")}
              </button>
            </>
          )}

          <hr className="my-1 border-tv-border" />
          <button
            type="button"
            onClick={handleLogout}
            className="block w-full text-left rounded-xl px-4 py-2.5 text-sm
              text-tv-error hover:bg-tv-surface-hover transition-colors"
            data-testid="logout-button"
          >
            {t("auth.logout")}
          </button>
        </div>
      )}

      <UserSettingsDialog
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
