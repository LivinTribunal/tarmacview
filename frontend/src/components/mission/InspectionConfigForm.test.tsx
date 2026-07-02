import { useState, type ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import InspectionConfigForm from "./InspectionConfigForm";
import type {
  InspectionResponse,
  InspectionConfigOverride,
  MissionDetailResponse,
} from "@/types/mission";
import { computeOpticalZoom } from "@/utils/cameraAutoCalc";

// override the global setupTests stub so options like {units: "A"} survive
// rendering. backward-compatible: keys without options still echo as-is.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options && typeof options === "object" && "units" in options) {
        return `${key} ${String((options as { units: unknown }).units)}`;
      }
      return key;
    },
    i18n: {
      language: "en",
      changeLanguage: vi.fn(),
      options: { resources: { en: {} } },
    },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

// minimal template/inspection stubs
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

const runwayTemplate = {
  id: "t-1",
  name: "Runway Inspection",
  description: null,
  methods: [
    "FLY_OVER",
    "PARALLEL_SIDE_SWEEP",
    "HOVER_POINT_LOCK",
    "RUNWAY_HORIZONTAL_RANGE",
  ],
  target_agl_ids: ["agl-runway"],
  angular_tolerances: null,
  created_by: null,
  created_at: null,
  updated_at: null,
  default_config: null,
  mission_count: 0,
};

const papiTemplate = {
  ...runwayTemplate,
  id: "t-2",
  methods: ["VERTICAL_PROFILE", "HORIZONTAL_RANGE", "HOVER_POINT_LOCK"],
  target_agl_ids: ["agl-papi"],
};

const runwayAgl = {
  id: "agl-runway",
  surface_id: "s-1",
  agl_type: "RUNWAY_EDGE_LIGHTS",
  name: "Runway Edge Lights",
  position: { lat: 0, lng: 0, alt: 0 },
  side: null,
  glide_slope_angle: null,
  distance_from_threshold: null,
  offset_from_centerline: null,
  lhas: [
    {
      id: "lha-1",
      agl_id: "agl-runway",
      unit_designator: "A",
      setting_angle: null,
      transition_sector_width: null,
      lamp_type: "LED",
      position: { lat: 0, lng: 0, alt: 0 },
      tolerance: null,
    },
  ],
};

const baseMission: MissionDetailResponse = {
  id: "m-1",
  name: "Test Mission",
  status: "DRAFT",
  airport_id: "a-1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
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

function renderForm(
  overrides: Partial<Parameters<typeof InspectionConfigForm>[0]> = {},
) {
  const props = {
    inspection: baseInspection(),
    template: runwayTemplate as never,
    agls: [runwayAgl] as never,
    droneProfile: null,
    mission: baseMission,
    configOverride: {},
    onChange: vi.fn(),
    selectedLhaIds: new Set<string>(),
    onToggleLha: vi.fn(),
    disabled: false,
    ...overrides,
  };
  return { ...render(<InspectionConfigForm {...props} />), props };
}

describe("InspectionConfigForm method variants", () => {
  it("shows fly-over fields only when method is FLY_OVER", () => {
    renderForm({ inspection: baseInspection({ method: "FLY_OVER" }) });
    expect(screen.getByTestId("fly-over-fields")).toBeInTheDocument();
    expect(
      screen.queryByTestId("parallel-side-sweep-fields"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("hover-point-lock-fields"),
    ).not.toBeInTheDocument();
  });

  it("shows parallel-side-sweep fields only when method is PARALLEL_SIDE_SWEEP", () => {
    renderForm({
      inspection: baseInspection({ method: "PARALLEL_SIDE_SWEEP" }),
    });
    expect(
      screen.getByTestId("parallel-side-sweep-fields"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("fly-over-fields")).not.toBeInTheDocument();
  });

  it("shows hover-point-lock fields only when method is HOVER_POINT_LOCK", () => {
    renderForm({
      inspection: baseInspection({ method: "HOVER_POINT_LOCK" }),
      template: papiTemplate as never,
    });
    expect(
      screen.getByTestId("hover-point-lock-fields"),
    ).toBeInTheDocument();
  });

  it("does not render method-specific sections for HORIZONTAL_RANGE", () => {
    renderForm({
      inspection: baseInspection({ method: "HORIZONTAL_RANGE" }),
      template: papiTemplate as never,
    });
    expect(screen.queryByTestId("fly-over-fields")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("parallel-side-sweep-fields"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("hover-point-lock-fields"),
    ).not.toBeInTheDocument();
  });

  it("runway-horizontal-range: renders height + geometry, hides PAPI-only controls", () => {
    renderForm({
      inspection: baseInspection({ method: "RUNWAY_HORIZONTAL_RANGE" }),
      template: runwayTemplate as never,
    });
    // height + sweep + horizontal distance render
    expect(
      screen.getByTestId("inspection-height-above-lights"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("inspection-sweep-angle")).toBeInTheDocument();
    expect(
      screen.getByTestId("inspection-horizontal-distance"),
    ).toBeInTheDocument();
    // PAPI-only controls are hidden in the runway variant
    expect(
      screen.queryByTestId("inspection-angle-offset"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("inspection-lha-setting-angle-override"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("papi-center-height-section"),
    ).not.toBeInTheDocument();
  });

  it("shows approach-descent fields only when method is APPROACH_DESCENT", () => {
    renderForm({
      inspection: baseInspection({ method: "APPROACH_DESCENT" }),
      template: papiTemplate as never,
    });
    expect(screen.getByTestId("approach-descent-fields")).toBeInTheDocument();
    expect(screen.queryByTestId("fly-over-fields")).not.toBeInTheDocument();
  });

  it("hides approach-descent fields for other methods", () => {
    renderForm({
      inspection: baseInspection({ method: "HORIZONTAL_RANGE" }),
      template: papiTemplate as never,
    });
    expect(
      screen.queryByTestId("approach-descent-fields"),
    ).not.toBeInTheDocument();
  });

  it("propagates descent_start_distance changes for approach-descent", () => {
    const onChange = vi.fn();
    renderForm({
      inspection: baseInspection({ method: "APPROACH_DESCENT" }),
      template: papiTemplate as never,
      onChange,
    });
    fireEvent.change(
      screen.getByTestId("inspection-descent-start-distance"),
      { target: { value: "1200" } },
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ descent_start_distance: 1200 }),
    );
  });

  it("propagates descent_glide_slope_override changes for approach-descent", () => {
    const onChange = vi.fn();
    renderForm({
      inspection: baseInspection({ method: "APPROACH_DESCENT" }),
      template: papiTemplate as never,
      onChange,
    });
    fireEvent.change(
      screen.getByTestId("inspection-descent-glide-slope-override"),
      { target: { value: "3.5" } },
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ descent_glide_slope_override: 3.5 }),
    );
  });

  it("propagates height_above_lights changes for fly-over", () => {
    const onChange = vi.fn();
    renderForm({
      inspection: baseInspection({ method: "FLY_OVER" }),
      onChange,
    });
    fireEvent.change(screen.getByTestId("inspection-height-above-lights"), {
      target: { value: "12" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ height_above_lights: 12 }),
    );
  });

  it("hover-point-lock: toggling angle lock flips state", () => {
    renderForm({
      inspection: baseInspection({ method: "HOVER_POINT_LOCK" }),
      template: papiTemplate as never,
    });
    const btn = screen.getByTestId("angle-lock-toggle");
    expect(btn).toHaveAttribute("aria-checked", "false");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-checked", "true");
  });

  it("hover-point-lock: editing height with lock on recomputes gimbal angle", () => {
    const onChange = vi.fn();
    renderForm({
      inspection: baseInspection({ method: "HOVER_POINT_LOCK" }),
      template: papiTemplate as never,
      configOverride: { distance_from_lha: 10, camera_gimbal_angle: -45 },
      onChange,
    });
    fireEvent.click(screen.getByTestId("angle-lock-toggle"));
    fireEvent.change(screen.getByTestId("inspection-height-above-lha"), {
      target: { value: "10" },
    });
    // last call should have both height_above_lha=10 and camera_gimbal_angle = -45
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(last).toMatchObject({ height_above_lha: 10 });
    expect(last.camera_gimbal_angle).toBeCloseTo(-45, 1);
  });

  it("hides geometry-override fields for methods that ignore them", () => {
    for (const method of [
      "FLY_OVER",
      "PARALLEL_SIDE_SWEEP",
      "HOVER_POINT_LOCK",
    ] as const) {
      const { unmount } = renderForm({
        inspection: baseInspection({ method }),
        template: (method === "HOVER_POINT_LOCK" ? papiTemplate : runwayTemplate) as never,
      });
      expect(
        screen.queryByTestId("inspection-horizontal-distance"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("inspection-sweep-angle"),
      ).not.toBeInTheDocument();
      unmount();
    }
  });

  it("renders geometry-override fields for VERTICAL_PROFILE and HORIZONTAL_RANGE", () => {
    // horizontal range shows horizontal_distance + sweep_angle;
    // vertical profile shows horizontal_distance + the angle source toggle.
    const cases: Array<{ method: "VERTICAL_PROFILE" | "HORIZONTAL_RANGE"; secondField: string }> = [
      { method: "HORIZONTAL_RANGE", secondField: "inspection-sweep-angle" },
      { method: "VERTICAL_PROFILE", secondField: "vertical-profile-fields" },
    ];
    for (const { method, secondField } of cases) {
      const { unmount } = renderForm({
        inspection: baseInspection({ method }),
        template: papiTemplate as never,
      });
      expect(
        screen.getByTestId("inspection-horizontal-distance"),
      ).toBeInTheDocument();
      expect(screen.getByTestId(secondField)).toBeInTheDocument();
      unmount();
    }
  });

  it("renders measurement speed field for all methods except hover-point-lock", () => {
    for (const method of [
      "VERTICAL_PROFILE",
      "FLY_OVER",
      "PARALLEL_SIDE_SWEEP",
      "HORIZONTAL_RANGE",
    ] as const) {
      const { unmount } = renderForm({
        inspection: baseInspection({ method }),
        template: (method === "VERTICAL_PROFILE" ? papiTemplate : runwayTemplate) as never,
      });
      expect(
        screen.getByTestId("inspection-measurement-speed-override"),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it("hides measurement speed field for hover-point-lock", () => {
    const { unmount } = renderForm({
      inspection: baseInspection({ method: "HOVER_POINT_LOCK" }),
      template: papiTemplate as never,
    });
    expect(
      screen.queryByTestId("inspection-measurement-speed-override"),
    ).not.toBeInTheDocument();
    unmount();
  });

  it("propagates measurement_speed_override changes", () => {
    const onChange = vi.fn();
    renderForm({
      inspection: baseInspection({ method: "FLY_OVER" }),
      onChange,
    });
    fireEvent.change(
      screen.getByTestId("inspection-measurement-speed-override"),
      { target: { value: "2.5" } },
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ measurement_speed_override: 2.5 }),
    );
  });

  it("auto-fills optical_zoom clamped to max_optical_zoom", async () => {
    const onChange = vi.fn();
    renderForm({
      inspection: baseInspection({ method: "HOVER_POINT_LOCK" }),
      template: papiTemplate as never,
      configOverride: { distance_from_lha: 500, height_above_lha: 100 },
      droneProfile: {
        id: "d-1",
        name: "Test Drone",
        sensor_fov: 84,
        max_optical_zoom: 7,
      } as never,
      onChange,
    });
    const call = onChange.mock.calls.find(
      (c) => typeof c[0]?.optical_zoom === "number",
    );
    expect(call).toBeTruthy();
    expect(call![0].optical_zoom).toBeLessThanOrEqual(7);
  });

  it("propagates focus_mode dropdown changes", () => {
    const onChange = vi.fn();
    renderForm({
      inspection: baseInspection({ method: "HOVER_POINT_LOCK" }),
      template: papiTemplate as never,
      configOverride: { camera_mode: "MANUAL" },
      onChange,
    });
    fireEvent.change(screen.getByTestId("inspection-focus-mode"), {
      target: { value: "INFINITY" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ focus_mode: "INFINITY" }),
    );
  });

  it("renders zoom-over-optical warning when optical_zoom exceeds max_optical_zoom", () => {
    renderForm({
      inspection: baseInspection({ method: "HOVER_POINT_LOCK" }),
      template: papiTemplate as never,
      configOverride: { optical_zoom: 10, camera_mode: "MANUAL" },
      droneProfile: {
        id: "d-1",
        name: "Test Drone",
        sensor_fov: 84,
        max_optical_zoom: 7,
      } as never,
    });
    expect(
      screen.getByTestId("zoom-over-optical-warning"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("zoom-over-optical-validation"),
    ).toBeInTheDocument();
  });

  it("hover-point-lock: editing distance without lock does not recompute", () => {
    const onChange = vi.fn();
    renderForm({
      inspection: baseInspection({ method: "HOVER_POINT_LOCK" }),
      template: papiTemplate as never,
      configOverride: { distance_from_lha: 10, camera_gimbal_angle: -45 },
      onChange,
    });
    fireEvent.change(screen.getByTestId("inspection-distance-from-lha"), {
      target: { value: "20" },
    });
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(last).toMatchObject({ distance_from_lha: 20 });
    expect(last.height_above_lha).toBeUndefined();
  });

  it("direction widget renders for the three in-scope methods", () => {
    const methods = ["HORIZONTAL_RANGE", "FLY_OVER", "PARALLEL_SIDE_SWEEP"] as const;
    for (const method of methods) {
      const { unmount } = renderForm({
        inspection: baseInspection({ method }),
        template: papiTemplate as never,
      });
      expect(screen.getByTestId("direction-reversed-section")).toBeInTheDocument();
      unmount();
    }
  });

  it("direction widget is hidden for the three excluded methods", () => {
    const excluded = ["HOVER_POINT_LOCK", "MEHT_CHECK", "VERTICAL_PROFILE"] as const;
    for (const method of excluded) {
      const { unmount } = renderForm({
        inspection: baseInspection({ method }),
        template: papiTemplate as never,
      });
      expect(screen.queryByTestId("direction-reversed-section")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("direction widget shows placeholder when bearing is null", () => {
    renderForm({
      inspection: baseInspection({ method: "FLY_OVER" }),
      directionBearing: null,
    });
    // the i18n stub echoes the key; real app renders "—"
    expect(screen.getByTestId("inspection-direction-bearing").textContent).toBe(
      "mission.config.direction.unknown",
    );
  });

  it("direction widget shows the bearing when provided", () => {
    renderForm({
      inspection: baseInspection({ method: "FLY_OVER" }),
      directionBearing: 142,
    });
    expect(screen.getByTestId("inspection-direction-bearing").textContent).toBe("142°");
  });

  it("direction mode REVERSED sets direction='REVERSED'", () => {
    const onChange = vi.fn();
    renderForm({
      inspection: baseInspection({ method: "FLY_OVER" }),
      onChange,
    });
    fireEvent.click(screen.getByTestId("inspection-direction-mode-reversed"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "REVERSED" }),
    );
  });

  it("direction mode NATURAL sets direction='NATURAL'", () => {
    const onChange = vi.fn();
    renderForm({
      inspection: baseInspection({ method: "FLY_OVER" }),
      configOverride: { direction: "REVERSED" },
      onChange,
    });
    fireEvent.click(screen.getByTestId("inspection-direction-mode-natural"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "NATURAL" }),
    );
  });

  it("vertical-profile: defaults to CUSTOM mode and renders angle inputs", () => {
    renderForm({
      inspection: baseInspection({ method: "VERTICAL_PROFILE" }),
      template: papiTemplate as never,
    });
    expect(screen.getByTestId("vertical-profile-fields")).toBeInTheDocument();
    expect(screen.getByTestId("inspection-angle-start")).toBeInTheDocument();
    expect(screen.getByTestId("inspection-angle-end")).toBeInTheDocument();
    expect(
      screen.queryByTestId("inspection-angle-offset-above"),
    ).not.toBeInTheDocument();
  });

  it("vertical-profile: PAPI toggle swaps to offset inputs", () => {
    const onChange = vi.fn();
    renderForm({
      inspection: baseInspection({ method: "VERTICAL_PROFILE" }),
      template: papiTemplate as never,
      configOverride: { angle_source: "PAPI" },
      onChange,
    });
    expect(
      screen.getByTestId("inspection-angle-offset-above"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inspection-angle-offset-below"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("inspection-angle-start"),
    ).not.toBeInTheDocument();
  });

  it("vertical-profile: clicking PAPI button propagates angle_source change", () => {
    const onChange = vi.fn();
    renderForm({
      inspection: baseInspection({ method: "VERTICAL_PROFILE" }),
      template: papiTemplate as never,
      onChange,
    });
    fireEvent.click(screen.getByTestId("vp-angle-source-papi"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ angle_source: "PAPI" }),
    );
  });

  it("vertical-profile: angle_start >= angle_end shows error message", () => {
    renderForm({
      inspection: baseInspection({ method: "VERTICAL_PROFILE" }),
      template: papiTemplate as never,
      configOverride: { angle_start: 5, angle_end: 3 },
    });
    expect(screen.getByTestId("vp-angle-band-error")).toBeInTheDocument();
  });

  it("vertical-profile: scan preview is rendered", () => {
    renderForm({
      inspection: baseInspection({ method: "VERTICAL_PROFILE" }),
      template: papiTemplate as never,
    });
    // i18n stub echoes the key; presence of the element confirms the preview branch ran
    expect(screen.getByTestId("vp-scan-preview")).toBeInTheDocument();
  });

  it("vertical-profile: PAPI toggle is disabled and unavailable hint names missing LHA when setting angles are absent", () => {
    // template-targeted PAPI AGL whose only LHA has setting_angle: null - the
    // exact configuration that should disable PAPI mode and surface the hint.
    const papiAglMissingAngle = {
      id: "agl-papi",
      surface_id: "s-1",
      agl_type: "PAPI",
      name: "PAPI",
      position: { lat: 0, lng: 0, alt: 0 },
      side: null,
      glide_slope_angle: null,
      distance_from_threshold: null,
      offset_from_centerline: null,
      lhas: [
        {
          id: "lha-papi-1",
          agl_id: "agl-papi",
          unit_designator: "A",
          setting_angle: null,
          transition_sector_width: null,
          lamp_type: "LED",
          position: { type: "Point", coordinates: [0, 0, 0] },
          tolerance: null,
        },
      ],
    };

    renderForm({
      inspection: baseInspection({ method: "VERTICAL_PROFILE" }),
      template: papiTemplate as never,
      agls: [papiAglMissingAngle] as never,
    });

    const papiBtn = screen.getByTestId("vp-angle-source-papi");
    expect(papiBtn).toHaveAttribute("disabled");

    // local i18n stub appends the interpolated `units` to the key; the hint
    // text should both name the i18n key and call out the offending designator.
    const hint = screen.getByText(/mission\.config\.angleSourcePapiUnavailable/);
    expect(hint.textContent).toContain("A");
  });

  it("direction mode INHERIT sets direction=null", () => {
    const onChange = vi.fn();
    renderForm({
      inspection: baseInspection({ method: "FLY_OVER" }),
      configOverride: { direction: "NATURAL" },
      onChange,
    });
    fireEvent.click(screen.getByTestId("inspection-direction-mode-inherit"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ direction: null }),
    );
  });

  it("displayed bearing flips by 180° when direction differs from saved", () => {
    renderForm({
      inspection: baseInspection({ method: "FLY_OVER" }),
      configOverride: { direction: "REVERSED" },
      directionBearing: 142,
    });
    expect(screen.getByTestId("inspection-direction-bearing").textContent).toBe(
      "322°",
    );
    expect(
      screen.getByTestId("inspection-direction-recompute-hint"),
    ).toBeInTheDocument();
  });

  it("displayed bearing matches saved bearing when not dirty", () => {
    renderForm({
      inspection: baseInspection({
        method: "FLY_OVER",
        config: {
          id: "c-1",
          direction: "REVERSED",
          resolved_direction: "REVERSED",
        } as never,
      }),
      configOverride: {},
      directionBearing: 142,
    });
    // saved = REVERSED, no dirty override -> bearing shown as-is, no hint
    expect(screen.getByTestId("inspection-direction-bearing").textContent).toBe(
      "142°",
    );
    expect(
      screen.queryByTestId("inspection-direction-recompute-hint"),
    ).not.toBeInTheDocument();
  });

  it("inherit mode falls back to resolved_direction label when present", () => {
    renderForm({
      inspection: baseInspection({
        method: "FLY_OVER",
        config: {
          id: "c-1",
          direction: null,
          resolved_direction: "REVERSED",
        } as never,
      }),
      configOverride: {},
      directionBearing: 142,
    });
    expect(
      screen.getByTestId("inspection-direction-inherit-resolved"),
    ).toBeInTheDocument();
  });

  it("renders Template and Method via ReadOnlyField with non-interactive semantics", () => {
    /** verify the read-only fields use the new component, not bare <p> tags. */
    renderForm({ inspection: baseInspection({ method: "FLY_OVER" }) });
    const tpl = screen.getByTestId("inspection-template-readonly");
    const method = screen.getByTestId("inspection-method-readonly");
    expect(tpl.getAttribute("aria-readonly")).toBe("true");
    expect(method.getAttribute("aria-readonly")).toBe("true");
    expect(tpl.className).toMatch(/bg-tv-surface/);
    expect(method.className).toMatch(/bg-tv-surface/);
  });

  it("renders the computed observation angle via ReadOnlyField on bg-tv-surface", () => {
    /** verify the computed angle pill uses ReadOnlyField styling. */
    renderForm({
      inspection: baseInspection({ method: "HORIZONTAL_RANGE" }),
      template: papiTemplate as never,
      agls: [
        {
          ...runwayAgl,
          id: "agl-papi",
          agl_type: "PAPI",
          lhas: [
            {
              ...runwayAgl.lhas[0],
              id: "lha-p1",
              setting_angle: 3.0,
              position: { type: "Point", coordinates: [0, 0, 0] },
            },
          ],
        },
      ] as never,
    });
    const angle = screen.getByTestId("computed-observation-angle");
    expect(angle.getAttribute("aria-readonly")).toBe("true");
    expect(angle.className).toMatch(/bg-tv-surface/);
  });

  it("inspection direction segmented control uses bg-tv-surface", () => {
    /** verify the inner segmented pill is inset onto bg-tv-surface, not bg-tv-bg. */
    renderForm({ inspection: baseInspection({ method: "FLY_OVER" }) });
    const pill = screen.getByTestId("inspection-direction-mode");
    expect(pill.className).toMatch(/bg-tv-surface/);
    expect(pill.className).not.toMatch(/bg-tv-bg/);
  });

  it("inspection camera mode segmented control uses bg-tv-surface", () => {
    /** verify the camera-mode pill is inset onto bg-tv-surface. */
    renderForm({ inspection: baseInspection({ method: "FLY_OVER" }) });
    const pill = screen.getByTestId("inspection-camera-mode");
    expect(pill.className).toMatch(/bg-tv-surface/);
  });

  it("inherit mode with resolved=REVERSED shows compiled bearing without flip", () => {
    // saved direction=null + resolved_direction=REVERSED + no override
    // -> directionBearing already reflects the compiled reversed heading.
    renderForm({
      inspection: baseInspection({
        method: "FLY_OVER",
        config: {
          id: "c-1",
          direction: null,
          resolved_direction: "REVERSED",
        } as never,
      }),
      configOverride: {},
      directionBearing: 142,
    });
    expect(screen.getByTestId("inspection-direction-bearing").textContent).toBe(
      "142°",
    );
    expect(
      screen.queryByTestId("inspection-direction-recompute-hint"),
    ).not.toBeInTheDocument();
  });
});

// --- horizontal-distance -> optical_zoom resync ---
describe("InspectionConfigForm zoom resync", () => {
  // two LHAs ~111m apart at the equator so the LHA span is non-zero
  // and the computed zoom genuinely depends on horizontal_distance.
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

  const droneProfile = {
    id: "d-1",
    name: "Test Drone",
    sensor_fov: 84,
    max_optical_zoom: 20,
  } as never;

  // controlled wrapper - real apps own configOverride state, so propagating
  // the form's onChange back into props is what triggers the re-derive flow.
  function ControlledForm(
    props: Omit<ComponentProps<typeof InspectionConfigForm>, "configOverride" | "onChange"> & {
      initialOverride: InspectionConfigOverride;
      onChangeSpy: (o: InspectionConfigOverride) => void;
    },
  ) {
    const { initialOverride, onChangeSpy, ...rest } = props;
    const [override, setOverride] = useState<InspectionConfigOverride>(initialOverride);
    return (
      <InspectionConfigForm
        {...rest}
        configOverride={override}
        onChange={(next) => {
          setOverride(next);
          onChangeSpy(next);
        }}
      />
    );
  }

  function renderControlled(initialOverride: InspectionConfigOverride) {
    const onChangeSpy = vi.fn();
    render(
      <ControlledForm
        inspection={baseInspection({ method: "HORIZONTAL_RANGE" })}
        template={papiTemplate as never}
        agls={[papiAglWithSpan] as never}
        droneProfile={droneProfile}
        mission={baseMission}
        selectedLhaIds={new Set<string>()}
        onToggleLha={vi.fn()}
        disabled={false}
        initialOverride={initialOverride}
        onChangeSpy={onChangeSpy}
      />,
    );
    return { onChangeSpy };
  }

  function lastOpticalZoom(spy: ReturnType<typeof vi.fn>): number | null | undefined {
    const calls = spy.mock.calls;
    for (let i = calls.length - 1; i >= 0; i--) {
      const arg = calls[i]?.[0] as InspectionConfigOverride | undefined;
      if (arg && "optical_zoom" in arg) return arg.optical_zoom;
    }
    return undefined;
  }

  it("re-derives optical_zoom when horizontal_distance changes after a saved value exists", () => {
    const { onChangeSpy } = renderControlled({
      horizontal_distance: 100,
      optical_zoom: 5,
    });
    onChangeSpy.mockClear();

    act(() => {
      fireEvent.change(screen.getByTestId("inspection-horizontal-distance"), {
        target: { value: "500" },
      });
    });

    const expected = computeOpticalZoom(500, 111.195, 84, 20);
    expect(expected).not.toBeNull();
    const submitted = lastOpticalZoom(onChangeSpy);
    expect(submitted).toBeCloseTo(expected as number, 1);
    expect(submitted).not.toBe(5);
  });

  it("derives optical_zoom from the 400m default when horizontal_distance is cleared", () => {
    const { onChangeSpy } = renderControlled({
      horizontal_distance: 100,
      optical_zoom: 5,
    });
    onChangeSpy.mockClear();

    act(() => {
      fireEvent.change(screen.getByTestId("inspection-horizontal-distance"), {
        target: { value: "" },
      });
    });

    const expected = computeOpticalZoom(400, 111.195, 84, 20);
    expect(expected).not.toBeNull();
    const submitted = lastOpticalZoom(onChangeSpy);
    expect(submitted).toBeCloseTo(expected as number, 1);
    expect(submitted).not.toBe(5);
  });

  it("re-derives optical_zoom when horizontal_distance changes even after the slider was touched", () => {
    // MANUAL mode renders the optical-zoom slider so we can fake a real drag.
    const { onChangeSpy } = renderControlled({
      horizontal_distance: 100,
      optical_zoom: 5,
      camera_mode: "MANUAL",
    });
    act(() => {
      fireEvent.change(screen.getByTestId("inspection-optical-zoom"), {
        target: { value: "10" },
      });
    });
    onChangeSpy.mockClear();

    act(() => {
      fireEvent.change(screen.getByTestId("inspection-horizontal-distance"), {
        target: { value: "500" },
      });
    });

    const expected = computeOpticalZoom(500, 111.195, 84, 20);
    expect(expected).not.toBeNull();
    const submitted = lastOpticalZoom(onChangeSpy);
    expect(submitted).toBeCloseTo(expected as number, 1);
    expect(submitted).not.toBe(10);
  });

  it("does not overwrite optical_zoom when horizontal_distance is unset", () => {
    // FLY_OVER with no lateral_offset configured falls back to 0,
    // but with no lha span computed zoom is null, so nothing is auto-applied.
    const onChangeSpy = vi.fn();
    function Setup() {
      const [override, setOverride] = useState<InspectionConfigOverride>({
        optical_zoom: 4,
      });
      return (
        <InspectionConfigForm
          inspection={baseInspection({ method: "FLY_OVER" })}
          template={runwayTemplate as never}
          agls={[runwayAgl] as never}
          droneProfile={null}
          mission={baseMission}
          configOverride={override}
          selectedLhaIds={new Set<string>()}
          onToggleLha={vi.fn()}
          disabled={false}
          onChange={(o) => {
            setOverride(o);
            onChangeSpy(o);
          }}
        />
      );
    }
    render(<Setup />);
    // no zoom auto-overwrite expected because no drone profile -> no FOV ->
    // computed zoom is null and the auto-propagate effect short-circuits.
    expect(lastOpticalZoom(onChangeSpy)).toBeUndefined();
  });
});

// info-hint coverage: confirms representative fields surface help copy via t().
// the i18n stub returns the key, so finding the key text proves the t() lookup ran.
describe("InspectionConfigForm info hints", () => {
  it("renders hint icons for buffer override, hover bearing, and gimbal angle", () => {
    renderForm({ inspection: baseInspection({ method: "HOVER_POINT_LOCK" }) });
    expect(screen.getByTestId("hint-inspection-buffer-distance-hpl")).toBeInTheDocument();
    expect(screen.getByTestId("hint-inspection-hover-bearing")).toBeInTheDocument();
    expect(screen.getByTestId("hint-inspection-hpl-gimbal-angle")).toBeInTheDocument();
  });

  it("hint trigger surfaces the *Help i18n key as a tooltip", () => {
    renderForm({ inspection: baseInspection({ method: "HOVER_POINT_LOCK" }) });
    const trigger = screen.getByTestId("hint-inspection-hover-bearing");
    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip").textContent).toBe(
      "mission.config.hoverBearingHelp",
    );
  });

  it("renders altitude-offset hint for every method (always-visible field)", () => {
    for (const method of ["FLY_OVER", "HORIZONTAL_RANGE", "HOVER_POINT_LOCK"] as const) {
      const { unmount } = renderForm({
        inspection: baseInspection({ method }),
        template: method === "FLY_OVER" ? (runwayTemplate as never) : (papiTemplate as never),
      });
      expect(screen.getByTestId("hint-inspection-altitude-offset")).toBeInTheDocument();
      unmount();
    }
  });

  it("renders the PAPI center-height section for glide-slope methods only", () => {
    const shows: Array<"HORIZONTAL_RANGE" | "VERTICAL_PROFILE" | "APPROACH_DESCENT"> = [
      "HORIZONTAL_RANGE",
      "VERTICAL_PROFILE",
      "APPROACH_DESCENT",
    ];
    for (const method of shows) {
      const { unmount } = renderForm({
        inspection: baseInspection({ method }),
        template: papiTemplate as never,
      });
      expect(screen.getByTestId("papi-center-height-section")).toBeInTheDocument();
      unmount();
    }
    for (const method of ["FLY_OVER", "SURFACE_SCAN", "HOVER_POINT_LOCK"] as const) {
      const { unmount } = renderForm({
        inspection: baseInspection({ method }),
        template: (method === "HOVER_POINT_LOCK" ? papiTemplate : runwayTemplate) as never,
      });
      expect(
        screen.queryByTestId("papi-center-height-section"),
      ).not.toBeInTheDocument();
      unmount();
    }
  });

  it("defaults to GROUND and hides the custom input until CUSTOM is selected", () => {
    renderForm({
      inspection: baseInspection({ method: "HORIZONTAL_RANGE" }),
      template: papiTemplate as never,
    });
    expect(
      screen.getByTestId("inspection-papi-center-height-reference-ground"),
    ).toHaveClass("bg-tv-accent");
    expect(
      screen.queryByTestId("inspection-papi-center-height-custom"),
    ).not.toBeInTheDocument();
  });

  it("shows the custom input when the saved reference is CUSTOM", () => {
    renderForm({
      inspection: baseInspection({
        method: "HORIZONTAL_RANGE",
        config: {
          papi_center_height_reference: "CUSTOM",
          papi_center_height_custom_m: 6,
        } as never,
      }),
      template: papiTemplate as never,
    });
    expect(
      screen.getByTestId("inspection-papi-center-height-custom"),
    ).toBeInTheDocument();
  });

  it("propagates a center-height reference change", () => {
    const onChange = vi.fn();
    renderForm({
      inspection: baseInspection({ method: "HORIZONTAL_RANGE" }),
      template: papiTemplate as never,
      onChange,
    });
    fireEvent.click(
      screen.getByTestId("inspection-papi-center-height-reference-lens"),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ papi_center_height_reference: "LENS" }),
    );
  });

  it("propagates a custom center-height value change", () => {
    const onChange = vi.fn();
    renderForm({
      inspection: baseInspection({
        method: "HORIZONTAL_RANGE",
        config: { papi_center_height_reference: "CUSTOM" } as never,
      }),
      template: papiTemplate as never,
      onChange,
    });
    fireEvent.change(screen.getByTestId("inspection-papi-center-height-custom"), {
      target: { value: "8.5" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ papi_center_height_custom_m: 8.5 }),
    );
  });
});

// --- MEHT_CHECK surveyed height display ---
describe("InspectionConfigForm surveyed MEHT height", () => {
  const papiAgl = {
    id: "agl-papi",
    surface_id: "s-1",
    agl_type: "PAPI",
    name: "PAPI",
    position: { lat: 0, lng: 0, alt: 0 },
    side: null,
    glide_slope_angle: 3,
    distance_from_threshold: 300,
    meht_height_m: 18,
    offset_from_centerline: null,
    lhas: [],
  };

  it("shows the surveyed meht_height_m instead of the derived value", () => {
    renderForm({
      inspection: baseInspection({ method: "MEHT_CHECK" }),
      template: papiTemplate as never,
      agls: [papiAgl] as never,
    });
    // surveyed 18 wins over the derived 300*tan(3) ~= 15.72
    expect(screen.getByTestId("computed-meht-height")).toHaveTextContent("18");
  });

  it("falls back to the derived value when meht_height_m is null", () => {
    renderForm({
      inspection: baseInspection({ method: "MEHT_CHECK" }),
      template: papiTemplate as never,
      agls: [{ ...papiAgl, meht_height_m: null }] as never,
    });
    expect(screen.getByTestId("computed-meht-height")).toHaveTextContent("15.72");
  });
});
