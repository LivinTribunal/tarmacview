import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listAirportMeasurements } from "@/api/measurements";
import { useMeasurementProgress } from "@/contexts/MeasurementProgressContext";
import useListFilters from "@/components/common/useListFilters";
import useListSort, { type SortDir } from "@/components/common/useListSort";
import type { BadgeStyle, FilterSpec } from "@/components/common/filterSpec";
import { DEFAULT_PAGE_SIZE } from "@/constants/pagination";
import { MEASUREMENT_POLL_INTERVAL_MS } from "@/constants/ui";
import type {
  MeasurementListItem,
  MeasurementStatus,
} from "@/types/measurement";

export type MeasurementSortKey =
  | "mission"
  | "inspection"
  | "status"
  | "created_at"
  | "result";

const NUMERIC_SORT_KEYS: readonly MeasurementSortKey[] = [
  "inspection",
  "created_at",
  "result",
];

const ALL_STATUSES: MeasurementStatus[] = [
  "QUEUED",
  "FIRST_FRAME",
  "AWAITING_CONFIRM",
  "PROCESSING",
  "DONE",
  "ERROR",
];

// phases where the worker is still running - while any row sits here the list
// polls so a finished run flips to DONE without a manual refresh
const ACTIVE_STATUSES: MeasurementStatus[] = ["QUEUED", "FIRST_FRAME", "PROCESSING"];

// status pill colors, mirroring the table StatusChip tones
const STATUS_BADGE: Record<MeasurementStatus, BadgeStyle> = {
  QUEUED: { backgroundColor: "color-mix(in srgb, var(--tv-accent) 15%, transparent)", color: "var(--tv-accent)" },
  FIRST_FRAME: { backgroundColor: "color-mix(in srgb, var(--tv-accent) 15%, transparent)", color: "var(--tv-accent)" },
  AWAITING_CONFIRM: { backgroundColor: "color-mix(in srgb, var(--tv-warning) 20%, transparent)", color: "var(--tv-warning)" },
  PROCESSING: { backgroundColor: "color-mix(in srgb, var(--tv-accent) 15%, transparent)", color: "var(--tv-accent)" },
  DONE: { backgroundColor: "var(--tv-status-completed-bg)", color: "var(--tv-status-completed-text)" },
  ERROR: { backgroundColor: "var(--tv-status-cancelled-bg)", color: "var(--tv-status-cancelled-text)" },
};

export interface UseMeasurementListResult {
  rows: MeasurementListItem[];
  loading: boolean;
  error: boolean;
  fetchRows: () => void;

  search: string;
  handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;

  filterBar: React.ReactNode;

  sorted: MeasurementListItem[];
  paged: MeasurementListItem[];
  sortKey: MeasurementSortKey;
  sortDir: SortDir;
  handleSort: (key: MeasurementSortKey) => void;

  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  handlePageSizeChange: (size: number) => void;
}

interface UseMeasurementListOptions {
  airportId: string | undefined;
}

/** shared list state for the airport-scoped measurements (results) list page. */
export default function useMeasurementList({
  airportId,
}: UseMeasurementListOptions): UseMeasurementListResult {
  const { t } = useTranslation();
  const { sync } = useMeasurementProgress();

  const [rows, setRows] = useState<MeasurementListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const fetchRows = useCallback(() => {
    /** fetch every measurement for the selected airport. */
    if (!airportId) return;
    setLoading(true);
    setError(false);
    listAirportMeasurements(airportId)
      .then(setRows)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [airportId]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // background refresh that doesn't blank the table (no loading/error toggle)
  const refreshRowsSilently = useCallback(() => {
    if (!airportId) return;
    listAirportMeasurements(airportId)
      .then(setRows)
      .catch(() => {
        // transient poll failure - keep the last good rows, retry next tick
      });
  }, [airportId]);

  // ids of runs still processing - drives both the list poll and the progress toast
  const activeIds = useMemo(
    () => rows.filter((r) => ACTIVE_STATUSES.includes(r.status)).map((r) => r.id),
    [rows],
  );

  // seed the corner progress toast with any active runs the list discovered
  // (e.g. landing here directly, or after confirming a run back into processing)
  useEffect(() => {
    sync(activeIds);
  }, [activeIds, sync]);

  // poll while any run is still processing so the list updates on its own
  useEffect(() => {
    if (activeIds.length === 0) return;
    const handle = setInterval(refreshRowsSilently, MEASUREMENT_POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [activeIds, refreshRowsSilently]);

  // distinct missions present in the list, for the mission select filter
  const missionOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (!seen.has(r.mission_id)) seen.set(r.mission_id, r.mission_name);
    }
    return Array.from(seen, ([value, label]) => ({ value, label })).sort(
      (a, b) => a.label.localeCompare(b.label),
    );
  }, [rows]);

  const filterSpec = useMemo<FilterSpec<MeasurementListItem>[]>(
    () => [
      {
        kind: "pills",
        field: "status",
        multi: true,
        defaultMode: "all-active",
        options: ALL_STATUSES.map((s) => ({
          value: s,
          label: t(`measurementsList.status.${s}`),
        })),
        badgeStyle: (value) => STATUS_BADGE[value as MeasurementStatus],
        testIdPrefix: "status-filter",
      },
      {
        kind: "select",
        field: "mission_id",
        options: missionOptions,
        placeholder: t("measurementsList.filters.allMissions"),
        testId: "mission-filter",
      },
      {
        kind: "dateRange",
        field: "created_at",
        testIdFrom: "date-from",
        testIdTo: "date-to",
      },
    ],
    [t, missionOptions],
  );

  const onFiltersChange = useCallback(() => setPage(0), []);
  const { filteredRows, bar } = useListFilters(rows, filterSpec, {
    onFiltersChange,
  });

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return filteredRows;
    return filteredRows.filter((r) =>
      `${r.mission_name} ${r.inspection_method}`.toLowerCase().includes(q),
    );
  }, [filteredRows, search]);

  const compareMeasurement = useCallback(
    (a: MeasurementListItem, b: MeasurementListItem, key: MeasurementSortKey): number => {
      switch (key) {
        case "mission":
          return a.mission_name.localeCompare(b.mission_name);
        case "inspection":
          return a.inspection_sequence_order - b.inspection_sequence_order;
        case "status":
          return a.status.localeCompare(b.status);
        case "result":
          return a.pass_count - b.pass_count;
        case "created_at":
          return (
            (a.created_at ? Date.parse(a.created_at) : 0) -
            (b.created_at ? Date.parse(b.created_at) : 0)
          );
        default:
          return 0;
      }
    },
    [],
  );

  const { sortedRows: sorted, sortKey, sortDir, handleSort } = useListSort<
    MeasurementListItem,
    MeasurementSortKey
  >(searched, "created_at", compareMeasurement, "desc", NUMERIC_SORT_KEYS);

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

  return {
    rows,
    loading,
    error,
    fetchRows,
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
  };
}
