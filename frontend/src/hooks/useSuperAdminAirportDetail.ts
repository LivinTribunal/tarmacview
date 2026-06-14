import { useCallback, useEffect, useMemo, useState } from "react";
import { listAirportsAdmin, listAuditLogs, listUsers, updateUserAirports } from "@/api/admin";
import { getAirport } from "@/api/airports";
import type { AirportAdminResponse, AuditLogEntry, UserAdminResponse } from "@/types/admin";
import type { AirportDetailResponse } from "@/types/airport";
import { MAX_LIST_LIMIT } from "@/constants/pagination";

interface UseSuperAdminAirportDetailParams {
  airportId: string | undefined;
  navigate: (path: string) => void;
  selectAirport: (airport: AirportDetailResponse) => void;
}

interface SuperAdminAirportDetailReturn {
  airport: AirportAdminResponse | null;
  airportDetail: AirportDetailResponse | null;
  assignedUsers: UserAdminResponse[];
  activity: AuditLogEntry[];
  loadFailed: boolean;
  unassigned: UserAdminResponse[];
  handleAddUser: (userId: string) => Promise<void>;
  handleRemoveUser: (userId: string) => Promise<void>;
  formatTs: (ts: string) => string;
  openInCoordinator: (query?: string) => void;
}

/** owns the super-admin airport detail data loads, user assignment, and nav helpers. */
export default function useSuperAdminAirportDetail({
  airportId,
  navigate,
  selectAirport,
}: UseSuperAdminAirportDetailParams): SuperAdminAirportDetailReturn {
  const [airport, setAirport] = useState<AirportAdminResponse | null>(null);
  const [airportDetail, setAirportDetail] = useState<AirportDetailResponse | null>(null);
  const [assignedUsers, setAssignedUsers] = useState<UserAdminResponse[]>([]);
  const [allUsers, setAllUsers] = useState<UserAdminResponse[]>([]);
  const [activity, setActivity] = useState<AuditLogEntry[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  const loadAirport = useCallback(async () => {
    /** fetch the airport row off the admin overview endpoint. */
    if (!airportId) return;
    try {
      const res = await listAirportsAdmin();
      const match = res.data.find((a) => a.id === airportId);
      if (!match) {
        setLoadFailed(true);
        return;
      }
      setAirport(match);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [airportId]);

  const loadAirportDetail = useCallback(async () => {
    /** fetch full airport detail (surfaces/obstacles/zones) for the embedded map. */
    if (!airportId) return;
    try {
      const detail = await getAirport(airportId);
      setAirportDetail(detail);
    } catch {
      setAirportDetail(null);
    }
  }, [airportId]);

  const loadUsers = useCallback(async () => {
    /** fetch assigned + unassigned users for the inline manage-users panel. */
    if (!airportId) return;
    try {
      const [assigned, all] = await Promise.all([
        listUsers({ airport_id: airportId, limit: MAX_LIST_LIMIT }),
        listUsers({ limit: MAX_LIST_LIMIT }),
      ]);
      setAssignedUsers(assigned.data);
      setAllUsers(all.data);
    } catch {
      /* ignore */
    }
  }, [airportId]);

  const loadActivity = useCallback(async () => {
    /** fetch the latest 20 audit rows scoped to this airport. */
    if (!airportId) return;
    try {
      const res = await listAuditLogs({
        airport_id: airportId,
        limit: 20,
        sort_by: "timestamp",
        sort_dir: "desc",
      });
      setActivity(res.data);
    } catch {
      setActivity([]);
    }
  }, [airportId]);

  useEffect(() => {
    loadAirport();
    loadAirportDetail();
    loadUsers();
    loadActivity();
  }, [loadAirport, loadAirportDetail, loadUsers, loadActivity]);

  const unassigned = useMemo(
    () => allUsers.filter((u) => !assignedUsers.some((a) => a.id === u.id)),
    [allUsers, assignedUsers],
  );

  async function handleAddUser(userId: string) {
    /** add an airport assignment for the given user. */
    if (!airportId) return;
    const user = allUsers.find((u) => u.id === userId);
    if (!user) return;
    const ids = user.airports.map((a) => a.id);
    try {
      await updateUserAirports(userId, { airport_ids: [...ids, airportId] });
      await Promise.all([loadUsers(), loadAirport()]);
    } catch {
      /* ignore */
    }
  }

  async function handleRemoveUser(userId: string) {
    /** remove this airport from a user's assignment list. */
    if (!airportId) return;
    const user = allUsers.find((u) => u.id === userId);
    if (!user) return;
    const ids = user.airports.flatMap((a) => (a.id !== airportId ? [a.id] : []));
    try {
      await updateUserAirports(userId, { airport_ids: ids });
      await Promise.all([loadUsers(), loadAirport()]);
    } catch {
      /* ignore */
    }
  }

  function formatTs(ts: string) {
    /** locale timestamp for the activity panel. */
    return new Date(ts).toLocaleString();
  }

  function openInCoordinator(query?: string) {
    /** pre-select the airport in context so coordinator-layout doesn't redirect to list. */
    if (!airportDetail) return;
    selectAirport(airportDetail);
    const path = `/coordinator-center/airports/${airportDetail.id}`;
    navigate(query ? `${path}?${query}` : path);
  }

  return {
    airport,
    airportDetail,
    assignedUsers,
    activity,
    loadFailed,
    unassigned,
    handleAddUser,
    handleRemoveUser,
    formatTs,
    openInCoordinator,
  };
}
