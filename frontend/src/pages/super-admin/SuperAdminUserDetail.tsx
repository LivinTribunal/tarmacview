import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import Button from "@/components/common/Button";
import Input from "@/components/common/Input";
import UserAssignedAirportsPanel from "@/components/admin/UserAssignedAirportsPanel";
import type { UserAdminResponse, AuditLogEntry } from "@/types/admin";
import type { AirportSummary } from "@/types/auth";
import { MS_PER_DAY } from "@/constants/ui";
import { ROLE_BADGE, STATUS_BADGE, actionBadgeStyle } from "./badgeStyles";

type ConfirmActionType = "deactivate" | "activate" | "delete";

interface SuperAdminUserDetailProps {
  user: UserAdminResponse;
  allAirports: AirportSummary[];
  userLogs: AuditLogEntry[];
  editName: string;
  editEmail: string;
  editRole: string;
  saving: boolean;
  resetLink: string;
  onEditNameChange: (value: string) => void;
  onEditEmailChange: (value: string) => void;
  onEditRoleChange: (value: string) => void;
  onBack: () => void;
  onSave: () => void;
  onResetPassword: () => void;
  onRemoveAirport: (airportId: string) => void;
  onAddAirport: (airportId: string) => void;
  onConfirmAction: (action: { type: ConfirmActionType; user: UserAdminResponse }) => void;
}

/** map (entity_type, entity_id) to a known detail page if one exists. */
function entityLink(log: AuditLogEntry): string | null {
  if (!log.entity_id) return null;
  if (log.entity_type === "User") return `/super-admin/users/${log.entity_id}`;
  if (log.entity_type === "Airport") return `/super-admin/airports/${log.entity_id}`;
  if (log.entity_type === "Mission") {
    return `/operator-center/missions/${log.entity_id}/overview`;
  }
  return null;
}

/** super-admin user detail view: profile, airport assignment, edit form, activity. */
export default function SuperAdminUserDetail({
  user,
  allAirports,
  userLogs,
  editName,
  editEmail,
  editRole,
  saving,
  resetLink,
  onEditNameChange,
  onEditEmailChange,
  onEditRoleChange,
  onBack,
  onSave,
  onResetPassword,
  onRemoveAirport,
  onAddAirport,
  onConfirmAction,
}: SuperAdminUserDetailProps) {
  const { t } = useTranslation();

  function formatDate(dateStr: string | null) {
    /** render a date string or the "never" placeholder. */
    if (!dateStr) return t("admin.never");
    return new Date(dateStr).toLocaleDateString();
  }

  function formatRelative(ts: string): string {
    /** render a short relative timestamp ("2h ago", "3d ago", "just now"). */
    const then = new Date(ts).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - then);
    const m = Math.round(diff / 60000);
    if (m < 1) return t("common.justNow", { defaultValue: "just now" });
    if (m < 60) return t("admin.relative.minutesAgo", { count: m });
    const h = Math.round(m / 60);
    if (h < 24) return t("admin.relative.hoursAgo", { count: h });
    const d = Math.round(h / 24);
    return t("admin.relative.daysAgo", { count: d });
  }

  function dateGroupLabel(ts: string): string {
    /** bucket label: today / yesterday / iso date. */
    const day = new Date(ts);
    day.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - day.getTime()) / MS_PER_DAY);
    if (diff <= 0) return t("admin.today");
    if (diff === 1) return t("admin.yesterday");
    return day.toLocaleDateString();
  }

  /** group activity rows by day, preserving descending order within each group. */
  const groupedLogs = useMemo(() => {
    const groups: { label: string; rows: AuditLogEntry[] }[] = [];
    for (const log of userLogs) {
      const label = dateGroupLabel(log.timestamp);
      const last = groups[groups.length - 1];
      if (last && last.label === label) {
        last.rows.push(log);
      } else {
        groups.push({ label, rows: [log] });
      }
    }
    return groups;
  }, [userLogs, t]);

  return (
    <div className="px-4 pt-2 pb-6">
      <div className="mb-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-tv-text-secondary hover:text-tv-text-primary transition-colors"
        >
          &larr; {t("admin.users")}
        </button>
      </div>

      <div className="flex">
        {/* left panel - 30% with spacer matching navbar */}
        <div className="w-[30%] flex-shrink-0 flex">
          <div className="flex-1 space-y-4">
            <div className="bg-tv-surface border border-tv-border rounded-2xl p-4">
              <h3 className="text-base font-semibold text-tv-text-primary mb-3">
                {user.name}
              </h3>
              <p className="text-sm text-tv-text-secondary">{user.email}</p>
              <div className="flex gap-2 mt-2">
                <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={ROLE_BADGE[user.role]}>
                  {t(`admin.role.${user.role === "SUPER_ADMIN" ? "superAdmin" : user.role.toLowerCase()}`)}
                </span>
                <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={STATUS_BADGE[user.is_active ? "active" : "inactive"]}>
                  {user.is_active ? t("admin.status.active") : t("admin.status.inactive")}
                </span>
              </div>
              <div className="mt-3 text-xs text-tv-text-muted space-y-1">
                <p>{t("admin.lastLogin")}: {formatDate(user.last_login)}</p>
                <p>{t("admin.memberSince")}: {formatDate(user.created_at)}</p>
              </div>
            </div>

            <UserAssignedAirportsPanel
              assignedAirports={user.airports}
              allAirports={allAirports}
              onAddAirport={onAddAirport}
              onRemoveAirport={onRemoveAirport}
            />
          </div>
          <div className="w-6 flex-shrink-0" />
        </div>

        {/* right area - mirrors navbar right section */}
        <div className="flex-1 flex gap-4 min-w-0">
          {/* center panel - edit form */}
          <div className="flex-1 min-w-0">
            <div className="bg-tv-surface border border-tv-border rounded-2xl p-4 space-y-4">
              <h3 className="text-base font-semibold text-tv-text-primary">
                {t("admin.editUser")}
              </h3>
              <Input
                label={t("admin.name")}
                value={editName}
                onChange={(e) => onEditNameChange(e.target.value)}
              />
              <Input
                label={t("admin.email")}
                type="email"
                value={editEmail}
                onChange={(e) => onEditEmailChange(e.target.value)}
              />
              <div>
                <label className="block text-xs font-medium mb-1 text-tv-text-secondary">
                  {t("admin.selectRole")}
                </label>
                <select
                  value={editRole}
                  onChange={(e) => onEditRoleChange(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent"
                >
                  <option value="OPERATOR">{t("admin.role.operator")}</option>
                  <option value="COORDINATOR">{t("admin.role.coordinator")}</option>
                  <option value="SUPER_ADMIN">{t("admin.role.superAdmin")}</option>
                </select>
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Button onClick={onSave} disabled={saving}>
                  {saving ? t("admin.saving") : t("admin.saveChanges")}
                </Button>
                <Button variant="secondary" onClick={onResetPassword}>
                  {t("admin.resetPassword")}
                </Button>
              </div>
              {resetLink && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    readOnly
                    value={resetLink}
                    aria-label={t("admin.copyLink")}
                    className="flex-1 rounded-full border border-tv-border bg-tv-bg px-4 py-2 text-sm text-tv-text-primary"
                  />
                  <Button
                    variant="secondary"
                    onClick={() => {
                      navigator.clipboard.writeText(resetLink);
                    }}
                  >
                    {t("admin.copyLink")}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* right panel - aligned with system status + theme + user */}
          <div className="w-[396px] flex-shrink-0 space-y-4">
          <div className="bg-tv-surface border border-tv-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-tv-text-primary">
                {t("admin.recentActivity")}
              </h4>
              {user && (
                <Link
                  to={`/super-admin/audit-log?user_id=${user.id}`}
                  className="text-xs text-tv-text-secondary hover:text-tv-text-primary"
                  data-testid="user-activity-view-all"
                >
                  {t("admin.viewAll")}
                </Link>
              )}
            </div>

            {userLogs.length === 0 ? (
              <p className="text-xs text-tv-text-muted">{t("admin.noActivityYet")}</p>
            ) : (
              <div
                className="space-y-3 max-h-[400px] overflow-y-auto"
                data-testid="user-activity-list"
              >
                {groupedLogs.map((group) => (
                  <div key={group.label}>
                    <p
                      className="text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted mb-1"
                      data-testid="activity-date-group"
                    >
                      {group.label}
                    </p>
                    <div className="space-y-2">
                      {group.rows.map((log) => {
                        const href = entityLink(log);
                        return (
                          <div
                            key={log.id}
                            className="flex items-start gap-2 text-xs"
                          >
                            <span
                              className="rounded-full px-1.5 py-0.5 font-semibold flex-shrink-0 mt-0.5"
                              style={actionBadgeStyle(log.action)}
                              title={log.action}
                            >
                              {t(`admin.audit.actions.${log.action}`, log.action)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-tv-text-secondary truncate">
                                {log.entity_type && `${log.entity_type}`}
                                {log.entity_name && ": "}
                                {log.entity_name &&
                                  (href ? (
                                    <Link
                                      to={href}
                                      className="text-tv-text-primary hover:underline"
                                      data-testid="activity-entity-link"
                                    >
                                      {log.entity_name}
                                    </Link>
                                  ) : (
                                    <span>{log.entity_name}</span>
                                  ))}
                              </p>
                              <p
                                className="text-tv-text-muted"
                                title={new Date(log.timestamp).toLocaleString()}
                              >
                                {formatRelative(log.timestamp)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* account actions */}
          <div className="bg-tv-surface border border-tv-border rounded-2xl p-4 space-y-2">
            <h4 className="text-sm font-semibold text-tv-text-primary mb-1">
              {t("admin.accountActions")}
            </h4>
            {user.is_active ? (
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => onConfirmAction({ type: "deactivate", user })}
              >
                {t("admin.revokeAccess")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => onConfirmAction({ type: "activate", user })}
              >
                {t("admin.activateUser")}
              </Button>
            )}
            <Button
              variant="danger"
              className="w-full"
              disabled={user.is_active}
              onClick={() => onConfirmAction({ type: "delete", user })}
            >
              {t("admin.deleteAccountPermanently")}
            </Button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
