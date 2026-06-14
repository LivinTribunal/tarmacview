import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import useListSort, { type SortComparator } from "./useListSort";

type Row = { id: string; name: string; count: number };

const ROWS: Row[] = [
  { id: "1", name: "Charlie", count: 30 },
  { id: "2", name: "Alpha", count: 10 },
  { id: "3", name: "Bravo", count: 20 },
];

const cmp: SortComparator<Row, "name" | "count"> = (a, b, key) => {
  if (key === "count") return a.count - b.count;
  return a.name.localeCompare(b.name);
};

describe("useListSort", () => {
  it("sorts ascending by default key", () => {
    /** asc dir over the default key produces a stable ordering. */
    const { result } = renderHook(() => useListSort(ROWS, "name", cmp));
    expect(result.current.sortedRows.map((r) => r.id)).toEqual(["2", "3", "1"]);
    expect(result.current.sortKey).toBe("name");
    expect(result.current.sortDir).toBe("asc");
  });

  it("sorts descending when defaultDir is 'desc'", () => {
    /** explicit defaultDir override yields the reverse ordering. */
    const { result } = renderHook(() =>
      useListSort(ROWS, "count", cmp, "desc"),
    );
    expect(result.current.sortedRows.map((r) => r.id)).toEqual(["1", "3", "2"]);
    expect(result.current.sortDir).toBe("desc");
  });

  it("toggles direction when the same key is clicked twice", () => {
    /** clicking the active key flips the direction. */
    const { result } = renderHook(() => useListSort(ROWS, "name", cmp));
    act(() => result.current.handleSort("name"));
    expect(result.current.sortDir).toBe("desc");
    expect(result.current.sortedRows.map((r) => r.id)).toEqual(["1", "3", "2"]);
    act(() => result.current.handleSort("name"));
    expect(result.current.sortDir).toBe("asc");
  });

  it("resets direction to asc when switching keys", () => {
    /** switching to a new key starts at asc regardless of previous dir. */
    const { result } = renderHook(() =>
      useListSort<Row, "name" | "count">(ROWS, "name", cmp, "desc"),
    );
    expect(result.current.sortDir).toBe("desc");
    act(() => result.current.handleSort("count"));
    expect(result.current.sortKey).toBe("count");
    expect(result.current.sortDir).toBe("asc");
    expect(result.current.sortedRows.map((r) => r.id)).toEqual(["2", "3", "1"]);
  });

  it("returns referentially stable sortedRows when state is unchanged", () => {
    /** memoization keeps the array identity stable across no-op renders. */
    const { result, rerender } = renderHook(() =>
      useListSort(ROWS, "name", cmp),
    );
    const first = result.current.sortedRows;
    rerender();
    expect(result.current.sortedRows).toBe(first);
  });

  it("supports a custom comparator", () => {
    /** the comparator is dispatched per key as supplied by the caller. */
    const reverseCmp: SortComparator<Row, "name"> = (a, b) =>
      b.name.localeCompare(a.name);
    const { result } = renderHook(() =>
      useListSort(ROWS, "name", reverseCmp),
    );
    expect(result.current.sortedRows.map((r) => r.id)).toEqual(["1", "3", "2"]);
  });

  it("starts at desc when switching to a numericKey", () => {
    /** numeric columns (counts, dates) feel natural largest-first on first click. */
    const { result } = renderHook(() =>
      useListSort<Row, "name" | "count">(ROWS, "name", cmp, "asc", ["count"]),
    );
    expect(result.current.sortDir).toBe("asc");
    act(() => result.current.handleSort("count"));
    expect(result.current.sortKey).toBe("count");
    expect(result.current.sortDir).toBe("desc");
    expect(result.current.sortedRows.map((r) => r.id)).toEqual(["1", "3", "2"]);
  });

  it("still starts at asc when switching to a non-numeric key", () => {
    /** string columns keep alphabetical-asc as the natural default. */
    const { result } = renderHook(() =>
      useListSort<Row, "name" | "count">(
        ROWS,
        "count",
        cmp,
        "desc",
        ["count"],
      ),
    );
    expect(result.current.sortDir).toBe("desc");
    act(() => result.current.handleSort("name"));
    expect(result.current.sortKey).toBe("name");
    expect(result.current.sortDir).toBe("asc");
  });
});
