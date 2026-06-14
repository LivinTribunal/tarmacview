import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import UserAssignedAirportsPanel from "./UserAssignedAirportsPanel";
import type { AirportSummary } from "@/types/auth";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { name?: string }) => (opts?.name ? `${k}:${opts.name}` : k),
    i18n: { language: "en" },
  }),
}));

const ASSIGNED: AirportSummary = { id: "apt-1", icao_code: "AAAA", name: "Alpha" };
const ORPHAN: AirportSummary = { id: "apt-2", icao_code: "BBBB", name: "Beta" };

function setup(over: Partial<React.ComponentProps<typeof UserAssignedAirportsPanel>> = {}) {
  const props = {
    assignedAirports: [ASSIGNED],
    allAirports: [ASSIGNED, ORPHAN],
    onAddAirport: vi.fn(),
    onRemoveAirport: vi.fn(),
    ...over,
  };
  render(
    <MemoryRouter>
      <UserAssignedAirportsPanel {...props} />
    </MemoryRouter>,
  );
  return props;
}

describe("UserAssignedAirportsPanel", () => {
  it("renders assigned airports with a deep link to airport detail and a count", () => {
    setup();
    expect(screen.getByTestId("user-assigned-airports")).toBeInTheDocument();
    const link = screen.getByText("Alpha");
    expect(link).toHaveAttribute("href", "/super-admin/airports/apt-1");
    expect(screen.getByText("AAAA")).toBeInTheDocument();
    // count badge reflects the assigned set
    expect(screen.getByTestId("assigned-airports-count")).toHaveTextContent("1");
  });

  it("fires onRemoveAirport from the accessible remove control", () => {
    const props = setup();
    // aria-label is interpolated with the airport name so rows are distinguishable
    fireEvent.click(screen.getByLabelText("admin.removeAirportNamed:Alpha"));
    expect(props.onRemoveAirport).toHaveBeenCalledWith("apt-1");
  });

  it("lists unassigned airports (including an orphan with no assignees) and adds on select", () => {
    const props = setup();
    const select = screen.getByTestId("add-airport-select");
    // the orphaned airport is selectable even though it has no current assignees
    expect(screen.getByRole("option", { name: "Beta (BBBB)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Alpha (AAAA)" })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: "apt-2" } });
    expect(props.onAddAirport).toHaveBeenCalledWith("apt-2");
  });

  it("shows the empty state and no remove controls when nothing is assigned", () => {
    setup({ assignedAirports: [] });
    expect(screen.getByText("admin.noAirportsAssigned")).toBeInTheDocument();
    expect(screen.queryByLabelText("admin.removeAirportNamed:Alpha")).not.toBeInTheDocument();
  });

  it("hides the add dropdown when every airport is already assigned", () => {
    setup({ assignedAirports: [ASSIGNED, ORPHAN] });
    expect(screen.queryByTestId("add-airport-select")).not.toBeInTheDocument();
  });
});
