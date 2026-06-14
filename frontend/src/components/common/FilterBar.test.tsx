import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import FilterBar from "./FilterBar";
import {
  defaultFilterState,
  isFilterAtDefault,
  type FilterSpec,
  type FilterValue,
} from "./filterSpec";

type Row = {
  name: string;
  status: string;
  category: string;
  created_at: string;
  archived: boolean;
};

const fullSpec: FilterSpec<Row>[] = [
  {
    kind: "search",
    field: "name",
    placeholder: "search...",
    testId: "search-input",
  },
  {
    kind: "pills",
    field: "status",
    multi: true,
    defaultMode: "all-active",
    options: [
      { value: "OPEN", label: "Open" },
      { value: "CLOSED", label: "Closed" },
    ],
    testIdPrefix: "status-pill",
  },
  {
    kind: "select",
    field: "category",
    options: [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ],
    testId: "category-select",
  },
  {
    kind: "dateRange",
    field: "created_at",
    testIdFrom: "date-from",
    testIdTo: "date-to",
  },
  {
    kind: "boolean",
    field: "archived",
    label: "Archived",
    testId: "archived-checkbox",
  },
];

/** wrapper that drives the controlled FilterBar via local state. */
function Harness({
  spec,
  initial,
  onState,
}: {
  spec: FilterSpec<Row>[];
  initial?: FilterValue[];
  onState?: (s: FilterValue[]) => void;
}) {
  const [state, setState] = useState<FilterValue[]>(
    initial ?? defaultFilterState(spec),
  );
  const hasActive = spec.some((s, i) => !isFilterAtDefault(s, state[i]));
  return (
    <FilterBar
      spec={spec}
      state={state}
      onChange={(i, next) =>
        setState((prev) => {
          const updated = prev.map((v, idx) => (idx === i ? next : v));
          onState?.(updated);
          return updated;
        })
      }
      onReset={() => {
        const def = defaultFilterState(spec);
        onState?.(def);
        setState(def);
      }}
      hasActiveFilters={hasActive}
    />
  );
}

describe("FilterBar", () => {
  /** spec-driven filter bar tests. */

  it("renders each filter kind from a spec", () => {
    /** every kind in the spec produces a corresponding control. */
    render(<Harness spec={fullSpec} />);
    expect(screen.getByTestId("search-input")).toBeInTheDocument();
    expect(screen.getByTestId("status-pill-OPEN")).toBeInTheDocument();
    expect(screen.getByTestId("status-pill-CLOSED")).toBeInTheDocument();
    expect(screen.getByTestId("category-select")).toBeInTheDocument();
    expect(screen.getByTestId("date-from")).toBeInTheDocument();
    expect(screen.getByTestId("date-to")).toBeInTheDocument();
    expect(screen.getByTestId("archived-checkbox")).toBeInTheDocument();
  });

  it("isolates the clicked pill on first click from the all-active default", () => {
    /** from the all-active default, clicking a pill keeps only that pill active. */
    render(<Harness spec={fullSpec} />);
    const open = screen.getByTestId("status-pill-OPEN");
    const closed = screen.getByTestId("status-pill-CLOSED");
    expect(open.className).not.toContain("text-tv-text-muted");
    expect(closed.className).not.toContain("text-tv-text-muted");
    fireEvent.click(open);
    expect(open.className).not.toContain("text-tv-text-muted");
    expect(closed.className).toContain("text-tv-text-muted");
  });

  it("re-adds pills one by one until the default is restored", () => {
    /** after isolating a pill, clicking other inactive pills adds them back. */
    render(<Harness spec={fullSpec} />);
    const open = screen.getByTestId("status-pill-OPEN");
    const closed = screen.getByTestId("status-pill-CLOSED");
    fireEvent.click(open);
    expect(closed.className).toContain("text-tv-text-muted");
    fireEvent.click(closed);
    expect(open.className).not.toContain("text-tv-text-muted");
    expect(closed.className).not.toContain("text-tv-text-muted");
    expect(screen.queryByTestId("filter-bar-reset")).not.toBeInTheDocument();
  });

  it("toggles an active pill off after the default has been broken", () => {
    /** once not in default state, clicking an active pill removes it. */
    render(<Harness spec={fullSpec} />);
    const open = screen.getByTestId("status-pill-OPEN");
    fireEvent.click(open);
    expect(open.className).not.toContain("text-tv-text-muted");
    fireEvent.click(open);
    expect(open.className).toContain("text-tv-text-muted");
  });

  it("does not show the reset button at default state", () => {
    /** reset is hidden until something is non-default. */
    render(<Harness spec={fullSpec} />);
    expect(screen.queryByTestId("filter-bar-reset")).not.toBeInTheDocument();
  });

  it("shows the reset button once any filter is non-default", () => {
    /** reset appears when hasActiveFilters becomes true. */
    render(<Harness spec={fullSpec} />);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "abc" },
    });
    expect(screen.getByTestId("filter-bar-reset")).toBeInTheDocument();
  });

  it("reset button is keyboard-focusable", () => {
    /** the reset button is a real button so it tab-focuses and accepts Enter. */
    const onState = vi.fn();
    render(<Harness spec={fullSpec} onState={onState} />);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "abc" },
    });
    onState.mockClear();
    const resetBtn = screen.getByTestId("filter-bar-reset");
    expect(resetBtn.tagName).toBe("BUTTON");
    resetBtn.focus();
    expect(document.activeElement).toBe(resetBtn);
    fireEvent.click(resetBtn);
    expect(onState).toHaveBeenCalled();
  });
});
