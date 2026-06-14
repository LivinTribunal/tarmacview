import { useTranslation } from "react-i18next";
import { Pencil, UserMinus, UserCheck, Trash2 } from "lucide-react";
import { SortableHeader } from "@/components/common/ListPageLayout";
import RowActionButtons from "@/components/common/RowActionButtons";
import type { UserAdminResponse } from "@/types/admin";
import { ROLE_BADGE, STATUS_BADGE } from "@/pages/super-admin/badgeStyles";

export type UsersSortKey =
  | "name"
  | "email"
  | "role"
  | "airports"
  | "is_active"
  | "last_login"
  | "created_at";

type ConfirmActionType = "deactivate" | "activate" | "delete";

interface UsersTableProps {
  loading: boolean;
  isEmpty: boolean;
  rows: UserAdminResponse[];
  sortKey: UsersSortKey;
  sortDir: "asc" | "desc";
  onSort: (key: UsersSortKey) => void;
  onSelectUser: (userId: string) => void;
  onConfirmAction: (action: { type: ConfirmActionType; user: UserAdminResponse }) => void;
}

/** presentational super-admin users table: loading/empty states + sortable rows. */
export default function UsersTable({
  loading,
  isEmpty,
  rows,
  sortKey,
  sortDir,
  onSort,
  onSelectUser,
  onConfirmAction,
}: UsersTableProps) {
  const { t } = useTranslation();

  function formatDate(dateStr: string | null) {
    /** render a date string or the "never" placeholder. */
    if (!dateStr) return t("admin.never");
    return new Date(dateStr).toLocaleDateString();
  }

  return (
    <div className="rounded-2xl border border-tv-border bg-tv-surface overflow-hidden">
      {loading ? (
        <p className="text-center text-tv-text-muted py-8">{t("common.loading")}</p>
      ) : isEmpty ? (
        <p className="text-center text-tv-text-muted py-8">{t("admin.noUsers")}</p>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full" data-testid="users-table">
            <thead>
              <tr className="border-b border-tv-border">
                <SortableHeader sortKey="name" currentSort={sortKey} currentDir={sortDir} onSort={onSort}>
                  {t("admin.columns.name")}
                </SortableHeader>
                <SortableHeader sortKey="email" currentSort={sortKey} currentDir={sortDir} onSort={onSort}>
                  {t("admin.columns.email")}
                </SortableHeader>
                <SortableHeader sortKey="role" currentSort={sortKey} currentDir={sortDir} onSort={onSort}>
                  {t("admin.columns.role")}
                </SortableHeader>
                <SortableHeader sortKey="airports" currentSort={sortKey} currentDir={sortDir} onSort={onSort}>
                  {t("admin.columns.airports")}
                </SortableHeader>
                <SortableHeader sortKey="is_active" currentSort={sortKey} currentDir={sortDir} onSort={onSort}>
                  {t("admin.columns.status")}
                </SortableHeader>
                <SortableHeader sortKey="last_login" currentSort={sortKey} currentDir={sortDir} onSort={onSort}>
                  {t("admin.columns.lastLogin")}
                </SortableHeader>
                <SortableHeader sortKey="created_at" currentSort={sortKey} currentDir={sortDir} onSort={onSort}>
                  {t("admin.columns.created")}
                </SortableHeader>
                <th className="px-4 py-3" aria-label={t("common.actions")} />
              </tr>
            </thead>
            <tbody>
              {rows.map((user) => (
                <tr
                  key={user.id}
                  onClick={() => onSelectUser(user.id)}
                  className="border-b border-tv-border hover:bg-tv-surface-hover cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 text-sm text-tv-text-primary font-medium">{user.name}</td>
                  <td className="px-4 py-3 text-sm text-tv-text-secondary">{user.email}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={ROLE_BADGE[user.role]}>
                      {t(`admin.role.${user.role === "SUPER_ADMIN" ? "superAdmin" : user.role.toLowerCase()}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-tv-text-secondary">{user.airports?.length || 0}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={STATUS_BADGE[user.is_active ? "active" : "inactive"]}>
                      {user.is_active ? t("admin.status.active") : t("admin.status.inactive")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-tv-text-muted">{formatDate(user.last_login)}</td>
                  <td className="px-4 py-3 text-sm text-tv-text-muted">{formatDate(user.created_at)}</td>
                  <td className="px-4 py-3">
                    <RowActionButtons
                      actions={[
                        {
                          icon: Pencil,
                          onClick: () => onSelectUser(user.id),
                          title: t("common.edit"),
                        },
                        user.is_active
                          ? {
                              icon: UserMinus,
                              onClick: () => onConfirmAction({ type: "deactivate", user }),
                              title: t("admin.deactivateUser"),
                            }
                          : {
                              icon: UserCheck,
                              onClick: () => onConfirmAction({ type: "activate", user }),
                              title: t("admin.activateUser"),
                            },
                        {
                          icon: Trash2,
                          onClick: () => onConfirmAction({ type: "delete", user }),
                          variant: "danger" as const,
                          disabled: user.is_active,
                          title: t("admin.deleteUser"),
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
