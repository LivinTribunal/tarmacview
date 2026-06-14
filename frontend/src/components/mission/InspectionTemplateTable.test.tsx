import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import InspectionTemplateTable from "./InspectionTemplateTable";
import type { InspectionTemplateResponse } from "@/types/inspectionTemplate";
import type { AGLResponse } from "@/types/airport";

function makeTemplate(
  id: string,
  name: string,
  overrides: Partial<InspectionTemplateResponse> = {},
): InspectionTemplateResponse {
  return {
    id,
    name,
    description: null,
    angular_tolerances: null,
    created_by: null,
    created_at: "2026-03-01T10:00:00Z",
    updated_at: "2026-03-05T14:30:00Z",
    default_config: null,
    target_agl_ids: [],
    methods: ["VERTICAL_PROFILE"],
    mission_count: 0,
    ...overrides,
  };
}

function renderTable(templates: InspectionTemplateResponse[]) {
  return render(
    <InspectionTemplateTable
      templates={templates}
      aglMap={new Map<string, AGLResponse>()}
      onRowClick={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
      page={1}
      pageSize={10}
    />,
  );
}

describe("InspectionTemplateTable", () => {
  it("toggles the active-column chevron asc -> desc on repeated header clicks", () => {
    /** the module-scope SortIcon must render an up chevron on first sort
     *  and a down chevron after a second click on the same column. */
    renderTable([makeTemplate("t-1", "Bravo"), makeTemplate("t-2", "Alpha")]);

    const nameHeader = screen.getByText("coordinator.inspections.columns.name")
      .closest("th") as HTMLElement;

    // default sort is name asc -> up chevron present
    expect(nameHeader.querySelector(".lucide-chevron-up")).toBeInTheDocument();
    expect(nameHeader.querySelector(".lucide-chevron-down")).toBeNull();

    // click flips to desc -> down chevron
    fireEvent.click(nameHeader);
    expect(nameHeader.querySelector(".lucide-chevron-down")).toBeInTheDocument();
    expect(nameHeader.querySelector(".lucide-chevron-up")).toBeNull();
  });

  it("shows the chevron only on the active sort column", () => {
    /** SortIcon returns null for non-active columns. */
    renderTable([makeTemplate("t-1", "Alpha")]);

    const methodHeader = screen
      .getByText("coordinator.inspections.columns.method")
      .closest("th") as HTMLElement;
    expect(methodHeader.querySelector(".lucide-chevron-up")).toBeNull();
    expect(methodHeader.querySelector(".lucide-chevron-down")).toBeNull();
  });

  it("orders rows by name and reverses them when the header is clicked", () => {
    /** sanity check that the lifted SortIcon did not disturb sort behavior. */
    renderTable([makeTemplate("t-1", "Bravo"), makeTemplate("t-2", "Alpha")]);

    const firstRow = () =>
      within(screen.getByTestId("template-table")).getAllByRole("row")[1];
    expect(firstRow()).toHaveTextContent("Alpha");

    fireEvent.click(
      screen.getByText("coordinator.inspections.columns.name").closest("th")!,
    );
    expect(firstRow()).toHaveTextContent("Bravo");
  });
});
