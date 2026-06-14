import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import useListFiltersAsParams from "@/components/common/useListFiltersAsParams";
import useListSort from "@/components/common/useListSort";
import type { FilterSpec } from "@/components/common/filterSpec";
import type { UsersSortKey } from "@/components/admin/UsersTable";
import { ROLE_BADGE, STATUS_BADGE } from "@/pages/super-admin/badgeStyles";
import {
  listUsers,
  deactivateUser,
  activateUser,
  deleteUser,
  listAirportsAdmin,
} from "@/api/admin";
import type { UserAdminResponse, AirportAdminResponse } from "@/types/admin";
import type { AirportSummary } from "@/types/auth";

const ROLE_OPTIONS = ["OPERATOR", "COORDINATOR", "SUPER_ADMIN"];
const STATUS_OPTIONS = ["active", "inactive"];

type ConfirmAction = {
  type: "deactivate" | "activate" | "delete";
  user: UserAdminResponse;
} | null;

/** comparator for client-side sort across the user table columns. */
function compareUsers(a: UserAdminResponse, b: UserAdminResponse, key: UsersSortKey): number {
  if (key === "airports") {
    return (a.airports?.length ?? 0) - (b.airports?.length ?? 0);
  }
  const av = a[key as keyof UserAdminResponse];
  const bv = b[key as keyof UserAdminResponse];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv);
  if (typeof av === "boolean" && typeof bv === "boolean") {
    return av === bv ? 0 : av ? 1 : -1;
  }
  return 0;
}

/** owns the super-admin users list state, filter bar, fetch effect, and account actions. */
export default function useSuperAdminUsersList() {
  const { t } = useTranslation();

  // list state
  const [users, setUsers] = useState<UserAdminResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  // standalone search lives outside the FilterBar, like other list pages
  const [search, setSearch] = useState("");

  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [allAirports, setAllAirports] = useState<AirportSummary[]>([]);

  // filter spec - role pills + status pills + grouped date ranges (last_login, created_at).
  // search is owned by the standalone SearchBar so it can host action buttons.
  const filterSpec = useMemo<FilterSpec<UserAdminResponse>[]>(
    () => [
      {
        kind: "pills",
        field: "role",
        multi: true,
        defaultMode: "none-active",
        options: ROLE_OPTIONS.map((r) => ({
          value: r,
          label: t(`admin.role.${r === "SUPER_ADMIN" ? "superAdmin" : r.toLowerCase()}`),
        })),
        badgeStyle: (value) => ROLE_BADGE[value] ?? {},
        paramKey: "role",
        testIdPrefix: "role-pill",
      },
      {
        kind: "pills",
        field: "is_active",
        multi: false,
        defaultMode: "none-active",
        options: STATUS_OPTIONS.map((s) => ({
          value: s,
          label: t(`admin.status.${s}`),
        })),
        badgeStyle: (value) => STATUS_BADGE[value] ?? {},
        paramKey: "status",
        testIdPrefix: "status-pill",
      },
      {
        // single shared date range applied to both last_login and created_at
        kind: "dateRange",
        field: "created_at",
        paramKey: "activity",
        labelFrom: t("admin.filters.activityFrom"),
        labelTo: t("admin.filters.activityTo"),
        testIdFrom: "activity-from",
        testIdTo: "activity-to",
      },
    ],
    [t],
  );

  const onFiltersChange = useCallback(() => setPage(0), []);
  // pinned params shape: spec produces role array, status string, one shared date range.
  // status maps to is_active server-side; role + date range applied client-side.
  const { params, bar } = useListFiltersAsParams<
    UserAdminResponse,
    {
      role?: string[];
      status?: string;
      activity_from?: string;
      activity_to?: string;
    }
  >(filterSpec, { onFiltersChange });

  // single fetch effect keyed on standalone search + status + pagination.
  const fetchUsers = useCallback(async () => {
    /** fetch users from the server using search + status + pagination. */
    setLoading(true);
    try {
      const merged: NonNullable<Parameters<typeof listUsers>[0]> = {
        limit: pageSize,
        offset: page * pageSize,
      };
      if (search) merged.search = search;
      if (params.status) merged.is_active = params.status === "active";
      const res = await listUsers(merged);
      setUsers(res.data);
      setTotal(res.meta.total);
    } catch (err) {
      console.warn("admin users list fetch failed", err);
    } finally {
      setLoading(false);
    }
  }, [search, params.status, page, pageSize]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // airports list is for the assignment dropdown; failure is non-fatal (stays empty).
  useEffect(() => {
    listAirportsAdmin()
      .then((res) => {
        setAllAirports(
          res.data.map((a: AirportAdminResponse) => ({
            id: a.id,
            icao_code: a.icao_code,
            name: a.name,
          })),
        );
      })
      .catch((err) => {
        console.warn("admin airports list fetch failed", err);
      });
  }, []);

  // role + shared activity date range apply client-side; the backend route accepts
  // only is_active/search/role(single). a row matches the date range if EITHER
  // last_login or created_at falls within it.
  const filteredUsers = useMemo(() => {
    const roles = params.role ?? [];
    const from = params.activity_from;
    const to = params.activity_to;
    const dateActive = !!from || !!to;

    function inRange(raw: string | null | undefined): boolean {
      if (!raw) return false;
      const day = new Date(raw).toISOString().slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    }

    return users.filter((u) => {
      if (roles.length > 0 && !roles.includes(u.role)) return false;
      if (dateActive && !inRange(u.last_login) && !inRange(u.created_at)) {
        return false;
      }
      return true;
    });
  }, [users, params.role, params.activity_from, params.activity_to]);

  const { sortedRows: sortedUsers, sortKey, sortDir, handleSort } = useListSort<
    UserAdminResponse,
    UsersSortKey
  >(filteredUsers, "created_at", compareUsers, "desc", [
    "airports",
    "last_login",
    "created_at",
  ]);

  async function handleConfirmAction() {
    /** apply the confirmed account action and refresh the list. */
    if (!confirmAction) return;
    try {
      if (confirmAction.type === "deactivate") {
        await deactivateUser(confirmAction.user.id);
      } else if (confirmAction.type === "activate") {
        await activateUser(confirmAction.user.id);
      } else if (confirmAction.type === "delete") {
        await deleteUser(confirmAction.user.id);
      }
      setConfirmAction(null);
      fetchUsers();
    } catch {
      /* ignore */
    }
  }

  return {
    users,
    total,
    loading,
    page,
    pageSize,
    search,
    bar,
    allAirports,
    filteredUsers,
    sortedUsers,
    sortKey,
    sortDir,
    confirmAction,
    setSearch,
    setPage,
    setPageSize,
    setConfirmAction,
    handleSort,
    fetchUsers,
    handleConfirmAction,
  };
}
