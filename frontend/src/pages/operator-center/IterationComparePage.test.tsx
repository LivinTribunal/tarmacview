import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { IterationCompare, MeasurementResults } from "@/types/measurement";
import IterationComparePage from "./IterationComparePage";
import { compareIterations, getMeasurementResults } from "@/api/measurements";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === "iterationCompare.iterationN") return `Iteration ${opts?.index}`;
      if (key === "iterationCompare.failToPass") return "FAIL → PASS";
      if (key === "results.verdict.pass") return "PASS";
      if (key === "results.verdict.fail") return "FAIL";
      if (key === "results.verdict.unknown") return "UNKNOWN";
      return key;
    },
  }),
}));

vi.mock("@/api/measurements", () => ({
  getMeasurementResults: vi.fn(),
  compareIterations: vi.fn(),
}));

// keep the overlay chart light - surface the iteration indices it was handed
vi.mock("@/components/results/IterationOverlayChart", () => ({
  default: ({
    field,
    series,
  }: {
    field: string;
    series: { iteration_index: number | null }[];
  }) => (
    <div data-testid={`overlay-${field}`} data-indices={series.map((s) => s.iteration_index).join(",")} />
  ),
}));

const resultsMock = vi.mocked(getMeasurementResults);
const compareMock = vi.mocked(compareIterations);

function points(index: number) {
  return [
    { frame_number: 0, timestamp: 0, status: "red", angle: 3.0 - index * 0.1, horizontal_angle: 0, intensity: 0.5, area_pixels: 10, chromaticity_x: 0.3, chromaticity_y: 0.3 },
    { frame_number: 1, timestamp: 0.1, status: "white", angle: 3.2, horizontal_angle: 0, intensity: 0.6, area_pixels: 12, chromaticity_x: 0.32, chromaticity_y: 0.31 },
  ];
}

const COMPARE: IterationCompare = {
  group_id: "g1",
  iterations: [
    { id: "m1", iteration_index: 1, label: null, status: "DONE", created_at: null },
    { id: "m2", iteration_index: 2, label: null, status: "DONE", created_at: null },
  ],
  lights: [
    {
      light_name: "PAPI_A",
      setting_angle: 3.0,
      tolerance: 0.1,
      cells: [
        {
          iteration_index: 1,
          measured_transition_angle: 3.5,
          passed: false,
          delta_from_setpoint: 0.5,
          verdict_changed_to_pass: false,
        },
        {
          iteration_index: 2,
          measured_transition_angle: 3.05,
          passed: true,
          delta_from_setpoint: 0.05,
          verdict_changed_to_pass: true,
        },
      ],
      series: [
        { iteration_index: 1, transition_angle_min: 2.8, transition_angle_middle: 3.0, transition_angle_max: 3.2, points: points(1) },
        { iteration_index: 2, transition_angle_min: 2.8, transition_angle_middle: 3.0, transition_angle_max: 3.2, points: points(2) },
      ],
    },
    { light_name: "PAPI_B", setting_angle: null, tolerance: null, cells: [], series: [] },
    { light_name: "PAPI_C", setting_angle: null, tolerance: null, cells: [], series: [] },
    { light_name: "PAPI_D", setting_angle: null, tolerance: null, cells: [], series: [] },
  ],
};

function results(): MeasurementResults {
  return {
    id: "m2",
    inspection_id: "i1",
    status: "DONE",
    has_results: true,
    label: null,
    iteration_group_id: "g1",
    iteration_index: 2,
    inspection_method: "HORIZONTAL_RANGE",
    inspection_sequence_order: 1,
    runway_heading: 90,
    reference_points: [],
    summaries: [],
    lights: [],
    drone_path: [],
    video_urls: {},
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/operator-center/measurements/m2/results/compare"]}>
      <Routes>
        <Route
          path="/operator-center/measurements/:measurementId/results/compare"
          element={<IterationComparePage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("IterationComparePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resultsMock.mockResolvedValue(results());
    compareMock.mockResolvedValue(COMPARE);
  });

  it("resolves the group off the run's results then fetches the comparison", async () => {
    renderPage();
    await waitFor(() => expect(compareMock).toHaveBeenCalledWith("g1"));
  });

  it("renders measured values, verdict pills, and the FAIL→PASS marker", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("convergence-table")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("compare-cell-PAPI_A-1")).toHaveTextContent("3.50°");
    expect(screen.getByTestId("compare-cell-PAPI_A-2")).toHaveTextContent("3.05°");
    // iteration 2 flipped PAPI_A from FAIL to PASS
    expect(screen.getByTestId("fail-to-pass-PAPI_A-2")).toBeInTheDocument();
    expect(screen.queryByTestId("fail-to-pass-PAPI_A-1")).toBeNull();
  });

  it("filters table columns and chart series by the iteration selector", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("compare-cell-PAPI_A-1")).toBeInTheDocument(),
    );
    // both iterations feed the overlay chart initially
    expect(screen.getByTestId("overlay-angle")).toHaveAttribute("data-indices", "1,2");

    // deselect iteration 1
    fireEvent.click(screen.getByTestId("iteration-pill-1"));

    await waitFor(() =>
      expect(screen.queryByTestId("compare-cell-PAPI_A-1")).toBeNull(),
    );
    expect(screen.getByTestId("compare-cell-PAPI_A-2")).toBeInTheDocument();
    // the chart series drop iteration 1 too
    expect(screen.getByTestId("overlay-angle")).toHaveAttribute("data-indices", "2");
  });
});
