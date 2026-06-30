import { useCallback, useEffect, useMemo, useState } from "react";
import { listDroneProfiles } from "@/api/droneProfiles";
import useListSort, { type SortDir } from "@/components/common/useListSort";
import { getBundledModel } from "@/config/droneModels";
import { DEFAULT_PAGE_SIZE, MAX_LIST_LIMIT } from "@/constants/pagination";
import useToast from "@/hooks/useToast";
import type { DroneProfileResponse } from "@/types/droneProfile";

export type DroneSortKey =
  | "name"
  | "manufacturer"
  | "model"
  | "max_speed"
  | "endurance_minutes"
  | "mission_count";

const NUMERIC_KEYS: readonly DroneSortKey[] = [
  "max_speed",
  "endurance_minutes",
  "mission_count",
];

/** comparator across the drone-list columns; numeric and string. */
export function compareDrone(
  a: DroneProfileResponse,
  b: DroneProfileResponse,
  key: DroneSortKey,
): number {
  switch (key) {
    case "max_speed":
      return (a.max_speed ?? -1) - (b.max_speed ?? -1);
    case "endurance_minutes":
      return (a.endurance_minutes ?? -1) - (b.endurance_minutes ?? -1);
    case "mission_count":
      return a.mission_count - b.mission_count;
    case "manufacturer":
      return (a.manufacturer || "").localeCompare(b.manufacturer || "");
    case "model":
      return (a.model || "").localeCompare(b.model || "");
    case "name":
      return a.name.localeCompare(b.name);
  }
}

/** resolve a drone model identifier to a loadable url. */
export function resolveModelUrl(identifier: string | null): string | null {
  if (!identifier) return null;
  const bundled = getBundledModel(identifier);
  if (bundled) return bundled.path;
  return `/static/models/custom/${identifier}`;
}

export interface UseDroneProfileListResult {
  drones: DroneProfileResponse[];
  loading: boolean;
  error: boolean;
  fetchDrones: () => void;

  search: string;
  manufacturerFilter: string;
  manufacturers: string[];
  handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleManufacturerChange: (value: string) => void;

  sorted: DroneProfileResponse[];
  paged: DroneProfileResponse[];
  sortKey: DroneSortKey;
  sortDir: SortDir;
  handleSort: (key: DroneSortKey) => void;

  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  handlePageSizeChange: (size: number) => void;

  notification: string | null;
  showToast: (msg: string) => void;
}

/** shared list state for the coordinator + operator drone-profile pages. */
export default function useDroneProfileList(): UseDroneProfileListResult {
  const [drones, setDrones] = useState<DroneProfileResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [search, setSearch] = useState("");
  const [manufacturerFilter, setManufacturerFilter] = useState("");

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const { message: notification, show: showToast } = useToast();

  const fetchDrones = useCallback(() => {
    /** fetch all drone profiles. */
    setLoading(true);
    setError(false);
    listDroneProfiles({ limit: MAX_LIST_LIMIT })
      .then((res) => setDrones(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchDrones();
  }, [fetchDrones]);

  const manufacturers = useMemo(() => {
    const set = new Set<string>();
    for (const d of drones) {
      if (d.manufacturer) set.add(d.manufacturer);
    }
    return Array.from(set).sort();
  }, [drones]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return drones.filter((d) => {
      if (q && !d.name.toLowerCase().includes(q)) return false;
      if (manufacturerFilter && d.manufacturer !== manufacturerFilter)
        return false;
      return true;
    });
  }, [drones, search, manufacturerFilter]);

  const { sortedRows: sorted, sortKey, sortDir, handleSort } = useListSort<
    DroneProfileResponse,
    DroneSortKey
  >(filtered, "name", compareDrone, "asc", NUMERIC_KEYS);

  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
      setPage(0);
    },
    [],
  );

  const handleManufacturerChange = useCallback((value: string) => {
    setManufacturerFilter(value);
    setPage(0);
  }, []);

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setPage(0);
  }, []);

  return {
    drones,
    loading,
    error,
    fetchDrones,
    search,
    manufacturerFilter,
    manufacturers,
    handleSearchChange,
    handleManufacturerChange,
    sorted,
    paged,
    sortKey,
    sortDir,
    handleSort,
    page,
    pageSize,
    setPage,
    handlePageSizeChange,
    notification,
    showToast,
  };
}
