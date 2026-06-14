import { useCallback, useMemo, useState, type ReactNode } from "react";
import FilterBar from "./FilterBar";
import {
  defaultFilterState,
  isFilterAtDefault,
  rowMatches,
  type FilterSpec,
  type FilterValue,
} from "./filterSpec";

type UseListFiltersOptions = {
  onFiltersChange?: () => void;
};

type UseListFiltersResult<T> = {
  filteredRows: T[];
  bar: ReactNode;
  reset: () => void;
  hasActiveFilters: boolean;
};

/** in-memory filtering hook driven by a FilterSpec; returns filtered rows and the rendered bar. */
export default function useListFilters<T>(
  rows: T[],
  spec: FilterSpec<T>[],
  options: UseListFiltersOptions = {},
): UseListFiltersResult<T> {
  const { onFiltersChange } = options;
  const [state, setState] = useState<FilterValue[]>(() =>
    defaultFilterState(spec),
  );

  const handleChange = useCallback(
    (index: number, next: FilterValue) => {
      setState((prev) => prev.map((v, i) => (i === index ? next : v)));
      onFiltersChange?.();
    },
    [onFiltersChange],
  );

  const reset = useCallback(() => {
    setState(defaultFilterState(spec));
    onFiltersChange?.();
  }, [spec, onFiltersChange]);

  const hasActiveFilters = useMemo(
    () => spec.some((s, i) => !isFilterAtDefault(s, state[i])),
    [spec, state],
  );

  const filteredRows = useMemo(
    () => rows.filter((row) => spec.every((s, i) => rowMatches(s, state[i], row))),
    [rows, spec, state],
  );

  const bar: ReactNode = (
    <FilterBar
      spec={spec}
      state={state}
      onChange={handleChange}
      onReset={reset}
      hasActiveFilters={hasActiveFilters}
    />
  );

  return { filteredRows, bar, reset, hasActiveFilters };
}
