import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import type { MissionDetailResponse, InspectionResponse } from "@/types/mission";
import type {
  MeasurementListItem,
  MeasurementResults,
  MissionResults,
} from "@/types/measurement";
import type { MissionTabOutletContext } from "@/components/Layout/MissionTabNav";
import MissionResultsPage from "./MissionResultsPage";

vi.mock("@/api/measurements", () => ({
  listAirportMeasurements: vi.fn(),
  getMeasurementResults: vi.fn(),
  getMissionResults: vi.fn(),
  downloadMeasurementReport: vi.fn(),
  getMeasurementStatus: vi.fn(),
  getMeasurementPreview: vi.fn(),
  confirmMeasurementLights: vi.fn(),
}));
vi.mock("@/api/inspectionTemplates", () => ({
  listInspectionTemplates: vi.fn(),
}));
vi.mock("@/contexts/AirportContext", () => ({
  useAirport: () => ({ selectedAirport: { id: "airport-1" } }),
}));
// stub the heavy results body - exercised by its own test
vi.mock("./ResultsPage", () => ({
  default: () => <div data-testid="results-page-stub" />,
}));

import {
  listAirportMeasurements,
  getMeasurementResults,
  getMissionResults,
  getMeasurementStatus,
  getMeasurementPreview,
} from "@/api/measurements";
import { listInspectionTemplates } from "@/api/inspectionTemplates";

function inspection(over: Partial<InspectionResponse>): InspectionResponse {
  return {
    id: "i1",
    mission_id: "mission-a",
    template_id: "tpl-1",
    config_id: null,
    method: "HORIZONTAL_RANGE",
    sequence_order: 1,
    lha_ids: null,
    config: null,
    ...over,
  };
}

function mission(): MissionDetailResponse {
  return {
    id: "mission-a",
    name: "Alpha",
    status: "MEASURED",
    airport_id: "airport-1",
    created_at: "2026-05-01T10:00:00Z",
    updated_at: "2026-05-02T11:00:00Z",
    operator_notes: null,
    drone_profile_id: null,
    date_time: null,
    default_speed: null,
    measurement_speed_override: null,
    default_altitude_offset: null,
    takeoff_coordinate: null,
    landing_coordinate: null,
    default_capture_mode: null,
    default_buffer_distance: null,
    camera_mode: "AUTO",
    default_white_balance: null,
    default_iso: null,
    default_shutter_speed: null,
    default_focus_mode: null,
    transit_agl: null,
    require_perpendicular_runway_crossing: false,
    keep_inside_airport_boundary: false,
    flight_plan_scope: "FULL",
    direction: "AUTO",
    has_unsaved_map_changes: false,
    computation_status: "IDLE",
    computation_error: null,
    computation_started_at: null,
    inspection_count: 2,
    estimated_duration: null,
    inspections: [
      inspection({ id: "i1", sequence_order: 1 }),
      inspection({ id: "i2", sequence_order: 2 }),
    ],
  };
}

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
    created_at: "2026-06-01T10:00:00Z",
    has_results: true,
    pass_count: 1,
    fail_count: 0,
    error_message: null,
    ...over,
  };
}

const resultsPayload: MeasurementResults = {
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
  reference_points: [],
  summaries: [],
  lights: [],
  drone_path: [],
  video_urls: {},
};

const overviewPayload: MissionResults = {
  mission_id: "mission-a",
  mission_name: "Alpha",
  header: {
    airport_icao: "LZIB",
    airport_name: "Bratislava",
    mission_name: "Alpha",
    measurement_date: null,
    drone_model: null,
    optical_sensor: null,
    reference_system: null,
    certificate_number: null,
  },
  weather: {
    temperature_c: null,
    wind: null,
    visibility: null,
    conditions: null,
  },
  runways: [],
  evaluation: [],
  recommendations: null,
};

const setSaveContext = vi.fn();
const setComputeContext = vi.fn();

// stable across renders, mirroring the route-forwarded mission identity
const MISSION = mission();

// parent route mirroring MissionTabNav: a real div is the left-panel portal target
function OutletHarness() {
  const [leftPanelEl, setLeftPanelEl] = useState<HTMLDivElement | null>(null);
  const ctx = {
    setSaveContext,
    setComputeContext,
    refreshMissions: vi.fn(),
    mission: MISSION,
    updateMissionFromPage: vi.fn(),
    leftPanelEl,
    setCompactLeftPanel: vi.fn(),
  } satisfies MissionTabOutletContext;
  return (
    <>
      <div ref={setLeftPanelEl} data-testid="left-panel" />
      <Outlet context={ctx} />
    </>
  );
}

function renderPage(search = "") {
  return render(
    <MemoryRouter
      initialEntries={[`/operator-center/missions/mission-a/results${search}`]}
    >
      <Routes>
        <Route element={<OutletHarness />}>
          <Route
            path="/operator-center/missions/:id/results"
            element={<MissionResultsPage />}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function lastComputeCtx() {
  const fileCalls = setComputeContext.mock.calls.filter(
    (c) => c[0]?.icon === "file",
  );
  return fileCalls[fileCalls.length - 1]?.[0];
}

describe("MissionResultsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listInspectionTemplates).mockResolvedValue({
      data: [],
      meta: { total: 0, limit: 50, offset: 0 },
    });
    vi.mocked(getMeasurementResults).mockResolvedValue(resultsPayload);
    vi.mocked(getMissionResults).mockResolvedValue(overviewPayload);
  });

  it("lands on the mission overview by default, not a single inspection", async () => {
    vi.mocked(listAirportMeasurements).mockResolvedValue([
      row({ id: "m1", inspection_id: "i1", status: "DONE" }),
      row({ id: "m2", inspection_id: "i2", status: "PROCESSING" }),
    ]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("mission-results-overview")).toBeInTheDocument(),
    );
    expect(getMissionResults).toHaveBeenCalledWith("mission-a");
    // no drill-down fetch on load - overview is the default view
    expect(getMeasurementResults).not.toHaveBeenCalled();
    // pdf download is disabled outside a drill-down
    expect(lastComputeCtx()?.canCompute).toBe(false);
  });

  it("opens the drill-down from a ?inspection=<DONE> deep-link", async () => {
    vi.mocked(listAirportMeasurements).mockResolvedValue([
      row({ id: "m1", inspection_id: "i1", status: "DONE" }),
    ]);
    renderPage("?inspection=i1");

    await waitFor(() =>
      expect(screen.getByTestId("results-page-stub")).toBeInTheDocument(),
    );
    expect(getMeasurementResults).toHaveBeenCalledWith("m1");
    // pdf download is enabled in the drill-down
    expect(lastComputeCtx()?.canCompute).toBe(true);
  });

  it("drills into the latest run when an inspection has multiple measurements", async () => {
    // api returns newest-first, so the first match per inspection wins
    vi.mocked(listAirportMeasurements).mockResolvedValue([
      row({ id: "m1-new", inspection_id: "i1", status: "DONE" }),
      row({ id: "m1-old", inspection_id: "i1", status: "DONE" }),
    ]);
    renderPage("?inspection=i1");

    await waitFor(() =>
      expect(getMeasurementResults).toHaveBeenCalledWith("m1-new"),
    );
  });

  it("returns to the overview from the drill-down back control", async () => {
    vi.mocked(listAirportMeasurements).mockResolvedValue([
      row({ id: "m1", inspection_id: "i1", status: "DONE" }),
    ]);
    renderPage("?inspection=i1");

    await waitFor(() =>
      expect(screen.getByTestId("results-page-stub")).toBeInTheDocument(),
    );
    screen.getByTestId("back-to-overview").click();
    await waitFor(() =>
      expect(screen.getByTestId("mission-results-overview")).toBeInTheDocument(),
    );
  });

  it("wires a disabled save pill and a file-icon download button", async () => {
    vi.mocked(listAirportMeasurements).mockResolvedValue([
      row({ id: "m1", inspection_id: "i1", status: "DONE" }),
    ]);
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("mission-results-overview")).toBeInTheDocument(),
    );
    const saveCalls = setSaveContext.mock.calls;
    const save = saveCalls[saveCalls.length - 1]?.[0];
    expect(save.onSave).not.toBeNull();
    expect(save.isDirty).toBe(false);

    const compute = lastComputeCtx();
    expect(compute?.icon).toBe("file");
    expect(compute?.label).toBe("results.downloadPdf");
  });

  it("opens MeasurementFlowDialog when an AWAITING_CONFIRM inspection is reviewed", async () => {
    vi.mocked(listAirportMeasurements).mockResolvedValue([
      row({ id: "m9", inspection_id: "i1", status: "AWAITING_CONFIRM" }),
    ]);
    vi.mocked(getMeasurementStatus).mockResolvedValue({
      id: "m9",
      status: "AWAITING_CONFIRM",
      error_message: null,
    });
    vi.mocked(getMeasurementPreview).mockResolvedValue({
      id: "m9",
      status: "AWAITING_CONFIRM",
      first_frame_url: "http://x/f.jpg",
      boxes: [{ light_name: "PAPI_A", x: 50, y: 50, size: 8 }],
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("results-inspection-row-i1")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("results-inspection-row-i1"));

    await waitFor(() =>
      expect(screen.getByTestId("measurement-flow-dialog")).toBeInTheDocument(),
    );
  });
});
