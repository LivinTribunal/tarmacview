import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import MissionValidationPage from "./MissionValidationPage";
import type { MissionDetailResponse } from "@/types/mission";
import type { FlightPlanResponse } from "@/types/flightPlan";

// page-level tests for the export-panel picker state survival fix on
// MissionValidationPage. covers the loading-flag split that prevents
// ExportPanel from unmounting on every refetch (focus, post-export).

// stable react-i18next replacement - the global mock returns fresh
// t/i18n on every call which destabilizes useCallback deps inside the
// page and triggers infinite re-fetch loops
const stableT = (key: string) => key;
const stableI18n = {
  language: "en",
  changeLanguage: vi.fn(),
  options: { resources: { en: {} } },
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: stableT, i18n: stableI18n }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

// stable outlet context and navigate refs
const mockNavigate = vi.fn();
const mockSetSaveContext = vi.fn();
const mockSetComputeContext = vi.fn();
const mockRefreshMissions = vi.fn();
const mockUpdateMissionFromPage = vi.fn();
function getLeftPanelEl() {
  let el = document.getElementById("left-panel-portal");
  if (!el) {
    el = document.createElement("div");
    el.id = "left-panel-portal";
    document.body.appendChild(el);
  }
  return el as HTMLDivElement;
}
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useOutletContext: () => ({
      setSaveContext: mockSetSaveContext,
      setComputeContext: mockSetComputeContext,
      refreshMissions: mockRefreshMissions,
      updateMissionFromPage: mockUpdateMissionFromPage,
      leftPanelEl: getLeftPanelEl(),
    }),
  };
});

vi.mock("@/api/missions", () => ({
  getMission: vi.fn(),
  getFlightPlan: vi.fn(),
  validateMission: vi.fn(),
  exportMissionFiles: vi.fn(),
  completeMission: vi.fn(),
  cancelMission: vi.fn(),
  deleteMission: vi.fn(),
}));

vi.mock("@/api/droneProfiles", () => ({
  listDroneProfiles: vi.fn(),
}));

const stableAirportContext = {
  airportDetail: {
    id: "apt-1",
    name: "Test Airport",
    icao_code: "LZTT",
    elevation: 130,
    location: {
      type: "Point" as const,
      coordinates: [17.0, 48.0, 0] as [number, number, number],
    },
    surfaces: [],
    obstacles: [],
    safety_zones: [],
  },
  selectedAirport: { id: "apt-1", name: "Test Airport" },
};
vi.mock("@/contexts/AirportContext", () => ({
  useAirport: () => stableAirportContext,
}));

vi.mock("@/components/map/AirportMap", () => ({
  default: () => <div data-testid="airport-map" />,
}));

vi.mock("@/components/map/overlays/TerrainToggle", () => ({
  default: () => <button type="button" data-testid="terrain-toggle">terrain</button>,
}));

vi.mock("@/components/map/overlays/PoiInfoPanel", () => ({
  default: () => <div data-testid="poi-info" />,
}));

vi.mock("@/hooks/useDownloadMissionReport", () => ({
  default: () => ({ isDownloadingReport: false, handleDownloadReport: vi.fn() }),
}));

import {
  getMission,
  getFlightPlan,
  exportMissionFiles,
} from "@/api/missions";
import { listDroneProfiles } from "@/api/droneProfiles";

function makeMission(): MissionDetailResponse {
  return {
    id: "m-1",
    name: "Test Mission",
    status: "VALIDATED",
    airport_id: "apt-1",
    created_at: "2026-03-01T10:00:00Z",
    updated_at: "2026-03-05T14:30:00Z",
    operator_notes: null,
    drone_profile_id: "dp-1",
    date_time: null,
    default_speed: null,
    measurement_speed_override: null,
    default_altitude_offset: null,
    takeoff_coordinate: null,
    landing_coordinate: null,
    default_capture_mode: null,
    default_buffer_distance: null,
    default_white_balance: null,
    default_iso: null,
    default_shutter_speed: null,
    default_focus_mode: null,
    camera_mode: "AUTO",
    transit_agl: null,
    require_perpendicular_runway_crossing: true,
    keep_inside_airport_boundary: true,
    flight_plan_scope: "FULL",
    direction: "AUTO",
    has_unsaved_map_changes: false,
    computation_status: "IDLE",
    computation_error: null,
    computation_started_at: null,
    inspection_count: 0,
    estimated_duration: null,
    supports_geozone_upload: true,
    dji_heading_mode: null,
    inspections: [],
  };
}

function makeFlightPlan(): FlightPlanResponse {
  return {
    id: "fp-1",
    mission_id: "m-1",
    airport_id: "apt-1",
    total_distance: 100,
    estimated_duration: 60,
    is_validated: true,
    generated_at: "2026-01-01T00:00:00Z",
    waypoints: [],
    validation_result: {
      id: "vr-1",
      passed: true,
      validated_at: "2026-01-01T00:00:00Z",
      violations: [],
    },
    min_altitude_agl: null,
    max_altitude_agl: null,
    min_altitude_msl: null,
    max_altitude_msl: null,
    transit_speed: null,
    average_speed: null,
    inspection_stats: [],
  };
}

function setupHappyPath() {
  vi.mocked(getMission).mockResolvedValue(makeMission());
  vi.mocked(getFlightPlan).mockResolvedValue(makeFlightPlan());
  // mapped dji drone so the post-export KMZ click skips the wpml-fallback
  // modal - this suite tests picker survival, not the fallback flow.
  vi.mocked(listDroneProfiles).mockResolvedValue({
    data: [
      {
        id: "dp-1",
        name: "Matrice 4T",
        manufacturer: "DJI",
        model: "Matrice 4T",
        supports_dji_wpml: true,
        is_dji: true,
        supports_geozone_upload: true,
      },
    ],
  } as never);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/operator-center/missions/m-1/validation"]}>
      <Routes>
        <Route
          path="/operator-center/missions/:id/validation"
          element={<MissionValidationPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  document.getElementById("left-panel-portal")?.remove();
});

afterEach(() => {
  cleanup();
});

describe("MissionValidationPage picker state survival", () => {
  /** verifies the loading-flag split so ExportPanel state is not unmounted
   *  on focus/visibility refetches and post-export refetches. */

  it("picker state survives window focus refetch", async () => {
    setupHappyPath();
    renderPage();

    // wait for initial load to complete
    const kmzCheckbox = await screen.findByTestId("format-KMZ");
    const mavlinkCheckbox = screen.getByTestId("format-MAVLINK");
    expect(kmzCheckbox).not.toBeChecked();

    // tick KMZ + MAVLINK
    fireEvent.click(kmzCheckbox);
    fireEvent.click(mavlinkCheckbox);
    expect(kmzCheckbox).toBeChecked();
    expect(mavlinkCheckbox).toBeChecked();

    // dispatch focus -> triggers another fetchData
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(vi.mocked(getMission)).toHaveBeenCalledTimes(2),
    );

    // re-resolve any pending state by yielding to the microtask queue
    await act(async () => {
      await Promise.resolve();
    });

    // checkboxes still checked -> ExportPanel was not unmounted
    expect(screen.getByTestId("format-KMZ")).toBeChecked();
    expect(screen.getByTestId("format-MAVLINK")).toBeChecked();
  });

  it("picker state survives visibilitychange refetch", async () => {
    setupHappyPath();
    renderPage();

    const kmzCheckbox = await screen.findByTestId("format-KMZ");
    fireEvent.click(kmzCheckbox);
    expect(kmzCheckbox).toBeChecked();

    // simulate tab becoming visible
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() =>
      expect(vi.mocked(getMission)).toHaveBeenCalledTimes(2),
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("format-KMZ")).toBeChecked();
  });

  it("picker state survives post-export refetch", async () => {
    setupHappyPath();
    vi.mocked(exportMissionFiles).mockResolvedValue({
      kind: "file",
      blob: new Blob(["x"]),
      filename: "test.kml",
    });
    // jsdom shim - the page calls createObjectURL/revokeObjectURL after export
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();

    try {
      renderPage();

      const kmzCheckbox = await screen.findByTestId("format-KMZ");
      fireEvent.click(kmzCheckbox);
      const geozonesCheckbox = screen.getByTestId("include-geozones");
      fireEvent.click(geozonesCheckbox);
      expect(kmzCheckbox).toBeChecked();
      expect(geozonesCheckbox).toBeChecked();

      // click download -> exportMissionFiles -> fetchData refetch
      const downloadBtn = screen.getByTestId("download-export-btn");
      await act(async () => {
        fireEvent.click(downloadBtn);
      });

      await waitFor(() =>
        expect(vi.mocked(exportMissionFiles)).toHaveBeenCalledTimes(1),
      );
      await waitFor(() =>
        expect(vi.mocked(getMission)).toHaveBeenCalledTimes(2),
      );
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByTestId("format-KMZ")).toBeChecked();
      expect(screen.getByTestId("include-geozones")).toBeChecked();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it("initial load shows full-page spinner, refetch does not", async () => {
    // first call resolves immediately; second call's spinner should not show
    setupHappyPath();
    const { container } = renderPage();

    // before first resolve, the page renders the full-page spinner
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    expect(screen.queryByTestId("export-panel")).not.toBeInTheDocument();

    // wait for content to mount
    await screen.findByTestId("export-panel");

    // trigger a second fetch via focus and assert the export panel is not
    // replaced by a spinner (it remains mounted while refetching)
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(vi.mocked(getMission)).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByTestId("export-panel")).toBeInTheDocument();
  });

  it("initial-load error renders Retry button", async () => {
    vi.mocked(getMission).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(getFlightPlan).mockResolvedValue(makeFlightPlan());
    vi.mocked(listDroneProfiles).mockResolvedValue({
      data: [],
    } as never);

    renderPage();

    // error branch shows the localized error message + retry button
    await waitFor(() => {
      expect(screen.getByText("common.retry")).toBeInTheDocument();
    });
    expect(screen.getByText("mission.config.loadError")).toBeInTheDocument();
  });
});
