import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import SuperAdminAirportsPage from "./SuperAdminAirportsPage";

const stableT = (key: string) => key;
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT, i18n: { language: "en" } }),
}));

const mockListAirportsAdmin = vi.fn();

vi.mock("@/api/admin", () => ({
  listAirportsAdmin: (...args: unknown[]) => mockListAirportsAdmin(...args),
}));

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

const AIRPORT_BTS = {
  id: "apt-1",
  icao_code: "LZIB",
  name: "Bratislava",
  city: "Bratislava",
  country: "Slovakia",
  user_count: 3,
  coordinator_count: 1,
  operator_count: 2,
  mission_count: 12,
  drone_count: 2,
  terrain_source: "FLAT",
};

const AIRPORT_BUD = {
  id: "apt-2",
  icao_code: "LHBP",
  name: "Budapest",
  city: "Budapest",
  country: "Hungary",
  user_count: 5,
  coordinator_count: 2,
  operator_count: 3,
  mission_count: 24,
  drone_count: 4,
  terrain_source: "DEM_API",
};

// no coordinator assigned -> orphaned
const AIRPORT_ORPHAN = {
  id: "apt-3",
  icao_code: "LZPP",
  name: "Piestany",
  city: "Piestany",
  country: "Slovakia",
  user_count: 0,
  coordinator_count: 0,
  operator_count: 0,
  mission_count: 0,
  drone_count: 0,
  terrain_source: "FLAT",
};

function renderPage() {
  return render(
    <MemoryRouter>
      <SuperAdminAirportsPage />
    </MemoryRouter>,
  );
}

describe("SuperAdminAirportsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAirportsAdmin.mockResolvedValue({
      data: [AIRPORT_BTS, AIRPORT_BUD],
    });
  });

  it("issues exactly one filtered fetch on initial mount", async () => {
    /** initial render hits the unfiltered fetch (for country options) once and the filtered fetch once. */
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("LZIB")).toBeInTheDocument();
    });
    // one unfiltered call (for options) + one filtered call (params)
    expect(mockListAirportsAdmin).toHaveBeenCalledTimes(2);
  });

  it("fires exactly one extra fetch per filter change", async () => {
    /** changing search and country each triggers one and only one refetch. */
    renderPage();
    await waitFor(() =>
      expect(mockListAirportsAdmin).toHaveBeenCalledTimes(2),
    );

    fireEvent.change(screen.getByTestId("airport-search"), {
      target: { value: "brati" },
    });
    await waitFor(() =>
      expect(mockListAirportsAdmin).toHaveBeenCalledTimes(3),
    );

    fireEvent.change(screen.getByTestId("country-filter"), {
      target: { value: "Slovakia" },
    });
    await waitFor(() =>
      expect(mockListAirportsAdmin).toHaveBeenCalledTimes(4),
    );

    expect(mockListAirportsAdmin).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "brati", country: "Slovakia" }),
    );
  });

  it("clearing the country select fires a refetch without the country param", async () => {
    /** selecting the empty option drops the country filter from the next request. */
    renderPage();
    await waitFor(() =>
      expect(mockListAirportsAdmin).toHaveBeenCalledTimes(2),
    );

    fireEvent.change(screen.getByTestId("country-filter"), {
      target: { value: "Slovakia" },
    });
    await waitFor(() =>
      expect(mockListAirportsAdmin).toHaveBeenCalledTimes(3),
    );

    fireEvent.change(screen.getByTestId("country-filter"), {
      target: { value: "" },
    });
    await waitFor(() =>
      expect(mockListAirportsAdmin).toHaveBeenCalledTimes(4),
    );
    expect(mockListAirportsAdmin).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ country: expect.anything() }),
    );
  });

  it("row click navigates to the per-airport detail page", async () => {
    /** clicking a row routes to /super-admin/airports/:id (replaces the inline modal). */
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("LZIB")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("LZIB"));
    expect(mockNavigate).toHaveBeenCalledWith(
      "/super-admin/airports/apt-1",
    );
  });

  it("flags an airport with no coordinator as unassigned", async () => {
    /** an orphaned airport (coordinator_count === 0) renders the Unassigned badge. */
    mockListAirportsAdmin.mockResolvedValue({
      data: [AIRPORT_BTS, AIRPORT_ORPHAN],
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("LZPP")).toBeInTheDocument();
    });
    const badges = screen.getAllByTestId("unassigned-badge");
    // only the orphaned airport carries the badge
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent("admin.unassigned");
  });

  it("orphaned-only filter narrows the list to unassigned airports", async () => {
    /** ticking the orphaned filter hides airports that already have a coordinator. */
    mockListAirportsAdmin.mockResolvedValue({
      data: [AIRPORT_BTS, AIRPORT_ORPHAN],
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("LZIB")).toBeInTheDocument();
    });
    expect(screen.getByText("LZPP")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("orphaned-filter"));

    await waitFor(() => {
      expect(screen.queryByText("LZIB")).not.toBeInTheDocument();
    });
    expect(screen.getByText("LZPP")).toBeInTheDocument();
  });

  it("populates country options from the unfiltered airports load", async () => {
    /** the country select reflects the distinct countries in the loaded data. */
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("LZIB")).toBeInTheDocument();
    });
    const select = screen.getByTestId("country-filter") as HTMLSelectElement;
    const optionValues = Array.from(select.querySelectorAll("option")).map(
      (o) => o.value,
    );
    expect(optionValues).toContain("Slovakia");
    expect(optionValues).toContain("Hungary");
  });
});
