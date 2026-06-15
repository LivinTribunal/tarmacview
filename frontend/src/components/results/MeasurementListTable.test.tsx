import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import en from "@/i18n/locales/en.json";
import type { MeasurementListItem } from "@/types/measurement";
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
    created_at: "2026-06-01T10:00:00Z",
    has_results: true,
    pass_count: 3,
    fail_count: 1,
    error_message: null,
    ...over,
  };
}

function renderTable(over: Partial<Parameters<typeof MeasurementListTable>[0]> = {}) {
  const props = {
    rows: [row({})],
    totalRows: 1,
    loading: false,
    error: false,
    sortKey: "created_at" as const,
    sortDir: "desc" as const,
    onSort: vi.fn(),
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
      rows: [
        row({ id: "named-1", label: "morning re-fly" }),
        row({ id: "plain-1", label: null, inspection_sequence_order: 2 }),
      ],
    });
    const table = screen.getByTestId("measurements-table");
    expect(within(table).getByText("morning re-fly")).toBeInTheDocument();
    expect(within(table).getByText(/Inspection 2/)).toBeInTheDocument();
  });

  it("fires onRename and onDelete from the row actions without selecting the row", () => {
    const props = renderTable({ rows: [row({ id: "r1", label: "named" })] });

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
});
