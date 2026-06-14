import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import useDroneProfileList, { compareDrone } from "./useDroneProfileList";
import type { DroneProfileResponse } from "@/types/droneProfile";

const mockListDroneProfiles = vi.fn();

vi.mock("@/api/droneProfiles", () => ({
  listDroneProfiles: (...args: unknown[]) => mockListDroneProfiles(...args),
}));

function drone(overrides: Partial<DroneProfileResponse> = {}): DroneProfileResponse {
  return {
    id: "d-1",
    name: "Matrice 300",
    manufacturer: "DJI",
    model: "M300",
    max_speed: 23,
    max_climb_rate: 6,
    max_altitude: 5000,
    battery_capacity: 5935,
    endurance_minutes: 55,
    camera_resolution: "20MP",
    camera_frame_rate: 30,
    sensor_fov: 84,
    weight: 6.3,
    model_identifier: null,
    max_optical_zoom: null,
    sensor_base_focal_length: null,
    default_optical_zoom: null,
    supports_geozone_upload: false,
    supports_dji_wpml: false,
    is_dji: false,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-15T00:00:00Z",
    mission_count: 3,
    ...overrides,
  };
}

const DRONES = [
  drone({ id: "d-1", name: "Matrice 300", manufacturer: "DJI" }),
  drone({
    id: "d-2",
    name: "Alpha",
    manufacturer: "Autel",
    max_speed: 15,
    endurance_minutes: 40,
    mission_count: 1,
  }),
  drone({
    id: "d-3",
    name: "Beta",
    manufacturer: "DJI",
    max_speed: 30,
    endurance_minutes: 60,
    mission_count: 5,
  }),
];

describe("compareDrone", () => {
  it("orders numeric columns ascending across all numeric keys", () => {
    const sorted = [...DRONES];
    sorted.sort((a, b) => compareDrone(a, b, "max_speed"));
    expect(sorted.map((d) => d.id)).toEqual(["d-2", "d-1", "d-3"]);

    sorted.sort((a, b) => compareDrone(a, b, "endurance_minutes"));
    expect(sorted.map((d) => d.id)).toEqual(["d-2", "d-1", "d-3"]);

    sorted.sort((a, b) => compareDrone(a, b, "mission_count"));
    expect(sorted.map((d) => d.id)).toEqual(["d-2", "d-1", "d-3"]);
  });

  it("orders string columns by localeCompare", () => {
    const sorted = [...DRONES].sort((a, b) => compareDrone(a, b, "name"));
    expect(sorted.map((d) => d.id)).toEqual(["d-2", "d-3", "d-1"]);

    const byManufacturer = [...DRONES].sort((a, b) =>
      compareDrone(a, b, "manufacturer"),
    );
    expect(byManufacturer[0].manufacturer).toBe("Autel");

    const byModel = [...DRONES].sort((a, b) => compareDrone(a, b, "model"));
    expect(byModel.map((d) => d.id).length).toBe(3);
  });

  it("treats null numeric fields as -1 so they sort to the bottom asc", () => {
    const dNull = drone({ id: "d-null", max_speed: null });
    const result = [DRONES[0], dNull].sort((a, b) =>
      compareDrone(a, b, "max_speed"),
    );
    expect(result.map((d) => d.id)).toEqual(["d-null", "d-1"]);
  });
});

describe("useDroneProfileList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListDroneProfiles.mockResolvedValue({
      data: DRONES,
      meta: { total: DRONES.length },
    });
  });

  it("fetches drones on mount and exposes them", async () => {
    const { result } = renderHook(() => useDroneProfileList());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.drones).toHaveLength(3);
    expect(result.current.error).toBe(false);
  });

  it("filters by search query (case-insensitive name contains)", async () => {
    const { result } = renderHook(() => useDroneProfileList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleSearchChange({
        target: { value: "alpha" },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(result.current.sorted.map((d) => d.id)).toEqual(["d-2"]);
    expect(result.current.page).toBe(0);
  });

  it("filters by manufacturer dropdown", async () => {
    const { result } = renderHook(() => useDroneProfileList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.handleManufacturerChange("Autel"));
    expect(result.current.sorted.map((d) => d.id)).toEqual(["d-2"]);
  });

  it("paginates the sorted rows", async () => {
    const { result } = renderHook(() => useDroneProfileList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.handlePageSizeChange(2));
    expect(result.current.paged).toHaveLength(2);
    expect(result.current.page).toBe(0);

    act(() => result.current.setPage(1));
    expect(result.current.paged).toHaveLength(1);
  });

  it("derives the manufacturer dropdown values sorted alphabetically", async () => {
    const { result } = renderHook(() => useDroneProfileList());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.manufacturers).toEqual(["Autel", "DJI"]);
  });

  it("starts numeric sort descending when switching from a string key", async () => {
    const { result } = renderHook(() => useDroneProfileList());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.handleSort("max_speed"));
    expect(result.current.sortKey).toBe("max_speed");
    expect(result.current.sortDir).toBe("desc");
    expect(result.current.sorted.map((d) => d.id)).toEqual(["d-3", "d-1", "d-2"]);
  });

  it("produces the same sort order for the same input across pages (dedup proof)", async () => {
    const { result: a } = renderHook(() => useDroneProfileList());
    const { result: b } = renderHook(() => useDroneProfileList());
    await waitFor(() => expect(a.current.loading).toBe(false));
    await waitFor(() => expect(b.current.loading).toBe(false));

    act(() => a.current.handleSort("endurance_minutes"));
    act(() => b.current.handleSort("endurance_minutes"));

    expect(a.current.sorted.map((d) => d.id)).toEqual(
      b.current.sorted.map((d) => d.id),
    );
  });
});
