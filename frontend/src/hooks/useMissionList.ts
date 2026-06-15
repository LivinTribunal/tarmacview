import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  deleteMission,
  duplicateMission,
  listMissions,
  updateMission,
} from "@/api/missions";
import { useDroneProfiles } from "@/api/queries/droneProfiles";
import useListFilters from "@/components/common/useListFilters";
import useListSort, { type SortDir } from "@/components/common/useListSort";
import type { FilterSpec } from "@/components/common/filterSpec";
import { DEFAULT_PAGE_SIZE, MAX_LIST_LIMIT } from "@/constants/pagination";
import type { MissionResponse } from "@/types/mission";
import type { MissionStatus } from "@/types/enums";

export type MissionSortKey =
  | "name"
  | "status"
  | "drone"
  | "inspections"
  | "duration"
  | "created_at"
  | "updated_at";

const NUMERIC_SORT_KEYS: readonly MissionSortKey[] = [
  "inspections",
  "duration",
  "created_at",
  "updated_at",
];

const ALL_STATUSES: MissionStatus[] = [
  "DRAFT",
  "PLANNED",
  "VALIDATED",
  "EXPORTED",
  "MEASURED",
  "COMPLETED",
  "CANCELLED",
];

export interface UseMissionListResult {
  missions: MissionResponse[];
  loading: boolean;
  error: boolean;
  fetchMissions: () => void;

  droneMap: Map<string, string>;
  droneProfiles: { id: string; name: string }[];

  search: string;
  handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;

  filterBar: React.ReactNode;

  sorted: MissionResponse[];
  paged: MissionResponse[];
  sortKey: MissionSortKey;
  sortDir: SortDir;
  handleSort: (key: MissionSortKey) => void;

  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  handlePageSizeChange: (size: number) => void;

  handleDelete: (mission: MissionResponse) => Promise<void>;
  handleDuplicate: (mission: MissionResponse) => Promise<void>;
  handleRename: (mission: MissionResponse, name: string) => Promise<void>;
}

interface UseMissionListOptions {
  airportId: string | undefined;
}

/** shared list state for the operator mission list page. */
export default function useMissionList({
  airportId,
}: UseMissionListOptions): UseMissionListResult {
  const { t } = useTranslation();

  const [missions, setMissions] = useState<MissionResponse[]>([]);
  const { data: droneData } = useDroneProfiles();
  const droneProfiles = useMemo(() => droneData?.data ?? [], [droneData]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [search, setSearch] = useState("");

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const droneMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const dp of droneProfiles) {
      m.set(dp.id, dp.name);
    }
    return m;
  }, [droneProfiles]);

  const fetchMissions = useCallback(() => {
    /** fetch missions for the selected airport. */
    if (!airportId) return;
    setLoading(true);
    setError(false);
    listMissions({ airport_id: airportId, limit: MAX_LIST_LIMIT })
      .then((res) => setMissions(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [airportId]);

  useEffect(() => {
    fetchMissions();
  }, [fetchMissions]);

  const filterSpec = useMemo<FilterSpec<MissionResponse>[]>(
    () => [
      {
        kind: "pills",
        field: "status",
        multi: true,
        defaultMode: "all-active",
        options: ALL_STATUSES.map((s) => ({
          value: s,
          label: t(`missionStatus.${s}`),
        })),
        badgeStyle: (value) => ({
          backgroundColor: `var(--tv-status-${value.toLowerCase()}-bg)`,
          color: `var(--tv-status-${value.toLowerCase()}-text)`,
        }),
        testIdPrefix: "status-filter",
      },
      {
        kind: "select",
        field: "drone_profile_id",
        options: droneProfiles.map((dp) => ({ value: dp.id, label: dp.name })),
        placeholder: t("missionList.filters.allDrones"),
        testId: "drone-filter",
      },
      {
        kind: "dateRange",
        field: "created_at",
        labelFrom: t("missionList.filters.from"),
        labelTo: t("missionList.filters.to"),
        testIdFrom: "date-from",
        testIdTo: "date-to",
      },
    ],
    [t, droneProfiles],
  );

  const onFiltersChange = useCallback(() => setPage(0), []);
  const { filteredRows, bar } = useListFilters(missions, filterSpec, {
    onFiltersChange,
  });

  const searched = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return filteredRows;
    return filteredRows.filter((m) => m.name.toLowerCase().includes(q));
  }, [filteredRows, search]);

  const compareMission = useCallback(
    (a: MissionResponse, b: MissionResponse, key: MissionSortKey): number => {
      let av: string | number = "";
      let bv: string | number = "";
      switch (key) {
        case "name":
          av = a.name;
          bv = b.name;
          break;
        case "status":
          av = a.status;
          bv = b.status;
          break;
        case "drone":
          av = (a.drone_profile_id && droneMap.get(a.drone_profile_id)) || "";
          bv = (b.drone_profile_id && droneMap.get(b.drone_profile_id)) || "";
          break;
        case "created_at":
          av = a.created_at;
          bv = b.created_at;
          break;
        default:
          av = "";
          bv = "";
      }
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av).localeCompare(String(bv));
    },
    [droneMap],
  );

  const { sortedRows: sorted, sortKey, sortDir, handleSort } = useListSort<
    MissionResponse,
    MissionSortKey
  >(searched, "created_at", compareMission, "desc", NUMERIC_SORT_KEYS);

  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
      setPage(0);
    },
    [],
  );

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setPage(0);
  }, []);

  const handleDelete = useCallback(
    async (mission: MissionResponse) => {
      /** delete a mission and refresh the list. */
      try {
        await deleteMission(mission.id);
        fetchMissions();
      } catch {
        // ignore
      }
    },
    [fetchMissions],
  );

  const handleDuplicate = useCallback(
    async (mission: MissionResponse) => {
      /** duplicate a mission and refresh the list. */
      try {
        await duplicateMission(mission.id);
        fetchMissions();
      } catch {
        // ignore
      }
    },
    [fetchMissions],
  );

  const handleRename = useCallback(
    async (mission: MissionResponse, name: string) => {
      /** rename a mission and refresh the list. */
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        await updateMission(mission.id, { name: trimmed });
        fetchMissions();
      } catch {
        // ignore
      }
    },
    [fetchMissions],
  );

  return {
    missions,
    loading,
    error,
    fetchMissions,
    droneMap,
    droneProfiles,
    search,
    handleSearchChange,
    filterBar: bar,
    sorted,
    paged,
    sortKey,
    sortDir,
    handleSort,
    page,
    pageSize,
    setPage,
    handlePageSizeChange,
    handleDelete,
    handleDuplicate,
    handleRename,
  };
}
