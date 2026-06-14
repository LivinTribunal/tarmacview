import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { AirportProvider } from "@/contexts/AirportContext";
import type { AirportSummaryResponse } from "@/types/airport";
import AirportListPage from "./AirportListPage";

const mockListAirportSummaries = vi.fn();

vi.mock("@/api/airports", () => ({
  listAirportSummaries: (...args: unknown[]) => mockListAirportSummaries(...args),
  getAirport: vi.fn(),
  createAirport: vi.fn(),
  lookupAirport: vi.fn(),
}));

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

// four airports exercising string, numeric, and null comparator branches
const BRATISLAVA = makeAirport({
  id: "a-blava",
  icao_code: "LZIB",
  name: "Bratislava",
  city: "Bratislava",
  country: "Slovakia",
  surfaces_count: 2,
  agls_count: 5,
  missions_count: 1,
});
const KOSICE = makeAirport({
  id: "a-kosice",
  icao_code: "LZKZ",
  name: "Kosice",
  city: null,
  country: "Slovakia",
  surfaces_count: 1,
  agls_count: 0,
  missions_count: 3,
});
const WARSAW = makeAirport({
  id: "a-warsaw",
  icao_code: "EPWA",
  name: "Warsaw",
  city: "Warsaw",
  country: "Poland",
  surfaces_count: 3,
  agls_count: 2,
  missions_count: 0,
});
const VIENNA = makeAirport({
  id: "a-vienna",
  icao_code: "LOWW",
  name: "Vienna",
  city: null,
  country: "Austria",
  surfaces_count: 0,
  agls_count: 1,
  missions_count: 2,
});

// 12 single-country rows for pagination tests (DEFAULT_PAGE_SIZE is 10)
const PAGED = Array.from({ length: 12 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return makeAirport({
    id: `a-${n}`,
    icao_code: `AP${n}`,
    name: `Airport ${n}`,
    city: "Capital",
    country: "Slovakia",
  });
});

function renderPage() {
  return render(
    <ThemeProvider>
      <AuthProvider>
        <AirportProvider>
          <MemoryRouter>
            <AirportListPage />
          </MemoryRouter>
        </AirportProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
}

function rowIds(): (string | null)[] {
  return screen
    .getAllByTestId(/^airport-row-/)
    .map((el) => el.getAttribute("data-testid"));
}

async function renderAndWaitForRows() {
  renderPage();
  await waitFor(() => {
    expect(screen.getAllByTestId(/^airport-row-/).length).toBeGreaterThan(0);
  });
}

function clickHeader(labelKey: string) {
  fireEvent.click(screen.getByText(labelKey));
}

describe("AirportListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockListAirportSummaries.mockResolvedValue({
      data: [BRATISLAVA, KOSICE, WARSAW, VIENNA],
      meta: { total: 4 },
    });
  });

  describe("compareAirport sorting", () => {
    it("sorts by icao code ascending by default", async () => {
      await renderAndWaitForRows();
      expect(rowIds()).toEqual([
        "airport-row-a-warsaw",
        "airport-row-a-vienna",
        "airport-row-a-blava",
        "airport-row-a-kosice",
      ]);
    });

    it("sorts string columns with localeCompare in both directions", async () => {
      await renderAndWaitForRows();

      clickHeader("coordinator.airportList.columns.name");
      expect(rowIds()).toEqual([
        "airport-row-a-blava",
        "airport-row-a-kosice",
        "airport-row-a-vienna",
        "airport-row-a-warsaw",
      ]);

      clickHeader("coordinator.airportList.columns.name");
      expect(rowIds()).toEqual([
        "airport-row-a-warsaw",
        "airport-row-a-vienna",
        "airport-row-a-kosice",
        "airport-row-a-blava",
      ]);
    });

    it("sorts null cells last ascending and first descending, keeping null pairs stable", async () => {
      await renderAndWaitForRows();

      // asc: named cities first, the two null cities keep input order at the end
      clickHeader("coordinator.airportList.columns.city");
      expect(rowIds()).toEqual([
        "airport-row-a-blava",
        "airport-row-a-warsaw",
        "airport-row-a-kosice",
        "airport-row-a-vienna",
      ]);

      // desc: sign flip moves nulls to the front without reordering the pair
      clickHeader("coordinator.airportList.columns.city");
      expect(rowIds()).toEqual([
        "airport-row-a-kosice",
        "airport-row-a-vienna",
        "airport-row-a-warsaw",
        "airport-row-a-blava",
      ]);
    });

    it("sorts numeric count columns largest-first on first click, then ascending", async () => {
      await renderAndWaitForRows();

      // numeric columns start at desc
      clickHeader("coordinator.airportList.columns.runways");
      expect(rowIds()).toEqual([
        "airport-row-a-warsaw",
        "airport-row-a-blava",
        "airport-row-a-kosice",
        "airport-row-a-vienna",
      ]);

      clickHeader("coordinator.airportList.columns.runways");
      expect(rowIds()).toEqual([
        "airport-row-a-vienna",
        "airport-row-a-kosice",
        "airport-row-a-blava",
        "airport-row-a-warsaw",
      ]);
    });
  });

  describe("pagination", () => {
    beforeEach(() => {
      mockListAirportSummaries.mockResolvedValue({
        data: PAGED,
        meta: { total: PAGED.length },
      });
    });

    it("slices exactly one page of rows per page", async () => {
      await renderAndWaitForRows();

      // page 0: first 10 rows, row 11 falls past the boundary
      expect(rowIds()).toHaveLength(10);
      expect(screen.getByTestId("airport-row-a-01")).toBeInTheDocument();
      expect(screen.getByTestId("airport-row-a-10")).toBeInTheDocument();
      expect(screen.queryByTestId("airport-row-a-11")).not.toBeInTheDocument();

      // page 1: the remaining 2 rows
      fireEvent.click(screen.getByRole("button", { name: "2" }));
      expect(rowIds()).toEqual(["airport-row-a-11", "airport-row-a-12"]);
    });

    it("resets to page 0 when the search changes", async () => {
      await renderAndWaitForRows();

      fireEvent.click(screen.getByRole("button", { name: "2" }));
      expect(rowIds()).toEqual(["airport-row-a-11", "airport-row-a-12"]);

      // matches all 12 rows, so only the page reset changes what is visible
      fireEvent.change(screen.getByTestId("airport-search-input"), {
        target: { value: "airport" },
      });
      expect(rowIds()).toHaveLength(10);
      expect(screen.getByTestId("airport-row-a-01")).toBeInTheDocument();
      expect(screen.queryByTestId("airport-row-a-11")).not.toBeInTheDocument();
    });

    it("resets to page 0 when the country filter changes", async () => {
      await renderAndWaitForRows();

      fireEvent.click(screen.getByRole("button", { name: "2" }));
      expect(rowIds()).toEqual(["airport-row-a-11", "airport-row-a-12"]);

      // every row is in Slovakia, so only the page reset changes what is visible
      fireEvent.change(screen.getByTestId("country-filter"), {
        target: { value: "Slovakia" },
      });
      expect(rowIds()).toHaveLength(10);
      expect(screen.getByTestId("airport-row-a-01")).toBeInTheDocument();
      expect(screen.queryByTestId("airport-row-a-11")).not.toBeInTheDocument();
    });
  });
});
