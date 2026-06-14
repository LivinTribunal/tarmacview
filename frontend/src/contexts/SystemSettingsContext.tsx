/**
 * SystemSettingsContext - shared cache of GET /admin/system-settings.
 *
 * fetch policy: on mount and whenever the auth state flips. there is no
 * background polling, so a super-admin toggle made from a different browser
 * session is not reflected here until the next mount / auth flip / explicit
 * refresh(). cross-user staleness is acceptable for the current scope (the
 * UI affected is a coordinator default radio + an admin-only Settings page,
 * neither is safety-critical and both re-fetch on navigation).
 *
 * the super-admin Settings page calls refresh() after a successful PUT so
 * the admin who flipped the toggle sees their own change immediately.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { getSystemSettings } from "@/api/admin";
import { useAuth } from "@/contexts/AuthContext";
import type { SystemSettingsResponse } from "@/types/admin";

interface SystemSettingsContextValue {
  settings: SystemSettingsResponse | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const SystemSettingsContext = createContext<SystemSettingsContextValue | null>(
  null,
);

/** provider that lazily fetches /admin/system-settings, shared across consumers. */
export function SystemSettingsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [settings, setSettings] = useState<SystemSettingsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setSettings(null);
      return;
    }
    setLoading(true);
    try {
      const data = await getSystemSettings();
      setSettings(data);
    } catch {
      // backend may 403 for non-privileged users; keep previous value
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SystemSettingsContextValue>(
    () => ({ settings, loading, refresh }),
    [settings, loading, refresh],
  );

  return (
    <SystemSettingsContext.Provider value={value}>
      {children}
    </SystemSettingsContext.Provider>
  );
}

/** read the system-settings context - must be used within SystemSettingsProvider. */
export function useSystemSettings(): SystemSettingsContextValue {
  const ctx = useContext(SystemSettingsContext);
  if (!ctx) {
    throw new Error(
      "useSystemSettings must be used within SystemSettingsProvider",
    );
  }
  return ctx;
}
