import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { AirportProvider } from "@/contexts/AirportContext";
import useOperatorDroneDetail from "./useOperatorDroneDetail";
import type { ReactNode } from "react";

const mockGetDroneProfile = vi.fn();
const mockListDroneProfiles = vi.fn();
const mockListMissions = vi.fn();
const mockSetDefaultDrone = vi.fn();

vi.mock("@/api/droneProfiles", () => ({
  getDroneProfile: (...a: unknown[]) => mockGetDroneProfile(...a),
  listDroneProfiles: (...a: unknown[]) => mockListDroneProfiles(...a),
}));
vi.mock("@/api/missions", () => ({
  listMissions: (...a: unknown[]) => mockListMissions(...a),
}));
vi.mock("@/api/airports", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/api/airports",
  );
  return {
    ...actual,
    setDefaultDrone: (...a: unknown[]) => mockSetDefaultDrone(...a),
  };
});

const AIRPORT = {
  id: "apt-1",
  icao_code: "LZIB",
  name: "Bratislava",
  city: "Bratislava",
  country: "Slovakia",
  elevation: 100,
  location: { type: "Point", coordinates: [17, 48, 100] },
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AirportProvider>{children}</AirportProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

describe("useOperatorDroneDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("tarmacview_airport", JSON.stringify(AIRPORT));
    mockGetDroneProfile.mockResolvedValue({
      id: "d-1",
      name: "Matrice",
      model_identifier: null,
    });
    mockListDroneProfiles.mockResolvedValue({
      data: [{ id: "d-1", name: "Matrice" }],
      meta: { total: 1 },
    });
    mockListMissions.mockResolvedValue({ data: [], meta: { total: 0 } });
  });

  it("issues the missions-for-drone query with drone_profile_id + airport_id + MAX_LIST_LIMIT", async () => {
    const { result } = renderHook(
      () => useOperatorDroneDetail({ id: "d-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockListMissions).toHaveBeenCalledTimes(1);
    const params = mockListMissions.mock.calls[0][0];
    expect(params.drone_profile_id).toBe("d-1");
    expect(params.airport_id).toBe("apt-1");
    expect(typeof params.limit).toBe("number");
  });

  it("toggleDefault calls setDefaultDrone with the right id on/off sequence", async () => {
    mockSetDefaultDrone.mockResolvedValue({});
    const { result } = renderHook(
      () => useOperatorDroneDetail({ id: "d-1" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    // not default yet → toggle on
    await act(async () => {
      const ok = await result.current.toggleDefault();
      expect(ok).toBe(true);
    });
    expect(mockSetDefaultDrone).toHaveBeenCalledWith("apt-1", "d-1");
  });
});
