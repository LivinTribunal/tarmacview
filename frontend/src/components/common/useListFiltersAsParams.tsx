import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import FilterBar from "./FilterBar";
import {
  defaultFilterState,
  filterStateToParams,
  isFilterAtDefault,
  type FilterSpec,
  type FilterValue,
} from "./filterSpec";

/** shallow-equal a flat record of axios-friendly param values. */
function shallowEqualRecord(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    const av = a[k];
    const bv = b[k];
    if (Array.isArray(av) && Array.isArray(bv)) {
      if (av.length !== bv.length) return false;
      for (let i = 0; i < av.length; i++) {
        if (av[i] !== bv[i]) return false;
      }
      continue;
    }
    if (av !== bv) return false;
  }
  return true;
}

type UseListFiltersAsParamsOptions = {
  onFiltersChange?: () => void;
};

type UseListFiltersAsParamsResult<P> = {
  params: P;
  bar: ReactNode;
  reset: () => void;
  hasActiveFilters: boolean;
};

/** server-param variant of the filter template; returns a memoized params object, with callers able to pin the params shape via P (e.g. an axios endpoint's param type) so the call site doesn't need an `as Parameters<typeof endpoint>[0]` cast. */
export default function useListFiltersAsParams<
  T,
  P extends Record<string, unknown> = Record<string, unknown>,
>(
  spec: FilterSpec<T>[],
  options: UseListFiltersAsParamsOptions = {},
): UseListFiltersAsParamsResult<P> {
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

  // keep params referentially stable across spec-only changes (e.g. async option
  // population) so that fetch effects keyed on `params` don't double-fire.
  const lastParamsRef = useRef<Record<string, unknown>>({});
  const params = useMemo(() => {
    const next = filterStateToParams(spec, state);
    if (shallowEqualRecord(lastParamsRef.current, next)) {
      return lastParamsRef.current;
    }
    lastParamsRef.current = next;
    return next;
  }, [spec, state]);

  const bar: ReactNode = (
    <FilterBar
      spec={spec}
      state={state}
      onChange={handleChange}
      onReset={reset}
      hasActiveFilters={hasActiveFilters}
    />
  );

  return { params: params as unknown as P, bar, reset, hasActiveFilters };
}
