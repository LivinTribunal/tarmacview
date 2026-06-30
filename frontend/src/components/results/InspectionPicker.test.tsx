import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import en from "@/i18n/locales/en.json";
import type { InspectionResponse } from "@/types/mission";
import type { InspectionTemplateResponse } from "@/types/inspectionTemplate";
import type { MeasurementListItem } from "@/types/measurement";
import InspectionPicker from "./InspectionPicker";

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
  const s = resolveKey(key);
  if (typeof opts === "string") return s === key ? opts : s;
  return s;
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: stableT,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

function inspection(over: Partial<InspectionResponse>): InspectionResponse {
  return {
    id: "i1",
    mission_id: "mission-a",
    template_id: "tpl-1",
    config_id: null,
    method: "HORIZONTAL_RANGE",
    sequence_order: 1,
    lha_ids: null,
    config: null,
    ...over,
  };
}

function listRow(over: Partial<MeasurementListItem>): MeasurementListItem {
  return {
    id: "m1",
    inspection_id: "i1",
    mission_id: "mission-a",
    mission_name: "Alpha",
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

const templates = new Map<string, InspectionTemplateResponse>([
  [
    "tpl-1",
    {
      id: "tpl-1",
      name: "PAPI North",
      description: null,
      angular_tolerances: null,
      created_by: null,
      created_at: null,
      updated_at: null,
      default_config: null,
      target_agl_ids: [],
      methods: ["HORIZONTAL_RANGE"],
      mission_count: 0,
    },
  ],
]);

const inspections = [
  inspection({ id: "i1", sequence_order: 1 }),
  inspection({ id: "i2", sequence_order: 2 }),
];

describe("InspectionPicker", () => {
  it("renders one row per inspection", () => {
    render(
      <InspectionPicker
        inspections={inspections}
        templates={templates}
        measurementByInspection={new Map([["i1", listRow({})]])}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("results-inspection-row-i1")).toBeInTheDocument();
    expect(screen.getByTestId("results-inspection-row-i2")).toBeInTheDocument();
  });

  it("fires onSelect and shows the pass/total rollup for a DONE row", () => {
    const onSelect = vi.fn();
    render(
      <InspectionPicker
        inspections={inspections}
        templates={templates}
        measurementByInspection={new Map([["i1", listRow({})]])}
        selectedId={null}
        onSelect={onSelect}
      />,
    );
    const row = screen.getByTestId("results-inspection-row-i1");
    expect(within(row).getByText("3/4")).toBeInTheDocument();
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith("i1");
  });

  it("disables an un-measured row and tags it not measured", () => {
    const onSelect = vi.fn();
    render(
      <InspectionPicker
        inspections={inspections}
        templates={templates}
        measurementByInspection={new Map([["i1", listRow({})]])}
        selectedId={null}
        onSelect={onSelect}
      />,
    );
    const row = screen.getByTestId("results-inspection-row-i2");
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(within(row).getByText("Not measured")).toBeInTheDocument();
    fireEvent.click(row);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
