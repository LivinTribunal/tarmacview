import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { MeasurementResults } from "@/types/measurement";
import ResultsPage from "./ResultsPage";

vi.mock("@/api/measurements", () => ({
  getMeasurementResults: vi.fn(),
  updateMeasurement: vi.fn(),
  deleteMeasurement: vi.fn(),
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

import {
  deleteMeasurement,
  getMeasurementResults,
  updateMeasurement,
} from "@/api/measurements";

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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/measurements/m1/results"]}>
      <Routes>
        <Route
          path="/measurements/:measurementId/results"
          element={<ResultsPage />}
        />
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

  it("renders the table and charts for a finished run", async () => {
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
    // download moved to MeasurementTabNav (the results header)
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

  it("renders the run label in the header when set", async () => {
    vi.mocked(getMeasurementResults).mockResolvedValue({
      ...baseResults,
      label: "morning re-fly",
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("results-run-name")).toHaveTextContent(
        "morning re-fly",
      ),
    );
  });

  it("deletes the run and navigates back to the measurements list", async () => {
    vi.mocked(getMeasurementResults).mockResolvedValue(baseResults);
    vi.mocked(deleteMeasurement).mockResolvedValue(undefined);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("results-page")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("delete-measurement-btn"));
    fireEvent.click(screen.getByTestId("confirm-delete-measurement"));

    await waitFor(() =>
      expect(deleteMeasurement).toHaveBeenCalledWith("m1"),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("measurements-list-landing"),
      ).toBeInTheDocument(),
    );
  });

  it("renames the run through the header rename modal", async () => {
    vi.mocked(getMeasurementResults).mockResolvedValue(baseResults);
    vi.mocked(updateMeasurement).mockResolvedValue({
      id: "m1",
      inspection_id: "i1",
      status: "DONE",
      label: "evening run",
      error_message: null,
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("results-page")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("rename-measurement-btn"));
    fireEvent.change(screen.getByTestId("measurement-rename-input"), {
      target: { value: "evening run" },
    });
    fireEvent.click(screen.getByTestId("confirm-rename-measurement"));

    await waitFor(() =>
      expect(updateMeasurement).toHaveBeenCalledWith("m1", "evening run"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("results-run-name")).toHaveTextContent(
        "evening run",
      ),
    );
  });
});
