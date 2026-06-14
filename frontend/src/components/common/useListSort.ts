import { useCallback, useMemo, useState } from "react";

export type SortDir = "asc" | "desc";

export type SortComparator<T, K extends string> = (
  a: T,
  b: T,
  key: K,
) => number;

type UseListSortResult<T, K extends string> = {
  sortedRows: T[];
  sortKey: K;
  sortDir: SortDir;
  handleSort: (key: K) => void;
};

/** shared sort state for list pages, mirroring the useListFilters shape; switching the active sort to a numericKeys key starts at desc instead of asc (largest-first is what users expect for counts, durations, dates). */
export default function useListSort<T, K extends string>(
  rows: T[],
  defaultKey: K,
  comparator: SortComparator<T, K>,
  defaultDir: SortDir = "asc",
  numericKeys: readonly K[] = [],
): UseListSortResult<T, K> {
  const [sortKey, setSortKey] = useState<K>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const numericSet = useMemo(() => new Set<K>(numericKeys), [numericKeys]);

  const handleSort = useCallback(
    (key: K) => {
      setSortKey((prevKey) => {
        if (prevKey === key) {
          setSortDir((d) => (d === "asc" ? "desc" : "asc"));
          return prevKey;
        }
        setSortDir(numericSet.has(key) ? "desc" : "asc");
        return key;
      });
    },
    [numericSet],
  );

  const sortedRows = useMemo(() => {
    const sign = sortDir === "asc" ? 1 : -1;
    return rows.slice().sort((a, b) => sign * comparator(a, b, sortKey));
  }, [rows, sortKey, sortDir, comparator]);

  return { sortedRows, sortKey, sortDir, handleSort };
}
