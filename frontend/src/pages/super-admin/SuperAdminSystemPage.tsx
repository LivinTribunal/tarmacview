import { useState, useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import { Save, Loader2, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import Button from "@/components/common/Button";
import {
  ListPageContainer,
  ListPageContent,
} from "@/components/common/ListPageLayout";
import type {
  ElevationApiProvider,
  SystemSettingsResponse,
  SystemSettingsUpdate,
} from "@/types/admin";
import { ELEVATION_API_KEY_MASK } from "@/types/admin";
import { getSystemSettings, updateSystemSettings } from "@/api/admin";
import { useSystemSettings } from "@/contexts/SystemSettingsContext";

/** super-admin system settings page: maintenance mode, api keys, elevation provider. */
export default function SuperAdminSystemPage() {
  const { t } = useTranslation();
  const { refresh: refreshSystemSettings } = useSystemSettings();
  const cesiumTokenId = useId();
  const elevationUrlId = useId();

  const [settings, setSettings] = useState<SystemSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<"success" | "failed" | null>(null);
  // separate input state so the inbound mask sentinel is never re-sent
  // verbatim on save (which would noop) but is shown to the operator.
  const [apiKeyInput, setApiKeyInput] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const data = await getSystemSettings();
        setSettings(data);
      } catch {
        setError(t("superAdmin.errors.systemSettingsLoadFailed"));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const update: SystemSettingsUpdate = {
        maintenance_mode: settings.maintenance_mode,
        cesium_ion_token: settings.cesium_ion_token,
        elevation_api_url: settings.elevation_api_url,
        elevation_api_fallback_enabled: settings.elevation_api_fallback_enabled,
        elevation_api_provider: settings.elevation_api_provider,
      };
      // only send the api key field when the operator actually typed something.
      // empty input + a persisted key means "keep existing" - omit the field
      // so the server-side noop sentinel logic does not run on every save.
      const trimmed = apiKeyInput.trim();
      if (trimmed.length > 0) {
        update.elevation_api_key = trimmed === "clear" ? "" : trimmed;
      }
      const updated = await updateSystemSettings(update);
      setSettings(updated);
      setApiKeyInput("");
      // keep the shared context in sync so the admin sees their own toggle
      // immediately on any other page that reads useSystemSettings()
      await refreshSystemSettings();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError(t("superAdmin.errors.systemSettingsSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    if (!settings?.elevation_api_url) return;
    setTestResult(null);
    try {
      const res = await fetch(settings.elevation_api_url, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      setTestResult(res.ok ? "success" : "failed");
    } catch {
      setTestResult("failed");
    }
  }

  if (loading) {
    return (
      <ListPageContainer>
        <p className="text-center text-tv-text-muted py-8">{t("common.loading")}</p>
      </ListPageContainer>
    );
  }

  if (!settings) {
    return (
      <ListPageContainer>
        <p className="text-center text-tv-text-muted py-8">{t("common.error")}</p>
      </ListPageContainer>
    );
  }

  return (
    <ListPageContainer data-testid="admin-system-page">
      <ListPageContent className="space-y-8">
        {/* maintenance mode */}
        <section className="rounded-lg border border-tv-border bg-tv-surface p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-tv-text-primary">
                {t("admin.maintenanceMode")}
              </h2>
              <p className="text-sm text-tv-text-secondary mt-1">
                {t("admin.maintenanceDescription")}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.maintenance_mode}
              aria-label={t("admin.maintenanceMode")}
              onClick={() =>
                setSettings({ ...settings, maintenance_mode: !settings.maintenance_mode })
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.maintenance_mode ? "bg-tv-accent" : "bg-tv-surface-hover"
              }`}
              data-testid="maintenance-toggle"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.maintenance_mode ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
          {settings.maintenance_mode && (
            <div className="mt-3 rounded-md bg-[var(--tv-warning)]/10 px-3 py-2 text-sm text-[var(--tv-warning)]">
              {t("admin.maintenanceActive")}
            </div>
          )}
        </section>

        {/* api keys */}
        <section className="rounded-lg border border-tv-border bg-tv-surface p-6 space-y-4">
          <h2 className="text-lg font-semibold text-tv-text-primary">
            {t("admin.apiKeys")}
          </h2>

          <div>
            <label
              htmlFor={cesiumTokenId}
              className="block text-sm font-medium text-tv-text-secondary mb-1"
            >
              {t("admin.cesiumToken")}
            </label>
            <input
              id={cesiumTokenId}
              type="text"
              value={settings.cesium_ion_token}
              onChange={(e) =>
                setSettings({ ...settings, cesium_ion_token: e.target.value })
              }
              className="w-full rounded-lg border border-tv-border bg-tv-bg px-3 py-2 text-sm text-tv-text-primary focus:outline-none focus:border-tv-accent"
              data-testid="cesium-token-input"
            />
          </div>

          <div>
            <label
              htmlFor={elevationUrlId}
              className="block text-sm font-medium text-tv-text-secondary mb-1"
            >
              {t("admin.elevationApiUrl")}
            </label>
            <div className="flex gap-2">
              <input
                id={elevationUrlId}
                type="text"
                value={settings.elevation_api_url}
                onChange={(e) =>
                  setSettings({ ...settings, elevation_api_url: e.target.value })
                }
                className="flex-1 rounded-lg border border-tv-border bg-tv-bg px-3 py-2 text-sm text-tv-text-primary focus:outline-none focus:border-tv-accent"
                data-testid="elevation-url-input"
              />
              <button
                type="button"
                onClick={handleTestConnection}
                className="rounded-lg border border-tv-border px-3 py-2 text-sm text-tv-text-secondary hover:text-tv-text-primary hover:border-tv-accent transition-colors"
                data-testid="test-connection-button"
              >
                {t("admin.testConnection")}
              </button>
            </div>
            {testResult && (
              <div
                className={`flex items-center gap-1 mt-2 text-sm ${
                  testResult === "success"
                    ? "text-[var(--tv-success)]"
                    : "text-[var(--tv-error)]"
                }`}
                data-testid="connection-result"
              >
                {testResult === "success" ? (
                  <CheckCircle className="w-4 h-4" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
                {testResult === "success"
                  ? t("admin.connectionSuccess")
                  : t("admin.connectionFailed")}
              </div>
            )}
          </div>

        </section>

        {/* remote elevation provider strategy */}
        <section
          className="rounded-lg border border-tv-border bg-tv-surface p-6 space-y-4"
          data-testid="elevation-api-panel"
        >
          <h2 className="text-lg font-semibold text-tv-text-primary">
            {t("admin.elevationApi.panelTitle")}
          </h2>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.elevation_api_fallback_enabled}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  elevation_api_fallback_enabled: e.target.checked,
                })
              }
              className="mt-0.5 accent-tv-accent"
              data-testid="elevation-api-fallback-checkbox"
            />
            <div>
              <p className="text-sm font-medium text-tv-text-primary">
                {t("admin.elevationApiFallback.label")}
              </p>
              <p className="text-xs text-tv-text-secondary mt-0.5">
                {t("admin.elevationApiFallback.help")}
              </p>
            </div>
          </label>

          <div>
            <label
              htmlFor="elevation-api-provider"
              className="block text-sm font-medium text-tv-text-secondary mb-1"
            >
              {t("admin.elevationApi.providerLabel")}
            </label>
            <select
              id="elevation-api-provider"
              value={settings.elevation_api_provider}
              disabled={!settings.elevation_api_fallback_enabled}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  elevation_api_provider: e.target.value as ElevationApiProvider,
                })
              }
              className="w-full rounded-lg border border-tv-border bg-tv-bg px-3 py-2 text-sm text-tv-text-primary focus:outline-none focus:border-tv-accent disabled:opacity-50"
              data-testid="elevation-api-provider-select"
            >
              <option value="OPEN_ELEVATION">
                {t("admin.elevationApi.providerOption.openElevation")}
              </option>
            </select>
            <p className="text-xs text-tv-text-secondary mt-1">
              {t("admin.elevationApi.providerHelp")}
            </p>
          </div>

          <div>
            <label
              htmlFor="elevation-api-key"
              className="block text-sm font-medium text-tv-text-secondary mb-1"
            >
              {t("admin.elevationApi.apiKeyLabel")}
            </label>
            <input
              id="elevation-api-key"
              type="password"
              autoComplete="off"
              value={apiKeyInput}
              placeholder={
                settings.elevation_api_key === ELEVATION_API_KEY_MASK
                  ? ELEVATION_API_KEY_MASK
                  : t("admin.elevationApi.apiKeyPlaceholder")
              }
              disabled={!settings.elevation_api_fallback_enabled}
              onChange={(e) => setApiKeyInput(e.target.value)}
              className="w-full rounded-lg border border-tv-border bg-tv-bg px-3 py-2 text-sm text-tv-text-primary focus:outline-none focus:border-tv-accent disabled:opacity-50"
              data-testid="elevation-api-key-input"
            />
            <p className="text-xs text-tv-text-secondary mt-1">
              {t("admin.elevationApi.apiKeyHelp")}
            </p>
            <p className="text-xs text-tv-text-muted mt-0.5">
              {t("admin.elevationApi.apiKeyClearHint")}
            </p>
          </div>

          <div
            className="flex items-start gap-2 rounded-md bg-[var(--tv-warning)]/10 px-3 py-2 text-sm text-[var(--tv-warning)]"
            data-testid="elevation-api-warning"
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{t("admin.elevationApi.warning")}</span>
          </div>
        </section>

        {error && (
          <p className="text-center text-[var(--tv-error)] py-2">{error}</p>
        )}

        {/* save */}
        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saving}
            data-testid="save-button"
            className="flex items-center gap-2"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saving ? t("admin.saving") : saved ? t("admin.saved") : t("common.save")}
          </Button>
        </div>
      </ListPageContent>
    </ListPageContainer>
  );
}
