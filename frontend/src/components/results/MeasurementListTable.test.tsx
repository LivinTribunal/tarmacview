import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import en from "@/i18n/locales/en.json";
import type { MeasurementListItem } from "@/types/measurement";
import type { MeasurementGroup } from "@/hooks/useMeasurementList";
import MeasurementListTable from "./MeasurementListTable";

/** resolve a dotted i18n key against the real en.json bundle. */
function resolveKey(key: string): string {
  const parts = key.split(".");
  let node: unknown = en as unknown;
  for (const p of parts) {
    if (node && typeof node === "object" && p in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  return typeof node === "string" ? node : key;
}

const stableT = (key: string, opts?: unknown) => {
  let s = resolveKey(key);
  if (typeof opts === "string") return s === key ? opts : s;
  if (opts && typeof opts === "object") {
    for (const [k, v] of Object.entries(opts as Record<string, unknown>)) {
      s = s.replace(new RegExp(`{{${k}}}`, "g"), String(v));
    }
  }
  return s;
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT, i18n: { language: "en" } }),
}));

function row(over: Partial<MeasurementListItem>): MeasurementListItem {
  return {
    id: "m1",
    inspection_id: "i1",
    mission_id: "mission-1",
    mission_name: "Demo Mission",
    inspection_method: "HORIZONTAL_RANGE",
    inspection_sequence_order: 1,
    status: "DONE",
    label: null,
    iteration_group_id: null,
    iteration_index: 1,
    created_at: "2026-06-01T10:00:00Z",
    has_results: true,
    pass_count: 3,
    fail_count: 1,
    error_message: null,
    ...over,
  };
}

/** wrap a single run into a one-member group (the collapsed common case). */
function soloGroup(r: MeasurementListItem): MeasurementGroup {
  return { groupId: r.iteration_group_id ?? r.id, representative: r, runs: [r], runCount: 1 };
}

function renderTable(over: Partial<Parameters<typeof MeasurementListTable>[0]> = {}) {
  const props = {
    groups: [soloGroup(row({}))],
    totalRows: 1,
    loading: false,
    error: false,
    sortKey: "created_at" as const,
    sortDir: "desc" as const,
    expandedGroups: new Set<string>(),
    onSort: vi.fn(),
    onToggleExpand: vi.fn(),
    onRowClick: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onRetry: vi.fn(),
    ...over,
  };
  render(<MeasurementListTable {...props} />);
  return props;
}

describe("MeasurementListTable", () => {
  it("renders the operator label when set, else the inspection fallback", () => {
    renderTable({
      groups: [
        soloGroup(row({ id: "named-1", label: "morning re-fly" })),
        soloGroup(row({ id: "plain-1", label: null, inspection_sequence_order: 2 })),
      ],
    });
    const table = screen.getByTestId("measurements-table");
    expect(within(table).getByText("morning re-fly")).toBeInTheDocument();
    expect(within(table).getByText(/Inspection 2/)).toBeInTheDocument();
  });

  it("fires onRename and onDelete from the row actions without selecting the row", () => {
    const props = renderTable({ groups: [soloGroup(row({ id: "r1", label: "named" }))] });

    fireEvent.click(screen.getByTitle(en.measurementsList.actions.rename));
    fireEvent.click(screen.getByTitle(en.measurementsList.actions.delete));

    expect(props.onRename).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r1" }),
    );
    expect(props.onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r1" }),
    );
    // row actions stop propagation - the row itself is not opened
    expect(props.onRowClick).not.toHaveBeenCalled();
  });

  it("collapses an iteration group into one row with a run-count badge", () => {
    const latest = row({ id: "iter-2", iteration_group_id: "iter-1", iteration_index: 2 });
    const root = row({ id: "iter-1", iteration_group_id: "iter-1", iteration_index: 1 });
    renderTable({
      groups: [
        {
          groupId: "iter-1",
          representative: latest,
          runs: [latest, root],
          runCount: 2,
        },
      ],
    });
    // only the representative (latest) row is shown while collapsed
    expect(screen.getByTestId("measurement-row-iter-2")).toBeInTheDocument();
    expect(screen.queryByTestId("measurement-subrow-iter-1")).toBeNull();
    expect(screen.getByTestId("run-count-iter-1")).toHaveTextContent("2 runs");
  });

  it("reveals member runs when the group is expanded", () => {
    const latest = row({ id: "iter-2", iteration_group_id: "iter-1", iteration_index: 2 });
    const root = row({ id: "iter-1", iteration_group_id: "iter-1", iteration_index: 1 });
    renderTable({
      groups: [
        {
          groupId: "iter-1",
          representative: latest,
          runs: [latest, root],
          runCount: 2,
        },
      ],
      expandedGroups: new Set(["iter-1"]),
    });
    expect(screen.getByTestId("measurement-subrow-iter-2")).toBeInTheDocument();
    expect(screen.getByTestId("measurement-subrow-iter-1")).toBeInTheDocument();
  });

  it("toggles a group from the expand chevron", () => {
    const latest = row({ id: "iter-2", iteration_group_id: "iter-1", iteration_index: 2 });
    const root = row({ id: "iter-1", iteration_group_id: "iter-1", iteration_index: 1 });
    const props = renderTable({
      groups: [
        {
          groupId: "iter-1",
          representative: latest,
          runs: [latest, root],
          runCount: 2,
        },
      ],
    });
    fireEvent.click(screen.getByTestId("expand-group-iter-1"));
    expect(props.onToggleExpand).toHaveBeenCalledWith("iter-1");
    // the chevron click does not open the representative row
    expect(props.onRowClick).not.toHaveBeenCalled();
  });
});
