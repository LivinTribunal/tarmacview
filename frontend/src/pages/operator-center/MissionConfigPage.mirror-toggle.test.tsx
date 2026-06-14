import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import MissionConfigPage from "./MissionConfigPage";
import type { MissionDetailResponse } from "@/types/mission";

// page-level tests for the mount-time derivation of the round-trip mirror toggle
// from persisted takeoff/landing coordinates (MissionConfigPage.tsx useEffect)

// stable react-i18next mock - the global mock returns a fresh t/i18n object on
// every call, which destabilizes useCallback deps inside the page (fetchData
// depends on t) and triggers infinite re-fetch loops in tests
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

const mockNavigate = vi.fn();
const mockSetSaveContext = vi.fn();
const mockSetComputeContext = vi.fn();
const mockRefreshMissions = vi.fn();
const mockUpdateMissionFromPage = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useOutletContext: () => {
      let el = document.getElementById("left-panel-portal");
      if (!el) {
        el = document.createElement("div");
        el.id = "left-panel-portal";
        document.body.appendChild(el);
      }
      return {
        setSaveContext: mockSetSaveContext,
        setComputeContext: mockSetComputeContext,
        refreshMissions: mockRefreshMissions,
        updateMissionFromPage: mockUpdateMissionFromPage,
        leftPanelEl: el,
      };
    },
  };
});

vi.mock("@/api/missions", () => ({
  getMission: vi.fn(),
  updateMission: vi.fn(),
  addInspection: vi.fn(),
  updateInspection: vi.fn(),
  removeInspection: vi.fn(),
  reorderInspections: vi.fn(),
  getFlightPlan: vi.fn(),
}));

vi.mock("@/api/droneProfiles", () => ({
  listDroneProfiles: vi.fn(),
}));

vi.mock("@/api/inspectionTemplates", () => ({
  listInspectionTemplates: vi.fn(),
}));

// stable airport context value - useAirport must return the same object reference
// across renders, otherwise useEffect deps that include airportDetail (e.g. the
// fetchData callback in MissionConfigPage) will re-fire on every render
const stableAirportContext = {
  airportDetail: {
    id: "apt-1",
    name: "Test Airport",
    icao_code: "LZTT",
    elevation: 130,
    location: { type: "Point", coordinates: [17.0, 48.0, 0] as [number, number, number] },
    surfaces: [],
    obstacles: [],
    safety_zones: [],
  },
  selectedAirport: { id: "apt-1", name: "Test Airport" },
};
vi.mock("@/contexts/AirportContext", () => ({
  useAirport: () => stableAirportContext,
}));

const stableComputationContext = {
  status: "IDLE",
  missionId: null,
  missionName: null,
  error: null,
  isComputing: false,
  lastResult: null,
  startComputation: vi.fn(),
  dismiss: vi.fn(),
};
vi.mock("@/contexts/ComputationContext", () => ({
  useComputation: () => stableComputationContext,
}));

vi.mock("@/components/map/AirportMap", () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="airport-map">{props.children as React.ReactNode}</div>
  ),
}));

vi.mock("@/components/map/overlays/TerrainToggle", () => ({
  default: () => <button type="button" data-testid="terrain-toggle">terrain</button>,
}));

import { getMission, getFlightPlan } from "@/api/missions";
import { listDroneProfiles } from "@/api/droneProfiles";
import { listInspectionTemplates } from "@/api/inspectionTemplates";

const baseMission: MissionDetailResponse = {
  id: "m-1",
  name: "Test Mission",
  status: "DRAFT",
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
  inspections: [],
};

function setupMocks(mission: MissionDetailResponse) {
  /** wire the api mocks for a single mount. */
  vi.mocked(getMission).mockResolvedValue(mission);
  vi.mocked(getFlightPlan).mockRejectedValue({
    isAxiosError: true,
    response: { status: 404 },
  });
  vi.mocked(listDroneProfiles).mockResolvedValue({
    data: [{ id: "dp-1", name: "DJI Matrice 300", endurance_minutes: 45 }],
  } as never);
  vi.mocked(listInspectionTemplates).mockResolvedValue({
    data: [],
  } as never);
}

function renderPage() {
  /** mount the page within a router context. */
  return render(
    <MemoryRouter initialEntries={["/operator-center/missions/m-1/config"]}>
      <Routes>
        <Route
          path="/operator-center/missions/:id/config"
          element={<MissionConfigPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  // remove the portal node so each test gets a fresh dom
  document.getElementById("left-panel-portal")?.remove();
});

describe("MissionConfigPage round-trip toggle derivation on mount", () => {
  /** verifies the useEffect at MissionConfigPage.tsx that derives
   * useTakeoffAsLanding from persisted takeoff/landing on mission load. */

  it("initializes the toggle ON when persisted takeoff equals landing", async () => {
    /** equal coordinates -> mirror is on, single combined row visible, no separate landing row. */
    const sharedPoint = {
      type: "Point" as const,
      coordinates: [17.21, 48.17, 133] as [number, number, number],
    };
    setupMocks({
      ...baseMission,
      takeoff_coordinate: sharedPoint,
      landing_coordinate: sharedPoint,
    });
    renderPage();

    const toggle = await screen.findByTestId("use-takeoff-as-landing-checkbox");
    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-checked", "true");
    });
    // collapsed single row uses the combined i18n key
    expect(
      screen.getByTestId("mission.config.takeoffandlandingcoordinate-lat"),
    ).toBeInTheDocument();
    // landing row is unmounted
    expect(
      screen.queryByTestId("mission.config.landingcoordinate-lat"),
    ).not.toBeInTheDocument();
  });

  it("initializes the toggle OFF when persisted takeoff differs from landing", async () => {
    /** distinct coordinates -> mirror off, both takeoff and landing rows render stacked. */
    setupMocks({
      ...baseMission,
      takeoff_coordinate: {
        type: "Point",
        coordinates: [17.21, 48.17, 133],
      },
      landing_coordinate: {
        type: "Point",
        coordinates: [17.30, 48.20, 140],
      },
    });
    renderPage();

    const toggle = await screen.findByTestId("use-takeoff-as-landing-checkbox");
    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-checked", "false");
    });
    expect(
      screen.getByTestId("mission.config.takeoffcoordinate-lat"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("mission.config.landingcoordinate-lat"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("mission.config.takeoffandlandingcoordinate-lat"),
    ).not.toBeInTheDocument();
  });

  it("initializes the toggle OFF when both coordinates are null", async () => {
    /** missing coordinates default to mirror off so users opt in explicitly. */
    setupMocks({ ...baseMission, takeoff_coordinate: null, landing_coordinate: null });
    renderPage();

    const toggle = await screen.findByTestId("use-takeoff-as-landing-checkbox");
    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-checked", "false");
    });
  });

  it("unmounts the landing row when the toggle is flipped on after mount", async () => {
    /** flipping the toggle from off->on collapses to a single combined row. */
    setupMocks({
      ...baseMission,
      takeoff_coordinate: { type: "Point", coordinates: [17.21, 48.17, 133] },
      landing_coordinate: { type: "Point", coordinates: [17.30, 48.20, 140] },
    });
    renderPage();

    const toggle = await screen.findByTestId("use-takeoff-as-landing-checkbox");
    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-checked", "false");
    });
    expect(
      screen.getByTestId("mission.config.landingcoordinate-lat"),
    ).toBeInTheDocument();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-checked", "true");
    });
    expect(
      screen.queryByTestId("mission.config.landingcoordinate-lat"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("mission.config.takeoffandlandingcoordinate-lat"),
    ).toBeInTheDocument();
  });

  it("remounts the landing row when the toggle is flipped off after starting on", async () => {
    /** start with equal coords (toggle on); flipping off remounts the landing row. */
    const sharedPoint = {
      type: "Point" as const,
      coordinates: [17.21, 48.17, 133] as [number, number, number],
    };
    setupMocks({
      ...baseMission,
      takeoff_coordinate: sharedPoint,
      landing_coordinate: sharedPoint,
    });
    renderPage();

    const toggle = await screen.findByTestId("use-takeoff-as-landing-checkbox");
    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-checked", "true");
    });
    expect(
      screen.queryByTestId("mission.config.landingcoordinate-lat"),
    ).not.toBeInTheDocument();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-checked", "false");
    });
    expect(
      screen.getByTestId("mission.config.landingcoordinate-lat"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("mission.config.takeoffcoordinate-lat"),
    ).toBeInTheDocument();
  });
});
