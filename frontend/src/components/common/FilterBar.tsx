import { useTranslation } from "react-i18next";
import type { FilterSpec, FilterValue } from "./filterSpec";

type FilterBarProps<T> = {
  spec: FilterSpec<T>[];
  state: FilterValue[];
  onChange: (index: number, next: FilterValue) => void;
  onReset: () => void;
  hasActiveFilters: boolean;
  testId?: string;
};

/** spec-driven filter bar; renders search, pills, select, dateRange, boolean. */
export default function FilterBar<T>({
  spec,
  state,
  onChange,
  onReset,
  hasActiveFilters,
  testId,
}: FilterBarProps<T>) {
  const { t } = useTranslation();

  const leftIndices: number[] = [];
  const rightIndices: number[] = [];
  spec.forEach((s, i) => {
    if (s.kind === "search" || s.kind === "pills") leftIndices.push(i);
    else rightIndices.push(i);
  });

  /** render a single spec entry from its current value. */
  function renderEntry(i: number) {
    const s = spec[i];
    const v = state[i];
    if (!s || !v) return null;

    if (s.kind === "search" && v.kind === "search") {
      return (
        <input
          key={i}
          type="text"
          value={v.value}
          placeholder={s.placeholder ?? t("common.search")}
          aria-label={s.placeholder ?? t("common.search")}
          onChange={(e) =>
            onChange(i, { kind: "search", value: e.target.value })
          }
          className="rounded-full border border-tv-border bg-tv-bg px-3 py-1 text-xs
            text-tv-text-primary focus:outline-none focus:border-tv-accent"
          data-testid={s.testId}
        />
      );
    }

    if (s.kind === "pills" && v.kind === "pills") {
      const active = v.active;
      const hasBadgeStyle = !!s.badgeStyle;
      return (
        <div key={i} className="flex items-center gap-1.5 flex-wrap">
          {s.options.map((opt) => {
            const isActive = active.has(opt.value);
            // when a badgeStyle is provided, render every pill in its color
            // identity and dim non-selected ones once a filter is active.
            // mirrors the pre-template inspection-pill behaviour.
            const inlineStyle = s.badgeStyle ? s.badgeStyle(opt.value) : undefined;
            const dim = hasBadgeStyle && active.size > 0 && !isActive;
            const baseClass = "rounded-full px-3 py-1 text-xs font-semibold transition-colors";
            const className = hasBadgeStyle
              ? `${baseClass}${dim ? " opacity-40" : ""}`
              : `${baseClass} ${
                  isActive
                    ? "bg-tv-accent text-tv-accent-text"
                    : "bg-tv-bg text-tv-text-muted hover:text-tv-text-secondary"
                }`;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  const next = new Set(active);
                  if (s.multi) {
                    // from the all-active default, first click isolates the
                    // clicked option; further clicks toggle additions back in
                    // until the full set is restored
                    const allActive = active.size === s.options.length;
                    if (s.defaultMode === "all-active" && allActive) {
                      next.clear();
                      next.add(opt.value);
                    } else if (next.has(opt.value)) {
                      next.delete(opt.value);
                    } else {
                      next.add(opt.value);
                    }
                  } else {
                    if (next.has(opt.value)) {
                      next.clear();
                    } else {
                      next.clear();
                      next.add(opt.value);
                    }
                  }
                  onChange(i, { kind: "pills", active: next });
                }}
                style={inlineStyle}
                className={className}
                data-testid={
                  s.testIdPrefix
                    ? `${s.testIdPrefix}-${opt.value}`
                    : undefined
                }
                aria-pressed={isActive}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      );
    }

    if (s.kind === "select" && v.kind === "select") {
      return (
        <select
          key={i}
          value={v.value}
          onChange={(e) =>
            onChange(i, { kind: "select", value: e.target.value })
          }
          className="rounded-full border border-tv-border bg-tv-bg px-3 py-1 text-xs
            text-tv-text-primary focus:outline-none focus:border-tv-accent"
          data-testid={s.testId}
        >
          <option value="">{s.placeholder ?? t("common.filters.all")}</option>
          {s.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    }

    if (s.kind === "dateRange" && v.kind === "dateRange") {
      return (
        <div key={i} className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <label className="text-xs text-tv-text-secondary">
              {s.labelFrom ?? t("common.filters.from")}
            </label>
            <input
              type="date"
              value={v.from}
              aria-label={s.labelFrom ?? t("common.filters.from")}
              onChange={(e) =>
                onChange(i, {
                  kind: "dateRange",
                  from: e.target.value,
                  to: v.to,
                })
              }
              className="rounded-full border border-tv-border bg-tv-bg px-3 py-1 text-xs
                text-tv-text-primary focus:outline-none focus:border-tv-accent"
              data-testid={s.testIdFrom}
            />
          </div>
          <div className="flex items-center gap-1">
            <label className="text-xs text-tv-text-secondary">
              {s.labelTo ?? t("common.filters.to")}
            </label>
            <input
              type="date"
              value={v.to}
              aria-label={s.labelTo ?? t("common.filters.to")}
              onChange={(e) =>
                onChange(i, {
                  kind: "dateRange",
                  from: v.from,
                  to: e.target.value,
                })
              }
              className="rounded-full border border-tv-border bg-tv-bg px-3 py-1 text-xs
                text-tv-text-primary focus:outline-none focus:border-tv-accent"
              data-testid={s.testIdTo}
            />
          </div>
        </div>
      );
    }

    if (s.kind === "boolean" && v.kind === "boolean") {
      return (
        <label
          key={i}
          className="flex items-center gap-2 text-xs text-tv-text-secondary"
        >
          <input
            type="checkbox"
            checked={v.value === true}
            onChange={(e) =>
              onChange(i, {
                kind: "boolean",
                value: e.target.checked ? true : null,
              })
            }
            data-testid={s.testId}
          />
          {s.label}
        </label>
      );
    }

    return null;
  }

  const hasLeft = leftIndices.length > 0;
  const hasRight = rightIndices.length > 0;

  return (
    <div
      className="flex items-center rounded-2xl border border-tv-border bg-tv-surface px-3 py-2 gap-x-2 gap-y-2 flex-wrap"
      data-testid={testId}
    >
      {hasLeft && (
        <div className="flex flex-1 items-center gap-1.5 flex-wrap">
          {leftIndices.map((i) => renderEntry(i))}
        </div>
      )}
      {hasRight && (
        <div className="flex items-center gap-2 flex-wrap">
          {rightIndices.map((i) => renderEntry(i))}
        </div>
      )}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onReset}
          aria-label={t("common.filters.reset")}
          className="rounded-full border border-tv-border bg-tv-bg px-3 py-1 text-xs font-semibold
            text-tv-text-primary hover:bg-tv-surface-hover focus:outline-none focus:border-tv-accent"
          data-testid="filter-bar-reset"
        >
          {t("common.reset")}
        </button>
      )}
    </div>
  );
}
