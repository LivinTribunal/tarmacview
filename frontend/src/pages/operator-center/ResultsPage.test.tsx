import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { MeasurementResults } from "@/types/measurement";
import ResultsPage from "./ResultsPage";

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
vi.mock("@/components/results/DroneHeightProfileChart", () => ({
  default: () => <div data-testid="mock-height-profile" />,
}));
vi.mock("@/components/results/AnnotatedVideoPlayer", () => ({
  default: () => <div data-testid="mock-video-player" />,
}));

const baseResults: MeasurementResults = {
  id: "m1",
  inspection_id: "i1",
  status: "DONE",
  has_results: true,
  label: null,
  inspection_method: "HORIZONTAL_RANGE",
  inspection_sequence_order: 1,
  runway_heading: 90,
  measured_glide_slope_angle: null,
  configured_glide_slope_angle: null,
  glide_slope_angle_tolerance: null,
  glide_slope_within_tolerance: null,
  measured_glide_slope_angle_touchpoint: null,
  ils_harmonization_tolerance: null,
  ils_harmonization_within_tolerance: null,
  reference_points: [],
  summaries: [
    {
      light_name: "PAPI_A",
      setting_angle: 3.0,
      tolerance: 0.5,
      measured_transition_angle: 3.1,
      measured_transition_angle_touchpoint: null,
      passed: true,
    },
  ],
  lights: [],
  drone_path: [],
  video_urls: {},
};

describe("ResultsPage", () => {
  it("renders the table and charts for a finished run", () => {
    render(<ResultsPage results={baseResults} />);

    expect(screen.getByTestId("results-page")).toBeInTheDocument();
    expect(screen.getByTestId("transition-angle-table")).toBeInTheDocument();
    expect(screen.getByTestId("mock-angle-chart")).toBeInTheDocument();
    expect(screen.getByTestId("mock-chromaticity-chart")).toBeInTheDocument();
    expect(screen.getByTestId("mock-intensity-chart")).toBeInTheDocument();
    expect(screen.getByTestId("mock-drone-path-map")).toBeInTheDocument();
    expect(screen.getByTestId("mock-height-profile")).toBeInTheDocument();
    expect(screen.getByTestId("results-data-tables")).toBeInTheDocument();
    expect(screen.getByTestId("mock-video-player")).toBeInTheDocument();
  });

  it("renders the five anchored sections with data tables first", () => {
    render(<ResultsPage results={baseResults} />);

    const dataTables = screen.getByTestId("section-data-tables");
    const vertical = screen.getByTestId("section-papi-vertical");
    expect(dataTables).toBeInTheDocument();
    expect(vertical).toBeInTheDocument();
    expect(screen.getByTestId("section-papi-horizontal")).toBeInTheDocument();
    expect(screen.getByTestId("section-drone-path")).toBeInTheDocument();
    expect(screen.getByTestId("section-annotated-video")).toBeInTheDocument();

    // data tables comes before the vertical section in the DOM
    expect(
      dataTables.compareDocumentPosition(vertical) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("no longer renders its own fetch-driven header or portal block", () => {
    render(<ResultsPage results={baseResults} />);
    expect(screen.queryByTestId("results-run-name")).toBeNull();
    expect(screen.queryByTestId("download-pdf-btn")).toBeNull();
    expect(screen.queryByTestId("results-section-nav")).toBeNull();
  });
});
