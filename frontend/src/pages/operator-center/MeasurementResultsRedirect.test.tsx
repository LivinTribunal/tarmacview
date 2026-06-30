import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import type { MeasurementListItem } from "@/types/measurement";
import MeasurementResultsRedirect from "./MeasurementResultsRedirect";

vi.mock("@/api/measurements", () => ({
  listAirportMeasurements: vi.fn(),
}));

const { airportRef } = vi.hoisted(() => ({
  airportRef: { current: null as { id: string } | null },
}));
vi.mock("@/contexts/AirportContext", () => ({
  useAirport: () => ({ selectedAirport: airportRef.current }),
}));

import { listAirportMeasurements } from "@/api/measurements";

function row(over: Partial<MeasurementListItem>): MeasurementListItem {
  return {
    id: "m1",
    inspection_id: "i1",
    mission_id: "mission-a",
    mission_name: "Alpha",
    inspection_method: "HORIZONTAL_RANGE",
    inspection_sequence_order: 1,
    status: "DONE",
    label: null,
    created_at: null,
    has_results: true,
    pass_count: 1,
    fail_count: 0,
    error_message: null,
    ...over,
  };
}

// echoes the resolved location path + query so assertions can read the redirect target
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function renderAt(measurementId: string) {
  return render(
    <MemoryRouter initialEntries={[`/operator-center/measurements/${measurementId}/results`]}>
      <Routes>
        <Route
          path="/operator-center/measurements/:measurementId/results"
          element={<MeasurementResultsRedirect />}
        />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MeasurementResultsRedirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    airportRef.current = { id: "airport-1" };
  });

  it("redirects to the owning mission's results tab with the inspection query", async () => {
    vi.mocked(listAirportMeasurements).mockResolvedValue([
      row({ id: "m9", mission_id: "mission-b", inspection_id: "insp-9" }),
    ]);
    renderAt("m9");

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/operator-center/missions/mission-b/results?inspection=insp-9",
      ),
    );
  });

  it("falls back to the missions list when no row matches", async () => {
    vi.mocked(listAirportMeasurements).mockResolvedValue([row({ id: "other" })]);
    renderAt("missing");

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/operator-center/missions",
      ),
    );
  });

  it("falls back to the missions list when no airport is selected", async () => {
    airportRef.current = null;
    renderAt("m9");

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/operator-center/missions",
      ),
    );
    expect(listAirportMeasurements).not.toHaveBeenCalled();
  });
});
