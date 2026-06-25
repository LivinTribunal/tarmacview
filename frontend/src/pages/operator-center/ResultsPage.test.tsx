import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import type {
  MeasurementListItem,
  MeasurementResults,
} from "@/types/measurement";
import type { MeasurementTabOutletContext } from "@/components/Layout/MeasurementTabNav";
import ResultsPage from "./ResultsPage";

vi.mock("@/api/measurements", () => ({
  getMeasurementResults: vi.fn(),
}));

// stub the heavy chart / map / video children - exercised by their own tests
vi.mock("@/components/results/LightAngleChart", () => ({
  default: () => <div data-testid="mock-angle-chart" />,
}));
vi.mock("@/components/results/ChromaticityChart", () => ({
  default: () => <div data-testid="mock-chromaticity-chart" />,
}));
vi.mock("@/components/results/IntensityChart", () => ({
  default: () => <div data-testid="mock-intensity-chart" />,
}));
vi.mock("@/components/results/DronePathMap", () => ({
  default: () => <div data-testid="mock-drone-path-map" />,
}));
vi.mock("@/components/results/ClimbProfileChart", () => ({
  default: () => <div data-testid="mock-climb-profile" />,
}));
vi.mock("@/components/results/AnnotatedVideoPlayer", () => ({
  default: () => <div data-testid="mock-video-player" />,
}));

import { getMeasurementResults } from "@/api/measurements";

const baseResults: MeasurementResults = {
  id: "m1",
  inspection_id: "i1",
  status: "DONE",
  has_results: true,
  label: null,
  inspection_method: "HORIZONTAL_RANGE",
  inspection_sequence_order: 1,
  runway_heading: 90,
  reference_points: [],
  summaries: [
    {
      light_name: "PAPI_A",
      setting_angle: 3.0,
      tolerance: 0.5,
      measured_transition_angle: 3.1,
      passed: true,
    },
  ],
  lights: [],
  drone_path: [],
  video_urls: {},
};

const currentRow: MeasurementListItem = {
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
  pass_count: 1,
  fail_count: 0,
  error_message: null,
};

// parent route mirroring MeasurementTabNav: a real div is the left-panel portal
// target so the page's createPortal + useOutletContext resolve
function OutletHarness() {
  const [leftPanelEl, setLeftPanelEl] = useState<HTMLDivElement | null>(null);
  const ctx = { leftPanelEl, currentRow } satisfies MeasurementTabOutletContext;
  return (
    <>
      <div ref={setLeftPanelEl} data-testid="results-left-panel" />
      <Outlet context={ctx} />
    </>
  );
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/measurements/m1/results"]}>
      <Routes>
        <Route element={<OutletHarness />}>
          <Route
            path="/measurements/:measurementId/results"
            element={<ResultsPage />}
          />
        </Route>
        <Route
          path="/operator-center/measurements"
          element={<div data-testid="measurements-list-landing" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ResultsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the table (in the per-light grid) and charts for a finished run", async () => {
    vi.mocked(getMeasurementResults).mockResolvedValue(baseResults);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("results-page")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("transition-angle-table")).toBeInTheDocument();
    expect(screen.getByTestId("mock-angle-chart")).toBeInTheDocument();
    expect(screen.getByTestId("mock-chromaticity-chart")).toBeInTheDocument();
    expect(screen.getByTestId("mock-intensity-chart")).toBeInTheDocument();
    expect(screen.getByTestId("mock-drone-path-map")).toBeInTheDocument();
    expect(screen.getByTestId("mock-climb-profile")).toBeInTheDocument();
    expect(screen.getByTestId("mock-video-player")).toBeInTheDocument();
  });

  it("no longer renders the duplicate name/status/rename/delete header block", async () => {
    vi.mocked(getMeasurementResults).mockResolvedValue({
      ...baseResults,
      label: "morning re-fly",
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("results-page")).toBeInTheDocument(),
    );
    // name + status + rename/delete moved to the results header (MeasurementTabNav)
    expect(screen.queryByTestId("results-run-name")).toBeNull();
    expect(screen.queryByTestId("rename-measurement-btn")).toBeNull();
    expect(screen.queryByTestId("delete-measurement-btn")).toBeNull();
    expect(screen.queryByTestId("download-pdf-btn")).toBeNull();
  });

  it("shows the pending state when the run is not done", async () => {
    vi.mocked(getMeasurementResults).mockResolvedValue({
      ...baseResults,
      status: "PROCESSING",
      has_results: false,
      summaries: [],
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("results-pending")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("transition-angle-table")).toBeNull();
    expect(screen.queryByTestId("mock-angle-chart")).toBeNull();
  });

  it("shows an error when the results fail to load", async () => {
    vi.mocked(getMeasurementResults).mockRejectedValue(new Error("boom"));
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("results-error")).toBeInTheDocument(),
    );
  });

  it("renders the five anchored sections", async () => {
    vi.mocked(getMeasurementResults).mockResolvedValue(baseResults);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("results-page")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("section-papi-vertical")).toBeInTheDocument();
    expect(screen.getByTestId("section-papi-horizontal")).toBeInTheDocument();
    expect(screen.getByTestId("section-drone-path")).toBeInTheDocument();
    expect(screen.getByTestId("section-annotated-video")).toBeInTheDocument();
    expect(screen.getByTestId("section-data-tables")).toBeInTheDocument();
  });

  it("portals the left panel into the provided slot", async () => {
    vi.mocked(getMeasurementResults).mockResolvedValue(baseResults);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("results-page")).toBeInTheDocument(),
    );
    const slot = screen.getByTestId("results-left-panel");
    expect(
      within(slot).getByTestId("results-summary-card"),
    ).toBeInTheDocument();
    expect(within(slot).getByTestId("results-section-nav")).toBeInTheDocument();
  });
});
