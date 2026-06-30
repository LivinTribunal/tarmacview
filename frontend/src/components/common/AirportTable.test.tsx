import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AirportTable, { compareAirport, type AirportSortKey } from "./AirportTable";
import type { AirportSummaryResponse } from "@/types/airport";

function makeAirport(
  overrides: Partial<AirportSummaryResponse> &
    Pick<AirportSummaryResponse, "id" | "icao_code" | "name">,
): AirportSummaryResponse {
  return {
    city: null,
    country: null,
    elevation: 100,
    location: { type: "Point", coordinates: [17.0, 48.0, 100] },
    default_drone_profile_id: null,
    terrain_source: "FLAT",
    has_dem: false,
    surfaces_count: 0,
    agls_count: 0,
    missions_count: 0,
    ...overrides,
  };
}

const A = makeAirport({ id: "a", icao_code: "LZIB", name: "Bratislava", surfaces_count: 2 });
const B = makeAirport({ id: "b", icao_code: "EPWA", name: "Warsaw", surfaces_count: 5 });

const COLUMNS: { key: AirportSortKey; label: string }[] = [
  { key: "icao_code", label: "icao" },
  { key: "surfaces_count", label: "runways" },
];

type Props = React.ComponentProps<typeof AirportTable>;

function renderTable(overrides: Partial<Props> = {}) {
  const props: Props = {
    columns: COLUMNS,
    rows: [A, B],
    sortKey: "icao_code",
    sortDir: "asc",
    onSort: vi.fn(),
    onRowClick: vi.fn(),
    loading: false,
    error: false,
    emptyMessage: "empty",
    loadErrorMessage: "load-error",
    onRetry: vi.fn(),
    ...overrides,
  };
  return { ...render(<AirportTable {...props} />), props };
}

describe("AirportTable", () => {
  it("renders rows, fires onRowClick and onSort", () => {
    const { props } = renderTable();
    expect(screen.getByTestId("airport-row-a")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("airport-row-a"));
    expect(props.onRowClick).toHaveBeenCalledWith(A);
    fireEvent.click(screen.getByText("runways"));
    expect(props.onSort).toHaveBeenCalledWith("surfaces_count");
  });

  it("renders loading, error (+retry), and empty branches", () => {
    const { container, unmount } = renderTable({ loading: true });
    expect(container.querySelector("svg.animate-spin")).toBeInTheDocument();
    unmount();

    const onRetry = vi.fn();
    const r2 = renderTable({ error: true, onRetry });
    expect(screen.getByText("load-error")).toBeInTheDocument();
    fireEvent.click(screen.getByText("common.retry"));
    expect(onRetry).toHaveBeenCalled();
    r2.unmount();

    renderTable({ rows: [] });
    expect(screen.getByText("empty")).toBeInTheDocument();
  });
});

describe("compareAirport", () => {
  it("orders numbers ascending", () => {
    expect(compareAirport(A, B, "surfaces_count")).toBeLessThan(0);
    expect(compareAirport(B, A, "surfaces_count")).toBeGreaterThan(0);
  });

  it("orders strings via localeCompare", () => {
    // EPWA < LZIB
    expect(compareAirport(B, A, "icao_code")).toBeLessThan(0);
  });

  it("sorts null cells last in ascending order", () => {
    const withCity = makeAirport({ id: "c", icao_code: "AAAA", name: "X", city: "Aaa" });
    const nullCity = makeAirport({ id: "d", icao_code: "BBBB", name: "Y", city: null });
    expect(compareAirport(nullCity, withCity, "city")).toBe(1);
    expect(compareAirport(withCity, nullCity, "city")).toBe(-1);
    expect(compareAirport(nullCity, nullCity, "city")).toBe(0);
  });
});
