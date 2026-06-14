import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Users } from "lucide-react";
import type { UserAdminResponse } from "@/types/admin";
import { ROLE_BADGE, WARNING_SURFACE } from "@/pages/super-admin/badgeStyles";

interface AirportAssignedUsersPanelProps {
  assignedUsers: UserAdminResponse[];
  unassigned: UserAdminResponse[];
  onAddUser: (userId: string) => void;
  onRemoveUser: (userId: string) => void;
}

/** assigned-users card with inline add/remove for the super-admin airport detail. */
export default function AirportAssignedUsersPanel({
  assignedUsers,
  unassigned,
  onAddUser,
  onRemoveUser,
}: AirportAssignedUsersPanelProps) {
  const { t } = useTranslation();

  // an airport with no coordinator is orphaned - coordinators/operators can't see it
  const hasCoordinator = assignedUsers.some((u) => u.role === "COORDINATOR");

  return (
    <div
      className="bg-tv-surface border border-tv-border rounded-2xl p-4"
      data-testid="airport-assigned-users"
    >
      <h4 className="text-sm font-semibold text-tv-text-primary mb-3 flex items-center gap-2">
        <Users className="h-4 w-4" />
        {t("admin.airportDetail.assignedUsersTitle")}
        <span className="text-tv-text-muted">·</span>
        <span>{assignedUsers.length}</span>
      </h4>

      <div className="space-y-1">
        {assignedUsers.length === 0 ? (
          <p className="text-xs text-tv-text-muted">{t("admin.noUsers")}</p>
        ) : (
          assignedUsers.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between rounded-xl bg-tv-bg px-3 py-1.5"
            >
              <div className="min-w-0">
                <Link
                  to={`/super-admin/users/${u.id}`}
                  className="text-sm text-tv-text-primary truncate hover:underline"
                >
                  {u.name}
                </Link>
                <p className="text-xs text-tv-text-muted truncate">{u.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-semibold"
                  style={ROLE_BADGE[u.role]}
                >
                  {t(
                    `admin.role.${u.role === "SUPER_ADMIN" ? "superAdmin" : u.role.toLowerCase()}`,
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveUser(u.id)}
                  className="text-tv-text-muted hover:text-tv-error text-xs"
                  aria-label={t("admin.removeUser")}
                >
                  &times;
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {!hasCoordinator && (
        <p
          className="mt-3 rounded-xl px-3 py-2 text-xs"
          style={WARNING_SURFACE}
          data-testid="no-coordinator-note"
        >
          {t("admin.airportDetail.noCoordinatorNote")}
        </p>
      )}

      {unassigned.length > 0 && (
        <select
          onChange={(e) => {
            if (e.target.value) onAddUser(e.target.value);
            e.target.value = "";
          }}
          className="mt-2 w-full rounded-full border border-tv-border bg-tv-bg px-3 py-2 text-sm text-tv-text-primary focus:outline-none focus:border-tv-accent"
          defaultValue=""
          data-testid="add-user-select"
        >
          <option value="" disabled>
            {t("admin.addUser")}
          </option>
          {unassigned.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.email})
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
