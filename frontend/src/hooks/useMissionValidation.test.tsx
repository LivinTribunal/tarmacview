import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import useMissionValidation from "./useMissionValidation";

const mockGetMission = vi.fn();
const mockGetFlightPlan = vi.fn();
const mockExportMissionFiles = vi.fn();
const mockValidateMission = vi.fn();
const mockCompleteMission = vi.fn();
const mockCancelMission = vi.fn();
const mockDeleteMission = vi.fn();
const mockListDroneProfiles = vi.fn();
const mockDownloadMissionReport = vi.fn();

vi.mock("@/api/missions", () => ({
  getMission: (...a: unknown[]) => mockGetMission(...a),
  getFlightPlan: (...a: unknown[]) => mockGetFlightPlan(...a),
  exportMissionFiles: (...a: unknown[]) => mockExportMissionFiles(...a),
  validateMission: (...a: unknown[]) => mockValidateMission(...a),
  completeMission: (...a: unknown[]) => mockCompleteMission(...a),
  cancelMission: (...a: unknown[]) => mockCancelMission(...a),
  deleteMission: (...a: unknown[]) => mockDeleteMission(...a),
  downloadMissionReport: (...a: unknown[]) => mockDownloadMissionReport(...a),
}));
vi.mock("@/api/droneProfiles", () => ({
  listDroneProfiles: (...a: unknown[]) => mockListDroneProfiles(...a),
}));

const MISSION = {
  id: "m-1",
  name: "Test",
  status: "PLANNED",
  airport_id: "apt-1",
  inspections: [],
  takeoff_coordinate: null,
  landing_coordinate: null,
  flight_plan_scope: "FULL",
  updated_at: "2026-04-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMission.mockResolvedValue(MISSION);
  mockGetFlightPlan.mockResolvedValue({
    id: "fp-1",
    waypoints: [],
    validation_result: { violations: [] },
  });
  mockListDroneProfiles.mockResolvedValue({ data: [], meta: { total: 0 } });
  mockExportMissionFiles.mockResolvedValue({
    kind: "file",
    blob: new Blob(["x"]),
    filename: "Mission.kml",
  });
  mockValidateMission.mockResolvedValue({});
  mockCompleteMission.mockResolvedValue({});
  mockCancelMission.mockResolvedValue({});
  mockDeleteMission.mockResolvedValue({});
  // suppress jsdom anchor.click navigation noise
  vi.spyOn(window.URL, "createObjectURL").mockReturnValue("blob:test");
  vi.spyOn(window.URL, "revokeObjectURL").mockImplementation(() => {});
});

describe("useMissionValidation", () => {
  it("loads mission + flight plan + drone profiles on mount", async () => {
    const onMissionUpdated = vi.fn();
    const refreshMissions = vi.fn();
    const { result } = renderHook(() =>
      useMissionValidation({
        id: "m-1",
        onMissionUpdated,
        refreshMissions,
      }),
    );
    await waitFor(() => expect(result.current.isInitialLoad).toBe(false));

    expect(mockGetMission).toHaveBeenCalledWith("m-1");
    expect(mockListDroneProfiles).toHaveBeenCalled();
    expect(mockGetFlightPlan).toHaveBeenCalledWith("m-1");
    expect(onMissionUpdated).toHaveBeenCalledWith(MISSION);
    expect(refreshMissions).toHaveBeenCalled();
  });

  it("export performs the anchor-download dance and refetches data", async () => {
    const { result } = renderHook(() =>
      useMissionValidation({
        id: "m-1",
        onMissionUpdated: vi.fn(),
        refreshMissions: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.isInitialLoad).toBe(false));

    mockGetMission.mockClear();

    await act(async () => {
      await result.current.handleExport(["KML"]);
    });
    expect(mockExportMissionFiles).toHaveBeenCalledWith("m-1", ["KML"], {});
    expect(window.URL.createObjectURL).toHaveBeenCalled();
    expect(window.URL.revokeObjectURL).toHaveBeenCalled();
    // refetch after export
    expect(mockGetMission).toHaveBeenCalled();
  });

  it("surfaces clampWarning and skips the blob anchor dance", async () => {
    const clamps = [
      { waypoint_index: 4, intended_alt: 290.5, clamped_alt: 300, reason: "below_takeoff" },
    ];
    mockExportMissionFiles.mockResolvedValueOnce({ kind: "clamp_warning", clamps });

    const { result } = renderHook(() =>
      useMissionValidation({
        id: "m-1",
        onMissionUpdated: vi.fn(),
        refreshMissions: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.isInitialLoad).toBe(false));

    (window.URL.createObjectURL as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      await result.current.handleExport(["KMZ"]);
    });

    expect(result.current.clampWarning).toEqual(clamps);
    // blob anchor dance must be skipped on the clamp_warning path
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("re-exports with acknowledge_altitude_clamps on retry", async () => {
    const { result } = renderHook(() =>
      useMissionValidation({
        id: "m-1",
        onMissionUpdated: vi.fn(),
        refreshMissions: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.isInitialLoad).toBe(false));

    await act(async () => {
      await result.current.handleExport(["KMZ"], { acknowledge_altitude_clamps: true });
    });

    expect(mockExportMissionFiles).toHaveBeenCalledWith("m-1", ["KMZ"], {
      acknowledge_altitude_clamps: true,
    });
    // success path clears any previous clamp warning
    expect(result.current.clampWarning).toBeNull();
  });

  it("dismissClampWarning clears the warning", async () => {
    const clamps = [
      { waypoint_index: 1, intended_alt: 250, clamped_alt: 260, reason: "below_takeoff" },
    ];
    mockExportMissionFiles.mockResolvedValueOnce({ kind: "clamp_warning", clamps });

    const { result } = renderHook(() =>
      useMissionValidation({
        id: "m-1",
        onMissionUpdated: vi.fn(),
        refreshMissions: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.isInitialLoad).toBe(false));

    await act(async () => {
      await result.current.handleExport(["KMZ"]);
    });
    expect(result.current.clampWarning).not.toBeNull();

    act(() => {
      result.current.dismissClampWarning();
    });
    expect(result.current.clampWarning).toBeNull();
  });

  it("handleDelete returns true on success and false on failure", async () => {
    const { result } = renderHook(() =>
      useMissionValidation({
        id: "m-1",
        onMissionUpdated: vi.fn(),
        refreshMissions: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.isInitialLoad).toBe(false));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.handleDelete();
    });
    expect(ok).toBe(true);

    mockDeleteMission.mockRejectedValueOnce(new Error("boom"));
    await act(async () => {
      ok = await result.current.handleDelete();
    });
    expect(ok).toBe(false);
  });
});
