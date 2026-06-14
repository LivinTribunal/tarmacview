import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import useInspectionConfig from "./useInspectionConfig";
import type {
  InspectionResponse,
  InspectionConfigOverride,
  MissionDetailResponse,
} from "@/types/mission";

const listCameraPresets = vi.fn();
const createCameraPreset = vi.fn();
vi.mock("@/api/cameraPresets", () => ({
  listCameraPresets: (...args: unknown[]) => listCameraPresets(...args),
  createCameraPreset: (...args: unknown[]) => createCameraPreset(...args),
}));

const baseInspection = (
  overrides: Partial<InspectionResponse> = {},
): InspectionResponse => ({
  id: "i-1",
  mission_id: "m-1",
  template_id: "t-1",
  config_id: null,
  method: "FLY_OVER",
  sequence_order: 1,
  lha_ids: null,
  config: null,
  ...overrides,
});

const baseMission = {
  id: "m-1",
  camera_mode: "AUTO",
  drone_profile_id: null,
} as unknown as MissionDetailResponse;

// two LHAs ~111m apart so the lha span is non-zero and computed zoom depends
// on horizontal_distance.
const papiAglWithSpan = {
  id: "agl-papi",
  surface_id: "s-1",
  agl_type: "PAPI",
  name: "PAPI",
  position: { lat: 0, lng: 0, alt: 0 },
  side: null,
  glide_slope_angle: 3,
  distance_from_threshold: 300,
  offset_from_centerline: null,
  lhas: [
    {
      id: "lha-p1",
      agl_id: "agl-papi",
      unit_designator: "1",
      setting_angle: 2.5,
      transition_sector_width: null,
      lamp_type: "LED",
      position: { type: "Point", coordinates: [0, 0, 0] },
      tolerance: null,
    },
    {
      id: "lha-p2",
      agl_id: "agl-papi",
      unit_designator: "2",
      setting_angle: 2.5,
      transition_sector_width: null,
      lamp_type: "LED",
      position: { type: "Point", coordinates: [0.001, 0, 0] },
      tolerance: null,
    },
  ],
};

const papiTemplate = {
  id: "t-2",
  name: "PAPI",
  description: null,
  methods: ["VERTICAL_PROFILE", "HORIZONTAL_RANGE", "HOVER_POINT_LOCK"],
  target_agl_ids: ["agl-papi"],
  angular_tolerances: null,
  created_by: null,
  created_at: null,
  updated_at: null,
  default_config: null,
  mission_count: 0,
};

const droneProfile = {
  id: "d-1",
  name: "Test Drone",
  sensor_fov: 84,
  max_optical_zoom: 20,
} as never;

function setup(overrides: Partial<Parameters<typeof useInspectionConfig>[0]> = {}) {
  const onChange = vi.fn();
  const props = {
    inspection: baseInspection(),
    template: null,
    agls: [],
    droneProfile: null,
    mission: baseMission,
    configOverride: {} as InspectionConfigOverride,
    onChange,
    selectedLhaIds: new Set<string>(),
    directionBearing: null,
    ...overrides,
  };
  const view = renderHook((p: Parameters<typeof useInspectionConfig>[0]) => useInspectionConfig(p), {
    initialProps: props,
  });
  return { ...view, onChange, props };
}

describe("useInspectionConfig resolver precedence", () => {
  beforeEach(() => {
    listCameraPresets.mockReset();
    createCameraPreset.mockReset();
    listCameraPresets.mockResolvedValue({ data: [] });
  });

  it("override beats saved beats default", () => {
    const { result } = setup({
      inspection: baseInspection({
        config: { altitude_offset: 5 } as never,
      }),
      template: { ...papiTemplate, default_config: { altitude_offset: 1 } } as never,
      configOverride: { altitude_offset: 9 },
    });
    expect(result.current.altitudeOffset).toBe(9);
  });

  it("falls through to saved when override absent", () => {
    const { result } = setup({
      inspection: baseInspection({ config: { altitude_offset: 5 } as never }),
      template: { ...papiTemplate, default_config: { altitude_offset: 1 } } as never,
    });
    expect(result.current.altitudeOffset).toBe(5);
  });

  it("falls through to default when override and saved absent", () => {
    const { result } = setup({
      template: { ...papiTemplate, default_config: { altitude_offset: 1 } } as never,
    });
    expect(result.current.altitudeOffset).toBe(1);
  });

  it("explicit null in override clears - does not fall through", () => {
    const { result } = setup({
      inspection: baseInspection({ config: { altitude_offset: 5 } as never }),
      template: { ...papiTemplate, default_config: { altitude_offset: 1 } } as never,
      configOverride: { altitude_offset: null },
    });
    expect(result.current.altitudeOffset).toBe("");
  });
});

describe("useInspectionConfig zoom reseed/release", () => {
  beforeEach(() => {
    listCameraPresets.mockReset();
    createCameraPreset.mockReset();
    listCameraPresets.mockResolvedValue({ data: [] });
  });

  it("auto-propagates computed zoom while untouched", async () => {
    const { onChange } = setup({
      inspection: baseInspection({ method: "HORIZONTAL_RANGE" }),
      template: papiTemplate as never,
      agls: [papiAglWithSpan] as never,
      droneProfile,
      configOverride: { horizontal_distance: 100 },
    });
    await waitFor(() => {
      const call = onChange.mock.calls.find(
        (c) => typeof c[0]?.optical_zoom === "number",
      );
      expect(call).toBeTruthy();
    });
  });

  it("releases the touched flag when distance changes for the same inspection", async () => {
    const onChange = vi.fn();
    const insp = baseInspection({ method: "HORIZONTAL_RANGE" });
    const { result, rerender } = renderHook(
      (p: Parameters<typeof useInspectionConfig>[0]) => useInspectionConfig(p),
      {
        initialProps: {
          inspection: insp,
          template: papiTemplate as never,
          agls: [papiAglWithSpan] as never,
          droneProfile,
          mission: baseMission,
          configOverride: { horizontal_distance: 100, optical_zoom: 5 } as InspectionConfigOverride,
          onChange,
          selectedLhaIds: new Set<string>(),
          directionBearing: null,
        },
      },
    );
    expect(result.current.zoomTouched).toBe(true);
    onChange.mockClear();

    act(() => {
      rerender({
        inspection: insp,
        template: papiTemplate as never,
        agls: [papiAglWithSpan] as never,
        droneProfile,
        mission: baseMission,
        configOverride: { horizontal_distance: 500, optical_zoom: 5 } as InspectionConfigOverride,
        onChange,
        selectedLhaIds: new Set<string>(),
        directionBearing: null,
      });
    });

    await waitFor(() => {
      expect(result.current.zoomTouched).toBe(false);
    });
  });

  it("re-seeds the touched flag from saved on inspection switch", async () => {
    const onChange = vi.fn();
    const { result, rerender } = renderHook(
      (p: Parameters<typeof useInspectionConfig>[0]) => useInspectionConfig(p),
      {
        initialProps: {
          inspection: baseInspection({ id: "i-1", method: "HORIZONTAL_RANGE" }),
          template: papiTemplate as never,
          agls: [papiAglWithSpan] as never,
          droneProfile,
          mission: baseMission,
          configOverride: {} as InspectionConfigOverride,
          onChange,
          selectedLhaIds: new Set<string>(),
          directionBearing: null,
        },
      },
    );
    expect(result.current.zoomTouched).toBe(false);

    act(() => {
      rerender({
        inspection: baseInspection({
          id: "i-2",
          method: "HORIZONTAL_RANGE",
          config: { optical_zoom: 7 } as never,
        }),
        template: papiTemplate as never,
        agls: [papiAglWithSpan] as never,
        droneProfile,
        mission: baseMission,
        configOverride: {} as InspectionConfigOverride,
        onChange,
        selectedLhaIds: new Set<string>(),
        directionBearing: null,
      });
    });

    await waitFor(() => {
      expect(result.current.zoomTouched).toBe(true);
    });
  });
});

describe("useInspectionConfig camera-mode payloads", () => {
  beforeEach(() => {
    listCameraPresets.mockReset();
    createCameraPreset.mockReset();
    listCameraPresets.mockResolvedValue({ data: [] });
  });

  it("INHERIT sets camera_mode null", () => {
    const { result, onChange } = setup();
    act(() => result.current.handleCameraModeChange("INHERIT"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ camera_mode: null }),
    );
  });

  it("AUTO sets camera_mode AUTO", () => {
    const { result, onChange } = setup();
    act(() => result.current.handleCameraModeChange("AUTO"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ camera_mode: "AUTO" }),
    );
  });

  it("MANUAL fills empty fields from the default preset", async () => {
    listCameraPresets.mockResolvedValue({
      data: [
        {
          id: "p-default",
          name: "Default",
          is_default: true,
          white_balance: "AUTO",
          iso: 200,
          shutter_speed: "1/500",
          focus_mode: "AUTO",
        },
      ],
    });
    const { result, onChange } = setup();
    await waitFor(() => expect(result.current.presets.length).toBe(1));
    act(() => result.current.handleCameraModeChange("MANUAL"));
    const arg = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(arg).toMatchObject({
      camera_mode: "MANUAL",
      camera_preset_id: "p-default",
      white_balance: "AUTO",
      iso: 200,
      shutter_speed: "1/500",
      focus_mode: "AUTO",
    });
  });

  it("applying a preset propagates its values and switches to MANUAL", async () => {
    listCameraPresets.mockResolvedValue({
      data: [
        {
          id: "p-1",
          name: "Bright",
          is_default: false,
          white_balance: "SUNNY",
          iso: 100,
          shutter_speed: "1/1000",
          focus_mode: "INFINITY",
        },
      ],
    });
    const { result, onChange } = setup();
    await waitFor(() => expect(result.current.presets.length).toBe(1));
    act(() => result.current.handlePresetSelect("p-1"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        camera_mode: "MANUAL",
        camera_preset_id: "p-1",
        white_balance: "SUNNY",
        iso: 100,
        shutter_speed: "1/1000",
        focus_mode: "INFINITY",
      }),
    );
  });
});

describe("useInspectionConfig save-as-preset", () => {
  beforeEach(() => {
    listCameraPresets.mockReset();
    createCameraPreset.mockReset();
    listCameraPresets.mockResolvedValue({ data: [] });
    createCameraPreset.mockResolvedValue({ id: "new" });
  });

  it("no-ops when the name is blank", () => {
    const { result } = setup();
    act(() => result.current.handleSaveAsPreset());
    expect(createCameraPreset).not.toHaveBeenCalled();
  });

  it("creates a preset from the resolved camera fields", async () => {
    const { result } = setup({
      configOverride: {
        white_balance: "SUNNY",
        iso: 100,
        shutter_speed: "1/500",
        focus_mode: "AUTO",
      },
    });
    act(() => result.current.setPresetName("My Preset"));
    act(() => result.current.handleSaveAsPreset());
    await waitFor(() => expect(createCameraPreset).toHaveBeenCalled());
    expect(createCameraPreset).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My Preset",
        white_balance: "SUNNY",
        iso: 100,
        shutter_speed: "1/500",
        focus_mode: "AUTO",
      }),
    );
  });
});

describe("useInspectionConfig showDirectionSection", () => {
  beforeEach(() => {
    listCameraPresets.mockReset();
    listCameraPresets.mockResolvedValue({ data: [] });
  });

  it("is true for the orientation methods", () => {
    for (const method of [
      "HORIZONTAL_RANGE",
      "FLY_OVER",
      "PARALLEL_SIDE_SWEEP",
      "SURFACE_SCAN",
    ] as const) {
      const { result } = setup({ inspection: baseInspection({ method }) });
      expect(result.current.showDirectionSection).toBe(true);
    }
  });

  it("is false for the non-oriented methods", () => {
    for (const method of [
      "VERTICAL_PROFILE",
      "APPROACH_DESCENT",
      "HOVER_POINT_LOCK",
      "MEHT_CHECK",
    ] as const) {
      const { result } = setup({ inspection: baseInspection({ method }) });
      expect(result.current.showDirectionSection).toBe(false);
    }
  });
});
