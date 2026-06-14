import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import MissionConfigForm from "./MissionConfigForm";
import { listCameraPresets } from "@/api/cameraPresets";
import type { CameraPresetResponse } from "@/types/cameraPreset";
import type { MissionDetailResponse, MissionUpdate } from "@/types/mission";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("@/api/cameraPresets", () => ({
  listCameraPresets: vi.fn().mockResolvedValue({ data: [] }),
}));

const baseMission: MissionDetailResponse = {
  id: "m-1",
  name: "Heading Toggle Mission",
  status: "VALIDATED",
  airport_id: "a-1",
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
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
  dji_heading_mode: "smoothTransition",
  inspections: [],
};

function ControlledForm({
  mission,
  onPatch,
}: {
  mission: MissionDetailResponse;
  onPatch: (patch: Partial<MissionUpdate>) => void;
}) {
  /** lift form state so onChange edits round-trip back through values. */
  const [values, setValues] = useState<Partial<MissionUpdate>>({});
  return (
    <MissionConfigForm
      mission={mission}
      droneProfiles={[]}
      values={values}
      onChange={(patch) => {
        setValues((prev) => ({ ...prev, ...patch }));
        onPatch(patch);
      }}
    />
  );
}

describe("MissionConfigForm - dji_heading_mode picker", () => {
  it("does not render the heading-mode select - it lives in ExportPanel now", () => {
    render(<ControlledForm mission={baseMission} onPatch={vi.fn()} />);

    expect(screen.queryByTestId("dji-heading-mode-select")).toBeNull();
  });
});

describe("MissionConfigForm - control labels", () => {
  it("links the transit-speed input to a label via htmlFor/id", () => {
    const { container } = render(
      <ControlledForm mission={baseMission} onPatch={vi.fn()} />,
    );
    const input = screen.getByTestId("default-speed-input");
    const id = input.getAttribute("id");
    expect(id).toBeTruthy();
    expect(container.querySelector(`label[for="${id}"]`)).not.toBeNull();
  });
});

const presetA: CameraPresetResponse = {
  id: "preset-a",
  name: "Preset A",
  drone_profile_id: null,
  created_by: null,
  is_default: true,
  white_balance: "DAYLIGHT",
  iso: 400,
  shutter_speed: "1/500",
  focus_mode: "INFINITY",
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
};

describe("MissionConfigForm - useMissionConfigValues extraction", () => {
  /** the hook now owns field resolution + preset handlers; behavior must be unchanged. */

  it("resolves each field from values over mission", () => {
    render(
      <MissionConfigForm
        mission={{ ...baseMission, default_speed: 5 }}
        droneProfiles={[]}
        values={{ default_speed: 9 }}
        onChange={vi.fn()}
      />,
    );
    expect(
      (screen.getByTestId("default-speed-input") as HTMLInputElement).value,
    ).toBe("9");
  });

  it("preloads the default preset payload on AUTO -> MANUAL", async () => {
    vi.mocked(listCameraPresets).mockResolvedValue({ data: [presetA] } as Awaited<
      ReturnType<typeof listCameraPresets>
    >);
    const onPatch = vi.fn();
    render(<ControlledForm mission={baseMission} onPatch={onPatch} />);

    await waitFor(() => expect(vi.mocked(listCameraPresets)).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByTestId("mission-camera-mode-manual"));
    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith({
        camera_mode: "MANUAL",
        default_white_balance: "DAYLIGHT",
        default_iso: 400,
        default_shutter_speed: "1/500",
        default_focus_mode: "INFINITY",
      }),
    );
  });

  it("emits the exact onChange payload when a preset is applied", async () => {
    vi.mocked(listCameraPresets).mockResolvedValue({ data: [presetA] } as Awaited<
      ReturnType<typeof listCameraPresets>
    >);
    const onPatch = vi.fn();
    render(
      <ControlledForm
        mission={{ ...baseMission, camera_mode: "MANUAL" }}
        onPatch={onPatch}
      />,
    );

    const select = (await screen.findByTestId(
      "mission-camera-preset-select",
    )) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "preset-a" } });

    expect(onPatch).toHaveBeenCalledWith({
      camera_mode: "MANUAL",
      default_white_balance: "DAYLIGHT",
      default_iso: 400,
      default_shutter_speed: "1/500",
      default_focus_mode: "INFINITY",
    });
  });

  it("auto-matches the applied preset on reload in MANUAL mode", async () => {
    vi.mocked(listCameraPresets).mockResolvedValue({ data: [presetA] } as Awaited<
      ReturnType<typeof listCameraPresets>
    >);
    render(
      <ControlledForm
        mission={{
          ...baseMission,
          camera_mode: "MANUAL",
          default_white_balance: "DAYLIGHT",
          default_iso: 400,
          default_shutter_speed: "1/500",
          default_focus_mode: "INFINITY",
        }}
        onPatch={vi.fn()}
      />,
    );

    const select = (await screen.findByTestId(
      "mission-camera-preset-select",
    )) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("preset-a"));
  });
});
