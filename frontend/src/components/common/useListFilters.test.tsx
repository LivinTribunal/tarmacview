import { describe, it, expect, vi } from "vitest";
import { useEffect, useRef } from "react";
import { act, render, fireEvent, screen, cleanup } from "@testing-library/react";
import useListFilters from "./useListFilters";
import useListFiltersAsParams from "./useListFiltersAsParams";
import type { FilterSpec } from "./filterSpec";

type Row = {
  id: string;
  name: string;
  status: string;
  category: string;
  created_at: string;
  archived: boolean;
  methods: string[];
};

/** build a fresh row set per test to avoid shared mutable state. */
function makeRows(): Row[] {
  return [
    {
      id: "1",
      name: "Alpha",
      status: "OPEN",
      category: "a",
      created_at: "2026-03-01T00:00:00Z",
      archived: false,
      methods: ["VLOS", "BVLOS"],
    },
    {
      id: "2",
      name: "Beta",
      status: "CLOSED",
      category: "b",
      created_at: "2026-03-15T00:00:00Z",
      archived: true,
      methods: ["BVLOS"],
    },
    {
      id: "3",
      name: "Gamma",
      status: "OPEN",
      category: "a",
      created_at: "2026-04-01T00:00:00Z",
      archived: false,
      methods: ["VLOS"],
    },
  ];
}

type Snapshot<T> = ReturnType<typeof useListFilters<T>>;

/** test harness that mounts the hook in a single tree and exposes its result via ref. */
function FiltersHarness<T extends object>({
  rows,
  spec,
  resultRef,
  onFiltersChange,
}: {
  rows: T[];
  spec: FilterSpec<T>[];
  resultRef: { current: Snapshot<T> | null };
  onFiltersChange?: () => void;
}) {
  const result = useListFilters(rows, spec, { onFiltersChange });
  resultRef.current = result;
  return <>{result.bar}</>;
}

type ParamsSnapshot = ReturnType<typeof useListFiltersAsParams>;

/** harness that mounts the params hook in a single tree. */
function ParamsHarness<T extends object>({
  spec,
  resultRef,
  rerenderTickRef,
}: {
  spec: FilterSpec<T>[];
  resultRef: { current: ParamsSnapshot | null };
  rerenderTickRef?: { current: number };
}) {
  const result = useListFiltersAsParams(spec);
  resultRef.current = result;
  // force a no-op render when external tick changes; used to test memo stability
  const tick = rerenderTickRef?.current ?? 0;
  const lastTickRef = useRef(tick);
  useEffect(() => {
    lastTickRef.current = tick;
  }, [tick]);
  return <>{result.bar}</>;
}

describe("useListFilters", () => {
  /** in-memory client filtering hook tests. */

  it("matches by search field, case-insensitive", () => {
    /** search predicate uses a case-insensitive substring match. */
    const ref: { current: Snapshot<Row> | null } = { current: null };
    const spec: FilterSpec<Row>[] = [
      { kind: "search", field: "name", testId: "search" },
    ];
    render(
      <FiltersHarness rows={makeRows()} spec={spec} resultRef={ref} />,
    );
    fireEvent.change(screen.getByTestId("search"), {
      target: { value: "alp" },
    });
    expect(ref.current!.filteredRows.map((r) => r.id)).toEqual(["1"]);
    cleanup();
  });

  it("filters pills multi default-all-active (first click isolates)", () => {
    /** clicking from the all-active default keeps only the clicked option. */
    const ref: { current: Snapshot<Row> | null } = { current: null };
    const spec: FilterSpec<Row>[] = [
      {
        kind: "pills",
        field: "status",
        multi: true,
        defaultMode: "all-active",
        options: [
          { value: "OPEN", label: "Open" },
          { value: "CLOSED", label: "Closed" },
        ],
        testIdPrefix: "status",
      },
    ];
    render(
      <FiltersHarness rows={makeRows()} spec={spec} resultRef={ref} />,
    );
    expect(ref.current!.filteredRows).toHaveLength(3);
    fireEvent.click(screen.getByTestId("status-OPEN"));
    expect(ref.current!.filteredRows.map((r) => r.id)).toEqual(["1", "3"]);
    fireEvent.click(screen.getByTestId("status-CLOSED"));
    expect(ref.current!.filteredRows.map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(ref.current!.hasActiveFilters).toBe(false);
    cleanup();
  });

  it("filters pills multi default-none-active (none = show all)", () => {
    /** none-active default keeps the active set empty so every row passes. */
    const ref: { current: Snapshot<Row> | null } = { current: null };
    const spec: FilterSpec<Row>[] = [
      {
        kind: "pills",
        field: "status",
        multi: true,
        defaultMode: "none-active",
        options: [
          { value: "OPEN", label: "Open" },
          { value: "CLOSED", label: "Closed" },
        ],
        testIdPrefix: "status",
      },
    ];
    render(
      <FiltersHarness rows={makeRows()} spec={spec} resultRef={ref} />,
    );
    expect(ref.current!.filteredRows).toHaveLength(3);
    fireEvent.click(screen.getByTestId("status-OPEN"));
    expect(ref.current!.filteredRows.map((r) => r.id)).toEqual(["1", "3"]);
    cleanup();
  });

  it("toggles a single-mode pill off when clicked twice", () => {
    /** clicking the active pill in single mode clears the selection. */
    const ref: { current: Snapshot<Row> | null } = { current: null };
    const spec: FilterSpec<Row>[] = [
      {
        kind: "pills",
        field: "status",
        multi: false,
        defaultMode: "none-active",
        options: [
          { value: "OPEN", label: "Open" },
          { value: "CLOSED", label: "Closed" },
        ],
        testIdPrefix: "status",
      },
    ];
    render(
      <FiltersHarness rows={makeRows()} spec={spec} resultRef={ref} />,
    );
    fireEvent.click(screen.getByTestId("status-OPEN"));
    expect(ref.current!.filteredRows).toHaveLength(2);
    fireEvent.click(screen.getByTestId("status-OPEN"));
    expect(ref.current!.filteredRows).toHaveLength(3);
    cleanup();
  });

  it("treats an empty select as 'all'", () => {
    /** the placeholder value '' matches every row. */
    const ref: { current: Snapshot<Row> | null } = { current: null };
    const spec: FilterSpec<Row>[] = [
      {
        kind: "select",
        field: "category",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
        testId: "category",
      },
    ];
    render(
      <FiltersHarness rows={makeRows()} spec={spec} resultRef={ref} />,
    );
    expect(ref.current!.filteredRows).toHaveLength(3);
    fireEvent.change(screen.getByTestId("category"), {
      target: { value: "a" },
    });
    expect(ref.current!.filteredRows.map((r) => r.id)).toEqual(["1", "3"]);
    cleanup();
  });

  it("filters dateRange with from only, to only, and both", () => {
    /** each side of the dateRange is independently optional. */
    const ref: { current: Snapshot<Row> | null } = { current: null };
    const spec: FilterSpec<Row>[] = [
      {
        kind: "dateRange",
        field: "created_at",
        testIdFrom: "from",
        testIdTo: "to",
      },
    ];
    render(
      <FiltersHarness rows={makeRows()} spec={spec} resultRef={ref} />,
    );

    fireEvent.change(screen.getByTestId("from"), {
      target: { value: "2026-03-10" },
    });
    expect(ref.current!.filteredRows.map((r) => r.id)).toEqual(["2", "3"]);

    fireEvent.change(screen.getByTestId("from"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("to"), {
      target: { value: "2026-03-10" },
    });
    expect(ref.current!.filteredRows.map((r) => r.id)).toEqual(["1"]);

    fireEvent.change(screen.getByTestId("from"), {
      target: { value: "2026-03-10" },
    });
    fireEvent.change(screen.getByTestId("to"), {
      target: { value: "2026-03-31" },
    });
    expect(ref.current!.filteredRows.map((r) => r.id)).toEqual(["2"]);
    cleanup();
  });

  it("filters by a boolean checkbox", () => {
    /** checking a boolean filter restricts rows to those whose value is true. */
    const ref: { current: Snapshot<Row> | null } = { current: null };
    const spec: FilterSpec<Row>[] = [
      {
        kind: "boolean",
        field: "archived",
        label: "Archived",
        testId: "archived",
      },
    ];
    render(
      <FiltersHarness rows={makeRows()} spec={spec} resultRef={ref} />,
    );
    expect(ref.current!.filteredRows).toHaveLength(3);
    fireEvent.click(screen.getByTestId("archived"));
    expect(ref.current!.filteredRows.map((r) => r.id)).toEqual(["2"]);
    cleanup();
  });

  it("filters arrayValued pill fields by intersection", () => {
    /** array-valued fields match when any selected pill is in the row's array. */
    const ref: { current: Snapshot<Row> | null } = { current: null };
    const spec: FilterSpec<Row>[] = [
      {
        kind: "pills",
        field: "methods",
        multi: true,
        defaultMode: "none-active",
        arrayValued: true,
        options: [
          { value: "VLOS", label: "VLOS" },
          { value: "BVLOS", label: "BVLOS" },
        ],
        testIdPrefix: "method",
      },
    ];
    render(
      <FiltersHarness rows={makeRows()} spec={spec} resultRef={ref} />,
    );
    fireEvent.click(screen.getByTestId("method-VLOS"));
    expect(ref.current!.filteredRows.map((r) => r.id)).toEqual(["1", "3"]);
    cleanup();
  });

  it("reset clears state for every kind", () => {
    /** reset returns each filter to its declared default. */
    const ref: { current: Snapshot<Row> | null } = { current: null };
    const spec: FilterSpec<Row>[] = [
      { kind: "search", field: "name", testId: "search" },
      {
        kind: "pills",
        field: "status",
        multi: true,
        defaultMode: "all-active",
        options: [
          { value: "OPEN", label: "Open" },
          { value: "CLOSED", label: "Closed" },
        ],
        testIdPrefix: "status",
      },
      {
        kind: "select",
        field: "category",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
        testId: "category",
      },
      {
        kind: "boolean",
        field: "archived",
        label: "Archived",
        testId: "archived",
      },
    ];
    render(
      <FiltersHarness rows={makeRows()} spec={spec} resultRef={ref} />,
    );
    fireEvent.change(screen.getByTestId("search"), {
      target: { value: "Alpha" },
    });
    fireEvent.click(screen.getByTestId("status-OPEN"));
    fireEvent.change(screen.getByTestId("category"), {
      target: { value: "a" },
    });
    fireEvent.click(screen.getByTestId("archived"));
    expect(ref.current!.hasActiveFilters).toBe(true);
    act(() => {
      ref.current!.reset();
    });
    expect(ref.current!.hasActiveFilters).toBe(false);
    expect(ref.current!.filteredRows).toHaveLength(3);
    cleanup();
  });

  it("invokes onFiltersChange when state changes", () => {
    /** the optional callback runs on each filter mutation and on reset. */
    const ref: { current: Snapshot<Row> | null } = { current: null };
    const onChange = vi.fn();
    const spec: FilterSpec<Row>[] = [
      { kind: "search", field: "name", testId: "search" },
    ];
    render(
      <FiltersHarness
        rows={makeRows()}
        spec={spec}
        resultRef={ref}
        onFiltersChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("search"), {
      target: { value: "x" },
    });
    expect(onChange).toHaveBeenCalled();
    onChange.mockClear();
    act(() => {
      ref.current!.reset();
    });
    expect(onChange).toHaveBeenCalled();
    cleanup();
  });
});

describe("useListFiltersAsParams", () => {
  /** server-param hook tests. */

  it("returns the same params reference across renders when state is unchanged", () => {
    /** params is referentially stable so axios callers do not refetch on identity churn. */
    const ref: { current: ParamsSnapshot | null } = { current: null };
    const tick = { current: 0 };
    const spec: FilterSpec<Row>[] = [
      { kind: "search", field: "name" },
      {
        kind: "pills",
        field: "status",
        multi: true,
        defaultMode: "none-active",
        options: [
          { value: "OPEN", label: "Open" },
          { value: "CLOSED", label: "Closed" },
        ],
      },
    ];
    const { rerender } = render(
      <ParamsHarness spec={spec} resultRef={ref} rerenderTickRef={tick} />,
    );
    const first = ref.current!.params;
    tick.current = 1;
    rerender(
      <ParamsHarness spec={spec} resultRef={ref} rerenderTickRef={tick} />,
    );
    expect(ref.current!.params).toBe(first);
    cleanup();
  });

  it("emits a fresh params object when state changes", () => {
    /** mutating a filter produces a params object reflecting the new state. */
    const ref: { current: ParamsSnapshot | null } = { current: null };
    const spec: FilterSpec<Row>[] = [
      { kind: "search", field: "name", testId: "search" },
      {
        kind: "select",
        field: "category",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
        testId: "category",
      },
      {
        kind: "dateRange",
        field: "created_at",
        testIdFrom: "from",
        testIdTo: "to",
      },
    ];
    render(<ParamsHarness spec={spec} resultRef={ref} />);
    fireEvent.change(screen.getByTestId("search"), {
      target: { value: "alpha" },
    });
    expect(ref.current!.params).toEqual({ name: "alpha" });

    fireEvent.change(screen.getByTestId("category"), {
      target: { value: "a" },
    });
    expect(ref.current!.params).toEqual({ name: "alpha", category: "a" });

    fireEvent.change(screen.getByTestId("from"), {
      target: { value: "2026-03-01" },
    });
    expect(ref.current!.params).toEqual({
      name: "alpha",
      category: "a",
      created_at_from: "2026-03-01",
    });
    cleanup();
  });
});
