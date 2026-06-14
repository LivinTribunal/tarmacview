import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { AirportResponse } from "@/types/airport";
import OperatorDronesPage from "./OperatorDronesPage";

const mockListDroneProfiles = vi.fn();

vi.mock("@/api/droneProfiles", () => ({
  listDroneProfiles: (...args: unknown[]) => mockListDroneProfiles(...args),
}));

const mockSetDefaultDrone = vi.fn();

vi.mock("@/api/airports", () => ({
  setDefaultDrone: (...args: unknown[]) => mockSetDefaultDrone(...args),
  bulkChangeDrone: vi.fn(),
}));

const mockRefreshAirportDetail = vi.fn();
let mockSelectedAirport: Partial<AirportResponse> | null = null;

vi.mock("@/contexts/AirportContext", () => ({
  useAirport: () => ({
    selectedAirport: mockSelectedAirport,
    refreshAirportDetail: mockRefreshAirportDetail,
  }),
}));

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const DRONE_1 = {
  id: "d-1",
  name: "Matrice 300",
  manufacturer: "DJI",
  model: "M300 RTK",
  max_speed: 23,
  max_climb_rate: 6,
  max_altitude: 5000,
  battery_capacity: 5935,
  endurance_minutes: 55,
  camera_resolution: "20MP",
  camera_frame_rate: 30,
  sensor_fov: 84,
  weight: 6.3,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-15T00:00:00Z",
  mission_count: 3,
  model_identifier: null,
  max_optical_zoom: null,
};

const DRONE_2 = {
  ...DRONE_1,
  id: "d-2",
  name: "Mavic 3E",
  model: "Mavic 3 Enterprise",
  mission_count: 1,
};

function makeAirport(defaultDroneId: string | null): Partial<AirportResponse> {
  return {
    id: "apt-1",
    name: "Test Airport",
    icao_code: "LZTT",
    default_drone_profile_id: defaultDroneId,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <OperatorDronesPage />
    </MemoryRouter>,
  );
}

describe("OperatorDronesPage default toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockListDroneProfiles.mockResolvedValue({
      data: [DRONE_1, DRONE_2],
      meta: { total: 2 },
    });
    mockSetDefaultDrone.mockResolvedValue({});
    mockSelectedAirport = makeAirport(null);
  });

  it("sets the drone as default when it is not the current default", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("drone-row-d-1")).toBeInTheDocument();
    });

    const row = screen.getByTestId("drone-row-d-1");
    fireEvent.click(within(row).getByTitle("operatorDrones.setDefault"));

    await waitFor(() => {
      expect(mockSetDefaultDrone).toHaveBeenCalledWith("apt-1", "d-1");
    });
    expect(mockRefreshAirportDetail).toHaveBeenCalled();

    // set-branch toast; unique because no row shows the default badge yet
    expect(
      await screen.findByText("operatorDrones.defaultBadge"),
    ).toBeInTheDocument();
  });

  it("clears the default when the drone is already the default", async () => {
    mockSelectedAirport = makeAirport("d-1");
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("drone-row-d-1")).toBeInTheDocument();
    });

    // the current default row exposes the remove action instead of set
    const row = screen.getByTestId("drone-row-d-1");
    fireEvent.click(within(row).getByTitle("operatorDrones.removeDefault"));

    await waitFor(() => {
      expect(mockSetDefaultDrone).toHaveBeenCalledWith("apt-1", null);
    });
    expect(mockRefreshAirportDetail).toHaveBeenCalled();

    // clear-branch toast; the icon button carries the key only as title, not text
    expect(
      await screen.findByText("operatorDrones.removeDefault"),
    ).toBeInTheDocument();
  });

  it("keeps the set action on non-default rows when another drone is default", async () => {
    mockSelectedAirport = makeAirport("d-1");
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("drone-row-d-2")).toBeInTheDocument();
    });

    const row = screen.getByTestId("drone-row-d-2");
    fireEvent.click(within(row).getByTitle("operatorDrones.setDefault"));

    await waitFor(() => {
      expect(mockSetDefaultDrone).toHaveBeenCalledWith("apt-1", "d-2");
    });
  });

  it("shows the error toast and skips the refresh when the toggle fails", async () => {
    mockSetDefaultDrone.mockRejectedValue(new Error("network"));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("drone-row-d-1")).toBeInTheDocument();
    });

    const row = screen.getByTestId("drone-row-d-1");
    fireEvent.click(within(row).getByTitle("operatorDrones.setDefault"));

    expect(await screen.findByText("common.error")).toBeInTheDocument();
    expect(mockRefreshAirportDetail).not.toHaveBeenCalled();
  });
});
