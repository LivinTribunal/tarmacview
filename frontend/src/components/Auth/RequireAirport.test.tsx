/**
 * tests for the RequireAirport route guard.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { AirportProvider } from "@/contexts/AirportContext";
import RequireAirport from "./RequireAirport";

vi.mock("@/api/airports", () => ({
  getAirport: vi.fn().mockResolvedValue({
    id: "apt-1",
    icao_code: "LZIB",
    name: "Bratislava",
    city: "Bratislava",
    country: "Slovakia",
    elevation: 134,
    location: { type: "Point", coordinates: [17.2127, 48.1702, 134] },
    surfaces: [],
    obstacles: [],
    safety_zones: [],
  }),
}));

const MOCK_AIRPORT = {
  id: "apt-1",
  icao_code: "LZIB",
  name: "Bratislava",
  city: "Bratislava",
  country: "Slovakia",
  elevation: 134,
  location: { type: "Point", coordinates: [17.2127, 48.1702, 134] },
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AirportProvider>
        <Routes>
          <Route path="/operator-center/dashboard" element={<div>dashboard</div>} />
          <Route element={<RequireAirport />}>
            <Route
              path="/operator-center/missions/:id"
              element={<div>mission detail</div>}
            />
          </Route>
        </Routes>
      </AirportProvider>
    </MemoryRouter>,
  );
}

describe("RequireAirport", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("redirects to dashboard when no airport is selected", () => {
    renderAt("/operator-center/missions/m-1");
    expect(screen.getByText("dashboard")).toBeInTheDocument();
    expect(screen.queryByText("mission detail")).not.toBeInTheDocument();
  });

  it("renders the protected route when airport is selected", () => {
    localStorage.setItem("tarmacview_airport", JSON.stringify(MOCK_AIRPORT));
    renderAt("/operator-center/missions/m-1");
    expect(screen.getByText("mission detail")).toBeInTheDocument();
    expect(screen.queryByText("dashboard")).not.toBeInTheDocument();
  });

  it("does not render protected content when localStorage has malformed airport", () => {
    localStorage.setItem("tarmacview_airport", "not-json");
    renderAt("/operator-center/missions/m-1");
    expect(screen.getByText("dashboard")).toBeInTheDocument();
    expect(localStorage.getItem("tarmacview_airport")).toBeNull();
  });
});
