import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import type { AirportDetailResponse, AGLCreate } from "@/types/airport";

// stub heavy children so we don't boot maplibre or render full panels
// the page passes overlays (incl. CreationForm) through `children` and `leftPanelChildren`
vi.mock("@/components/map/AirportMap", () => ({
  default: (props: { children?: ReactNode; leftPanelChildren?: ReactNode }) => (
    <div data-testid="airport-map">
      {props.leftPanelChildren}
      {props.children}
    </div>
  ),
}));
vi.mock("@/components/coordinator/InfrastructureListPanel", () => ({
  default: () => <div data-testid="infrastructure-list-panel" />,
}));
vi.mock("@/components/map/overlays/AGLPanel", () => ({
  default: () => <div data-testid="coordinator-agl-panel" />,
}));
vi.mock("@/components/coordinator/AirportInfoPanel", () => ({
  default: () => <div data-testid="airport-info-panel" />,
}));
vi.mock("@/components/coordinator/TerrainSettingsCard", () => ({
  default: () => <div data-testid="terrain-settings-card" />,
}));
vi.mock("@/components/coordinator/MapDrawingToolbar", () => ({
  default: () => <div data-testid="map-drawing-toolbar" />,
}));
vi.mock("@/components/map/overlays/MapHelpPanel", () => ({
  default: () => <div data-testid="map-help-panel" />,
}));
vi.mock("@/components/map/overlays/LegendPanel", () => ({
  default: () => <div data-testid="legend-panel" />,
}));

// capture usePlacePoint's onComplete so the test can drive the pending-point flow
let placePointOnComplete: ((point: [number, number]) => void) | undefined;
vi.mock("@/hooks/usePlacePoint", () => ({
  default: (
    _map: unknown,
    _active: boolean,
    onComplete: (p: [number, number]) => void,
  ) => {
    placePointOnComplete = onComplete;
  },
}));

// other drawing/edit hooks - noop
vi.mock("@/hooks/useDrawPolygon", () => ({ default: () => undefined }));
vi.mock("@/hooks/useDrawCircle", () => ({ default: () => undefined }));
vi.mock("@/hooks/useDrawRectangle", () => ({ default: () => undefined }));
vi.mock("@/hooks/useVertexEditor", () => ({ default: () => undefined }));
vi.mock("@/hooks/useMeasureDistance", () => ({
  default: () => ({
    points: [],
    pointsGeoJSON: { type: "FeatureCollection", features: [] },
    linesGeoJSON: { type: "FeatureCollection", features: [] },
    labelsGeoJSON: { type: "FeatureCollection", features: [] },
    totalDistance: 0,
    segments: [],
    isDrawing: false,
    isComplete: false,
    setCursor: vi.fn(),
    finishDrawing: vi.fn(),
    clear: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock("@/hooks/useHeadingTool", () => ({
  default: () => ({
    bearing: null,
    pointGeoJSON: { type: "FeatureCollection", features: [] },
    lineGeoJSON: { type: "FeatureCollection", features: [] },
    labelGeoJSON: { type: "FeatureCollection", features: [] },
    origin: null,
    isDrawing: false,
    isComplete: false,
    clear: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// capture CreationForm's onCreate prop so the test can invoke it directly
type CreationFormCapture = {
  onCreate?: (entityType: string, data: Record<string, unknown>) => Promise<void>;
  pointPosition?: [number, number];
};
const creationFormProps: CreationFormCapture[] = [];
vi.mock("@/components/coordinator/CreationForm", () => ({
  default: (props: CreationFormCapture) => {
    creationFormProps.push(props);
    return <div data-testid="creation-form" />;
  },
}));

const { mockAirport } = vi.hoisted(() => {
  const airport: AirportDetailResponse = {
    id: "apt-1",
    icao_code: "LZIB",
    name: "Bratislava",
    city: "Bratislava",
    country: "Slovakia",
    elevation: 133,
    location: { type: "Point", coordinates: [17.21, 48.17, 133] },
    default_drone_profile_id: null,
    terrain_source: "FLAT",
    has_dem: false,
    surfaces: [
      {
        id: "srf-1",
        airport_id: "apt-1",
        identifier: "RWY 22",
        surface_type: "RUNWAY",
        geometry: { type: "LineString", coordinates: [] },
        boundary: null,
        buffer_distance: 5.0,
        heading: 220,
        length: 3190,
        width: 45,
        threshold_position: null,
        end_position: null,
        touchpoint_latitude: null,
        touchpoint_longitude: null,
        touchpoint_altitude: null,
        paired_surface_id: null,
        agls: [],
      },
    ],
    obstacles: [],
    safety_zones: [],
  };
  return { mockAirport: airport };
});

vi.mock("@/api/airports", () => ({
  getAirport: vi.fn().mockResolvedValue(mockAirport),
  createAGL: vi.fn().mockResolvedValue({}),
  createSurface: vi.fn().mockResolvedValue({}),
  createObstacle: vi.fn().mockResolvedValue({}),
  createSafetyZone: vi.fn().mockResolvedValue({}),
  createLHA: vi.fn().mockResolvedValue({}),
  deleteAirport: vi.fn().mockResolvedValue({}),
  deleteSurface: vi.fn().mockResolvedValue({}),
  deleteObstacle: vi.fn().mockResolvedValue({}),
  deleteSafetyZone: vi.fn().mockResolvedValue({}),
  deleteAGL: vi.fn().mockResolvedValue({}),
  deleteLHA: vi.fn().mockResolvedValue({}),
  updateSurface: vi.fn().mockResolvedValue({}),
  updateObstacle: vi.fn().mockResolvedValue({}),
  updateSafetyZone: vi.fn().mockResolvedValue({}),
  updateAGL: vi.fn().mockResolvedValue({}),
  updateLHA: vi.fn().mockResolvedValue({}),
  updateAirport: vi.fn().mockResolvedValue({}),
  fetchElevationAt: vi.fn().mockResolvedValue({ elevation: 0, source: "FLAT" }),
}));

vi.mock("@/contexts/AirportContext", () => ({
  useAirport: () => ({
    airportDetail: mockAirport,
    selectedAirport: mockAirport,
    airportDetailLoading: false,
    airportDetailError: false,
    selectAirport: vi.fn(),
    clearAirport: vi.fn(),
    refreshAirportDetail: vi.fn(),
  }),
}));

vi.mock("@/hooks/useElevationResolver", () => ({
  useElevationResolver: () => undefined,
}));

// import after mocks so the page picks them up
import AirportEditPage from "./AirportEditPage";

function renderPage() {
  /** mount the page with a route that supplies the airport id param. */
  return render(
    <MemoryRouter initialEntries={["/coordinator-center/airports/apt-1"]}>
      <Routes>
        <Route path="/coordinator-center/airports/:id" element={<AirportEditPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AirportEditPage handleCreate altitude wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    creationFormProps.length = 0;
    placePointOnComplete = undefined;
  });

  it("forwards data.altitude into createAGL position[2] - not airport.elevation", async () => {
    /** the gap-481 regression guard: user-entered alt must flow into the payload. */
    const { createAGL } = await import("@/api/airports");
    renderPage();

    // wait for usePlacePoint to register its onComplete callback
    await waitFor(() => {
      expect(placePointOnComplete).toBeDefined();
    });

    // simulate placing a point - this sets pendingPointPosition and renders CreationForm
    await act(async () => {
      placePointOnComplete!([17.21, 48.17]);
      // allow any state-update microtasks to drain before assertions
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("creation-form")).toBeInTheDocument();
    });

    const lastProps = creationFormProps[creationFormProps.length - 1];
    expect(lastProps.onCreate).toBeTypeOf("function");

    // invoke onCreate with a user-entered altitude distinct from airport.elevation
    await act(async () => {
      await lastProps.onCreate!("agl", {
        name: "PAPI test",
        agl_type: "PAPI",
        surface_id: "srf-1",
        side: "LEFT",
        glide_slope_angle: 3.0,
        distance_from_threshold: 300,
        altitude: 42.5,
      });
    });

    expect(createAGL).toHaveBeenCalledTimes(1);
    const [airportId, surfaceId, payload] = vi.mocked(createAGL).mock.calls[0] as [
      string,
      string,
      AGLCreate,
    ];
    expect(airportId).toBe("apt-1");
    expect(surfaceId).toBe("srf-1");
    expect(payload.position.coordinates[2]).toBe(42.5);
    expect(payload.position.coordinates[2]).not.toBe(mockAirport.elevation);
  });
});
