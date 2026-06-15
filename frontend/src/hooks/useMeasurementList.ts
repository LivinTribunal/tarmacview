import { useCallback, useEffect, useMemo, useState } from "react";
import { listAirportMeasurements } from "@/api/measurements";
import useListSort, { type SortDir } from "@/components/common/useListSort";
import { DEFAULT_PAGE_SIZE } from "@/constants/pagination";
import type { MeasurementListItem } from "@/types/measurement";

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

export interface UseMeasurementListResult {
  rows: MeasurementListItem[];
  loading: boolean;
  error: boolean;
  fetchRows: () => void;

  search: string;
  handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;

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

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.mission_name} ${r.inspection_method}`.toLowerCase().includes(q),
    );
  }, [rows, search]);

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
