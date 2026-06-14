import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/components/common/Modal";
import Input from "@/components/common/Input";
import Button from "@/components/common/Button";
import { isAxiosError } from "@/api/client";
import { updateMe } from "@/api/auth";
import { useAuth } from "@/contexts/AuthContext";
import type { UserRole } from "@/types/enums";

const MIN_PASSWORD_LENGTH = 8;

type Tab = "profile" | "security";

interface UserSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const ROLE_KEYS: Record<UserRole, string> = {
  OPERATOR: "admin.role.operator",
  COORDINATOR: "admin.role.coordinator",
  SUPER_ADMIN: "admin.role.superAdmin",
};

/** modal for viewing account info and updating the current user's name and password. */
export default function UserSettingsDialog({
  isOpen,
  onClose,
}: UserSettingsDialogProps) {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuth();

  const [tab, setTab] = useState<Tab>("profile");

  const [name, setName] = useState(user?.name ?? "");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [nameSaved, setNameSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);

  function resetState() {
    setTab("profile");
    setName(user?.name ?? "");
    setNameSaving(false);
    setNameError("");
    setNameSaved(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordSaving(false);
    setPasswordError("");
    setPasswordSaved(false);
  }

  function handleClose() {
    resetState();
    onClose();
  }

  const trimmedName = name.trim();
  const nameChanged = trimmedName !== "" && trimmedName !== user?.name;

  async function handleNameSubmit() {
    if (!nameChanged) return;
    setNameSaving(true);
    setNameError("");
    setNameSaved(false);
    try {
      await updateMe({ name: trimmedName });
      await refreshUser();
      setNameSaved(true);
    } catch {
      setNameError(t("userSettings.saveError"));
    } finally {
      setNameSaving(false);
    }
  }

  async function handlePasswordSubmit() {
    setPasswordSaved(false);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(t("auth.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t("auth.passwordMismatch"));
      return;
    }
    setPasswordSaving(true);
    setPasswordError("");
    try {
      await updateMe({
        current_password: currentPassword,
        password: newPassword,
      });
      setPasswordSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 400) {
        setPasswordError(t("userSettings.wrongCurrentPassword"));
      } else {
        setPasswordError(t("userSettings.saveError"));
      }
    } finally {
      setPasswordSaving(false);
    }
  }

  const airports = user?.airports ?? [];
  const roleLabel = user ? t(ROLE_KEYS[user.role]) : "";

  const passwordReady =
    !!currentPassword && !!newPassword && !!confirmPassword;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t("userSettings.title")}>
      <div className="space-y-4">
        {/* tabs */}
        <div
          role="tablist"
          aria-label={t("userSettings.title")}
          className="flex items-center gap-1 rounded-full bg-tv-bg p-1"
        >
          <TabPill
            id="user-settings-tab-profile"
            active={tab === "profile"}
            onClick={() => setTab("profile")}
          >
            {t("userSettings.tabs.profile")}
          </TabPill>
          <TabPill
            id="user-settings-tab-security"
            active={tab === "security"}
            onClick={() => setTab("security")}
          >
            {t("userSettings.tabs.security")}
          </TabPill>
        </div>

        {tab === "profile" && (
          <div className="space-y-4" role="tabpanel">
            <dl className="space-y-2">
              <Row label={t("userSettings.email")} testId="user-settings-email">
                <span className="text-tv-text-primary">{user?.email ?? ""}</span>
              </Row>
              <Row label={t("userSettings.role")} testId="user-settings-role">
                <span className="text-tv-text-primary">{roleLabel}</span>
              </Row>
              <Row
                label={t("userSettings.airports")}
                testId="user-settings-airports"
              >
                {airports.length === 0 ? (
                  <span className="text-tv-text-muted">
                    {t("userSettings.noAirports")}
                  </span>
                ) : (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {airports.map((a) => (
                      <span
                        key={a.id}
                        title={a.name}
                        className="rounded-full border border-tv-border bg-tv-bg px-2.5 py-0.5
                          text-xs font-semibold text-tv-text-primary"
                      >
                        {a.icao_code}
                      </span>
                    ))}
                  </div>
                )}
              </Row>
            </dl>

            <Input
              id="user-settings-name"
              label={t("userSettings.name")}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameSaved(false);
              }}
              data-testid="user-settings-name"
            />
            {nameError && (
              <p
                className="text-sm text-tv-error"
                data-testid="user-settings-name-error"
              >
                {nameError}
              </p>
            )}
            {nameSaved && (
              <p
                className="text-sm text-tv-success"
                data-testid="user-settings-name-success"
              >
                {t("userSettings.nameSaved")}
              </p>
            )}
          </div>
        )}

        {tab === "security" && (
          <div className="space-y-3" role="tabpanel">
            <Input
              id="user-settings-current-password"
              type="password"
              label={t("userSettings.currentPassword")}
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                setPasswordSaved(false);
              }}
              autoComplete="current-password"
              data-testid="user-settings-current-password"
            />
            <Input
              id="user-settings-new-password"
              type="password"
              label={t("userSettings.newPassword")}
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setPasswordSaved(false);
              }}
              autoComplete="new-password"
              data-testid="user-settings-new-password"
            />
            <Input
              id="user-settings-confirm-password"
              type="password"
              label={t("userSettings.confirmPassword")}
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setPasswordSaved(false);
              }}
              autoComplete="new-password"
              data-testid="user-settings-confirm-password"
            />
            {passwordError && (
              <p
                className="text-sm text-tv-error"
                data-testid="user-settings-password-error"
              >
                {passwordError}
              </p>
            )}
            {passwordSaved && (
              <p
                className="text-sm text-tv-success"
                data-testid="user-settings-password-success"
              >
                {t("userSettings.passwordSaved")}
              </p>
            )}
          </div>
        )}

        {/* footer */}
        <div className="flex justify-end gap-2 border-t border-tv-border pt-4">
          <Button variant="secondary" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          {tab === "profile" ? (
            <Button
              onClick={handleNameSubmit}
              disabled={nameSaving || !nameChanged}
              data-testid="user-settings-save-name"
            >
              {nameSaving ? t("userSettings.saving") : t("userSettings.saveName")}
            </Button>
          ) : (
            <Button
              onClick={handlePasswordSubmit}
              disabled={passwordSaving || !passwordReady}
              data-testid="user-settings-save-password"
            >
              {passwordSaving
                ? t("userSettings.saving")
                : t("userSettings.savePassword")}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

interface TabPillProps {
  id: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}

/** pill-segmented tab button, matches the language-switcher pattern in UserMenu. */
function TabPill({ id, active, onClick, children }: TabPillProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={id}
      className={`flex-1 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? "bg-tv-nav-active-bg text-tv-nav-active-text"
          : "text-tv-text-secondary hover:bg-tv-surface-hover"
      }`}
    >
      {children}
    </button>
  );
}

interface RowProps {
  label: string;
  testId: string;
  children: ReactNode;
}

/** label + value row used inside the read-only definition list. */
function Row({ label, testId, children }: RowProps) {
  return (
    <div
      className="flex items-center justify-between gap-3 border-b border-tv-border
        py-1.5 last:border-b-0"
    >
      <dt className="text-xs font-medium text-tv-text-secondary">{label}</dt>
      <dd className="text-sm" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}
