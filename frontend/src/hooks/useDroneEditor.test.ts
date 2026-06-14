import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import useDroneEditor from "./useDroneEditor";
import {
  getDroneProfile,
  listDroneProfiles,
  updateDroneProfile,
  uploadDroneModel,
} from "@/api/droneProfiles";
import { listMissions } from "@/api/missions";
import { AUTOSAVE_DEBOUNCE_MS } from "@/constants/ui";
import type { DroneProfileResponse } from "@/types/droneProfile";

// page-level behavior (autosave debounce, empty-name guard, save-error banner,
// duplicate/delete/create) is owned by DroneEditPage.test.tsx - here we cover
// the nav flush and the model select/remove/upload state machine only

vi.mock("@/api/droneProfiles", () => ({
  getDroneProfile: vi.fn(),
  listDroneProfiles: vi.fn(),
  createDroneProfile: vi.fn(),
  updateDroneProfile: vi.fn(),
  deleteDroneProfile: vi.fn(),
  uploadDroneModel: vi.fn(),
}));

vi.mock("@/api/missions", () => ({
  listMissions: vi.fn(),
}));

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ id: "d-1" }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const DRONE = {
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
  model_identifier: null,
  max_optical_zoom: null,
  sensor_base_focal_length: null,
  default_optical_zoom: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  mission_count: 0,
} as unknown as DroneProfileResponse;

async function setup() {
  /** mount the hook and wait for the initial fetch to settle. */
  const view = renderHook(() => useDroneEditor());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(getDroneProfile).mockResolvedValue(DRONE as never);
  vi.mocked(listDroneProfiles).mockResolvedValue({
    data: [DRONE],
    meta: { total: 1 },
  } as never);
  vi.mocked(listMissions).mockResolvedValue({ data: [], meta: { total: 0 } } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDroneEditor drone-switch flush", () => {
  it("flushes the pending autosave before navigating to another drone", async () => {
    const view = await setup();
    vi.mocked(updateDroneProfile).mockResolvedValue({
      ...DRONE,
      name: "Edited",
    } as never);

    act(() => {
      view.result.current.handleFieldChange("name", "Edited");
    });
    expect(updateDroneProfile).not.toHaveBeenCalled();

    await act(async () => {
      view.result.current.handleSelectDrone("d-2");
    });

    expect(updateDroneProfile).toHaveBeenCalledTimes(1);
    expect(updateDroneProfile).toHaveBeenCalledWith(
      "d-1",
      expect.objectContaining({ name: "Edited" }),
    );
    expect(mockNavigate).toHaveBeenCalledWith("/coordinator-center/drones/d-2");

    // the save is issued before the navigation
    expect(vi.mocked(updateDroneProfile).mock.invocationCallOrder[0]).toBeLessThan(
      mockNavigate.mock.invocationCallOrder[0],
    );

    // the debounce was cancelled - advancing time must not double-save
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS * 2);
    });
    expect(updateDroneProfile).toHaveBeenCalledTimes(1);
  });

  it("does not flush when the form is clean", async () => {
    const view = await setup();

    await act(async () => {
      view.result.current.handleSelectDrone("d-2");
    });

    expect(updateDroneProfile).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/coordinator-center/drones/d-2");
  });

  it("does not flush when the edited name is blank", async () => {
    const view = await setup();

    act(() => {
      view.result.current.handleFieldChange("name", "   ");
    });
    await act(async () => {
      view.result.current.handleSelectDrone("d-2");
    });

    expect(updateDroneProfile).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/coordinator-center/drones/d-2");
  });
});

describe("useDroneEditor model selection", () => {
  it("selects a bundled model and saves immediately", async () => {
    const view = await setup();
    vi.mocked(updateDroneProfile).mockResolvedValue({
      ...DRONE,
      model_identifier: "dji-m300",
    } as never);

    await act(async () => {
      await view.result.current.handleSelectModel("dji-m300");
    });

    expect(updateDroneProfile).toHaveBeenCalledWith("d-1", {
      model_identifier: "dji-m300",
    });
    expect(view.result.current.drone?.model_identifier).toBe("dji-m300");
    expect(view.result.current.lastSaved).not.toEqual(new Date(DRONE.updated_at));
  });

  it("toasts saveError when selecting a model fails", async () => {
    const view = await setup();
    vi.mocked(updateDroneProfile).mockRejectedValue(new Error("boom"));

    await act(async () => {
      await view.result.current.handleSelectModel("dji-m300");
    });

    expect(view.result.current.notification).toBe("coordinator.drones.detail.saveError");
    expect(view.result.current.drone?.model_identifier).toBeNull();
  });

  it("removes the model selection and saves immediately", async () => {
    vi.mocked(getDroneProfile).mockResolvedValue({
      ...DRONE,
      model_identifier: "dji-m300",
    } as never);
    const view = await setup();
    vi.mocked(updateDroneProfile).mockResolvedValue({
      ...DRONE,
      model_identifier: null,
    } as never);

    await act(async () => {
      await view.result.current.handleRemoveModel();
    });

    expect(updateDroneProfile).toHaveBeenCalledWith("d-1", {
      model_identifier: null,
    });
    expect(view.result.current.drone?.model_identifier).toBeNull();
  });

  it("toasts saveError when removing the model fails", async () => {
    const view = await setup();
    vi.mocked(updateDroneProfile).mockRejectedValue(new Error("boom"));

    await act(async () => {
      await view.result.current.handleRemoveModel();
    });

    expect(view.result.current.notification).toBe("coordinator.drones.detail.saveError");
  });

  it("uploads a custom model and merges the returned identifier", async () => {
    const view = await setup();
    vi.mocked(uploadDroneModel).mockResolvedValue({
      model_identifier: "custom-1.glb",
    } as never);
    const file = new File(["bin"], "model.glb");

    await act(async () => {
      await view.result.current.handleUploadCustomModel(file);
    });

    expect(uploadDroneModel).toHaveBeenCalledWith("d-1", file);
    expect(view.result.current.drone?.model_identifier).toBe("custom-1.glb");
    expect(view.result.current.lastSaved).not.toEqual(new Date(DRONE.updated_at));
  });

  it("toasts invalidFileType when the upload fails", async () => {
    const view = await setup();
    vi.mocked(uploadDroneModel).mockRejectedValue(new Error("bad file"));

    await act(async () => {
      await view.result.current.handleUploadCustomModel(new File(["x"], "m.glb"));
    });

    expect(view.result.current.notification).toBe("drone.invalidFileType");
    expect(view.result.current.drone?.model_identifier).toBeNull();
  });
});
