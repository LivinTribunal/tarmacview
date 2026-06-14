import type { CSSProperties } from "react";

/** shared types and helpers for the spec-driven filter template. */

export type FilterOption = { value: string; label: string };

export type BadgeStyle = CSSProperties;

export type FilterSpec<T> =
  | {
      kind: "search";
      field: keyof T | ((row: T) => string);
      placeholder?: string;
      testId?: string;
      paramKey?: string;
    }
  | {
      kind: "pills";
      field: keyof T;
      options: FilterOption[];
      multi: boolean;
      defaultMode: "all-active" | "none-active";
      badgeStyle?: (value: string) => BadgeStyle;
      arrayValued?: boolean;
      testIdPrefix?: string;
      paramKey?: string;
    }
  | {
      kind: "select";
      field: keyof T;
      options: FilterOption[];
      placeholder?: string;
      testId?: string;
      paramKey?: string;
      arrayValued?: boolean;
    }
  | {
      kind: "dateRange";
      field: keyof T;
      labelFrom?: string;
      labelTo?: string;
      testIdFrom?: string;
      testIdTo?: string;
      paramKey?: string;
    }
  | {
      kind: "boolean";
      field: keyof T | ((row: T) => boolean);
      label: string;
      testId?: string;
      paramKey?: string;
    };

export type FilterValue =
  | { kind: "search"; value: string }
  | { kind: "pills"; active: Set<string> }
  | { kind: "select"; value: string }
  | { kind: "dateRange"; from: string; to: string }
  | { kind: "boolean"; value: boolean | null };

/** build the default state array from a spec (one value per spec entry). */
export function defaultFilterState<T>(spec: FilterSpec<T>[]): FilterValue[] {
  return spec.map((s): FilterValue => {
    switch (s.kind) {
      case "search":
        return { kind: "search", value: "" };
      case "pills":
        return {
          kind: "pills",
          active:
            s.defaultMode === "all-active"
              ? new Set(s.options.map((o) => o.value))
              : new Set(),
        };
      case "select":
        return { kind: "select", value: "" };
      case "dateRange":
        return { kind: "dateRange", from: "", to: "" };
      case "boolean":
        return { kind: "boolean", value: null };
    }
  });
}

/** check whether a single filter is at its default value. */
export function isFilterAtDefault<T>(s: FilterSpec<T>, v: FilterValue): boolean {
  switch (s.kind) {
    case "search":
      return v.kind === "search" && v.value === "";
    case "pills": {
      if (v.kind !== "pills") return false;
      if (s.defaultMode === "all-active") {
        return (
          v.active.size === s.options.length &&
          s.options.every((o) => v.active.has(o.value))
        );
      }
      return v.active.size === 0;
    }
    case "select":
      return v.kind === "select" && v.value === "";
    case "dateRange":
      return v.kind === "dateRange" && v.from === "" && v.to === "";
    case "boolean":
      return v.kind === "boolean" && v.value === null;
  }
}

/** build a row predicate for a single filter; returns true if the row matches. */
export function rowMatches<T>(
  s: FilterSpec<T>,
  v: FilterValue,
  row: T,
): boolean {
  switch (s.kind) {
    case "search": {
      if (v.kind !== "search" || v.value === "") return true;
      const q = v.value.toLowerCase();
      const raw =
        typeof s.field === "function"
          ? s.field(row)
          : String(row[s.field as keyof T] ?? "");
      return raw.toLowerCase().includes(q);
    }
    case "pills": {
      if (v.kind !== "pills" || v.active.size === 0) return true;
      const fieldVal = row[s.field];
      if (s.arrayValued) {
        if (!Array.isArray(fieldVal)) return false;
        return (fieldVal as unknown[]).some(
          (x) => typeof x === "string" && v.active.has(x),
        );
      }
      return typeof fieldVal === "string" && v.active.has(fieldVal);
    }
    case "select": {
      if (v.kind !== "select" || v.value === "") return true;
      const fieldVal = row[s.field];
      if (s.arrayValued) {
        if (!Array.isArray(fieldVal)) return false;
        return (fieldVal as unknown[]).some(
          (x) => typeof x === "string" && x === v.value,
        );
      }
      return String(fieldVal ?? "") === v.value;
    }
    case "dateRange": {
      if (v.kind !== "dateRange" || (v.from === "" && v.to === "")) return true;
      const raw = row[s.field];
      if (raw == null) return false;
      const day = new Date(String(raw)).toISOString().slice(0, 10);
      if (v.from && day < v.from) return false;
      if (v.to && day > v.to) return false;
      return true;
    }
    case "boolean": {
      if (v.kind !== "boolean" || v.value === null) return true;
      const raw =
        typeof s.field === "function"
          ? s.field(row)
          : Boolean(row[s.field as keyof T]);
      return raw === v.value;
    }
  }
}

/** resolve the query-param key for a spec entry. */
function paramKeyFor<T>(s: FilterSpec<T>): string {
  if (s.paramKey) return s.paramKey;
  if ("field" in s && typeof s.field !== "function") return String(s.field);
  throw new Error("filterSpec: function-typed field requires explicit paramKey");
}

/** convert filter state into a flat object suitable for axios query params. */
export function filterStateToParams<T>(
  spec: FilterSpec<T>[],
  state: FilterValue[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  spec.forEach((s, i) => {
    const v = state[i];
    if (!v) return;
    switch (s.kind) {
      case "search": {
        if (v.kind === "search" && v.value !== "") {
          out[paramKeyFor(s)] = v.value;
        }
        break;
      }
      case "pills": {
        if (v.kind === "pills" && v.active.size > 0) {
          const arr = Array.from(v.active).sort();
          out[paramKeyFor(s)] = s.multi ? arr : arr[0];
        }
        break;
      }
      case "select": {
        if (v.kind === "select" && v.value !== "") {
          out[paramKeyFor(s)] = v.value;
        }
        break;
      }
      case "dateRange": {
        const key = paramKeyFor(s);
        if (v.kind === "dateRange") {
          if (v.from) out[`${key}_from`] = v.from;
          if (v.to) out[`${key}_to`] = v.to;
        }
        break;
      }
      case "boolean": {
        if (v.kind === "boolean" && v.value !== null) {
          out[paramKeyFor(s)] = v.value;
        }
        break;
      }
    }
  });
  return out;
}

