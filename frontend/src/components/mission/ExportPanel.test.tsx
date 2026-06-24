import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import en from "@/i18n/locales/en.json";
import ExportPanel, { type ExportPanelProps } from "./ExportPanel";
import { useFieldLinkStatus } from "@/hooks/useFieldLinkStatus";
import type { MissionDetailResponse } from "@/types/mission";
import type { DroneProfileResponse } from "@/types/droneProfile";
import type { FieldLinkStatusResponse } from "@/types/fieldLink";

// the panel polls the backend through this hook (one poll shared by the chip
// and the send-to-drone gate) - stub it so panel tests stay network-free;
// chip behavior is covered in FieldLinkStatusChip.test.tsx
vi.mock("@/hooks/useFieldLinkStatus", () => ({
  useFieldLinkStatus: vi.fn(() => ({
    status: null,
    lastChecked: null,
    checking: false,
    refresh: vi.fn(),
  })),
}));

// wraps a status into the useFieldLinkStatus poll shape for the mock
function poll(status: FieldLinkStatusResponse | null) {
  return { status, lastChecked: status ? 1 : null, checking: false, refresh: vi.fn() };
}

const ONLINE_M350: FieldLinkStatusResponse = {
  hub_online: true,
  rc_connected: true,
  broker_connected: true,
  connect_url: "https://192.168.8.50:8443",
  public_host: "192.168.8.50",
  devices: [
    {
      sn: "1ZNBJ7R0010078",
      model_name: "Matrice 350 RTK",
      model_key: "0-89-0",
      domain: 0,
      online: true,
      bound: true,
      gateway_sn: "5YSZK1400B00A1",
    },
  ],
};

// the send-to-drone section dispatches through this call - stub it so the
// panel tests never touch the axios client; section behavior is covered in
// SendToDroneSection.test.tsx
vi.mock("@/api/missions", () => ({
  dispatchMission: vi.fn(),
}));

/** resolve a dotted i18n key against the real en.json bundle. */
function resolveKey(key: string): string {
  const parts = key.split(".");
  let node: unknown = en as unknown;
  for (const p of parts) {
    if (node && typeof node === "object" && p in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  return typeof node === "string" ? node : key;
}

// override the global react-i18next mock with one backed by the real en.json
// so capability-note assertions verify user-facing copy, not wiring keys.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => resolveKey(key),
    i18n: {
      language: "en",
      changeLanguage: vi.fn(),
      options: { resources: { en: {} } },
    },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

function makeMission(
  overrides: Partial<MissionDetailResponse> = {},
): MissionDetailResponse {
  return {
    id: "m-1",
    name: "Test Mission",
    status: "VALIDATED",
    airport_id: "apt-1",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
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
    require_perpendicular_runway_crossing: false,
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
    ...overrides,
  };
}

// switch the single-select format dropdown to a given format
function selectFormat(fmt: string) {
  fireEvent.change(screen.getByTestId("format-select"), { target: { value: fmt } });
}

function renderPanel(overrides: Partial<ExportPanelProps> = {}) {
  const defaults: ExportPanelProps = {
    mission: makeMission(),
    onExport: vi.fn(),
    onComplete: vi.fn(),
    onCancel: vi.fn(),
    onDelete: vi.fn(),
    isExporting: false,
    hasFlightPlan: true,
    onDownloadReport: vi.fn(),
    isDownloadingReport: false,
    ...overrides,
  };
  return { ...render(<ExportPanel {...defaults} />), props: defaults };
}

describe("ExportPanel - mission report section", () => {
  it("renders the mission report download button when mission has a flight plan", () => {
    renderPanel({ hasFlightPlan: true });

    const btn = screen.getByTestId("download-report-btn");
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it("disables the mission report button when there is no flight plan", () => {
    renderPanel({ hasFlightPlan: false });

    const btn = screen.getByTestId("download-report-btn");
    expect(btn).toBeDisabled();
  });

  it("calls onDownloadReport when the button is clicked", () => {
    const onDownloadReport = vi.fn();
    renderPanel({ onDownloadReport, hasFlightPlan: true });

    fireEvent.click(screen.getByTestId("download-report-btn"));
    expect(onDownloadReport).toHaveBeenCalledTimes(1);
  });

  it("shows loading state when isDownloadingReport is true", () => {
    renderPanel({ isDownloadingReport: true, hasFlightPlan: true });

    const btn = screen.getByTestId("download-report-btn");
    expect(btn).toBeDisabled();
    expect(btn.textContent).toContain(resolveKey("mission.missionReport.generating"));
  });

  it("renders report section for DRAFT status missions", () => {
    renderPanel({
      mission: makeMission({ status: "DRAFT" }),
      hasFlightPlan: true,
    });

    expect(screen.getByTestId("mission-report-section")).toBeInTheDocument();
  });

  it("enables export controls for a MEASURED mission (post-validation)", () => {
    renderPanel({ mission: makeMission({ status: "MEASURED" }) });

    expect(
      screen.queryByText("Mission needs to be validated before export"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("format-select")).not.toBeDisabled();
    expect(screen.getByTestId("download-export-btn")).not.toBeDisabled();
  });
});

describe("ExportPanel - per-format capability notes", () => {
  it("renders zoom-only English copy for the default KMZ and for WPML", () => {
    renderPanel();

    // KMZ is the default selection
    expect(screen.getByTestId("capability-KMZ").textContent).toMatch(
      /Carries optical zoom per inspection/,
    );

    selectFormat("WPML");
    expect(screen.getByTestId("capability-WPML").textContent).toMatch(
      /Carries optical zoom per inspection/,
    );
  });

  it("renders full-coverage English copy for JSON", () => {
    renderPanel();

    selectFormat("JSON");
    expect(screen.getByTestId("capability-JSON").textContent).toMatch(
      /Carries all camera settings/,
    );
  });

  it("renders the dedicated KML name+description note", () => {
    renderPanel();

    selectFormat("KML");
    expect(screen.getByTestId("capability-KML").textContent).toMatch(
      /KML carries waypoint name and description text only/,
    );
  });

  it("renders no-camera-settings English copy for raw-coordinate formats", () => {
    renderPanel();

    for (const fmt of ["MAVLINK", "UGCS", "CSV", "GPX", "LITCHI", "DRONEDEPLOY"]) {
      selectFormat(fmt);
      expect(screen.getByTestId(`capability-${fmt}`).textContent).toMatch(
        /No camera settings in this format/,
      );
    }
  });

  it("defaults the format dropdown to KMZ", () => {
    renderPanel();

    expect((screen.getByTestId("format-select") as HTMLSelectElement).value).toBe("KMZ");
  });

  it("replaces the selection in the download payload when a new format is picked", () => {
    const onExport = vi.fn();
    renderPanel({ onExport });

    // JSON is not a DJI WPMZ format, so download fires directly
    selectFormat("JSON");
    fireEvent.click(screen.getByTestId("download-export-btn"));

    expect(onExport.mock.calls[0][0]).toEqual(["JSON"]);
  });
});

describe("ExportPanel - geozones toggle", () => {
  it("renders geozone section but disables checkbox when only incapable formats are selected", () => {
    renderPanel({
      mission: makeMission({
        drone_profile_id: "drone-1",
        supports_geozone_upload: true,
      }),
    });

    // KMZ is selected by default - it IS capable. switch to GPX (incapable).
    selectFormat("GPX");

    const checkbox = screen.getByTestId("include-geozones") as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it("disables the geozone checkbox when the drone lacks the capability", () => {
    renderPanel({
      mission: makeMission({
        drone_profile_id: "drone-1",
        supports_geozone_upload: false,
      }),
    });

    const checkbox = screen.getByTestId("include-geozones") as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it("disables the geozone checkbox when no drone is assigned", () => {
    renderPanel({
      mission: makeMission({
        drone_profile_id: null,
        supports_geozone_upload: null,
      }),
    });

    const checkbox = screen.getByTestId("include-geozones") as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it("enables the geozone checkbox when format and drone are both capable", () => {
    renderPanel({
      mission: makeMission({
        drone_profile_id: "drone-1",
        supports_geozone_upload: true,
      }),
    });

    const checkbox = screen.getByTestId("include-geozones") as HTMLInputElement;
    expect(checkbox.disabled).toBe(false);
  });

  it("hides runway-buffers checkbox until geozones is on, then gates it on mavlink", () => {
    renderPanel({
      mission: makeMission({
        drone_profile_id: "drone-1",
        supports_geozone_upload: true,
      }),
    });

    // hidden entirely while the geozones toggle is off
    expect(screen.queryByTestId("include-runway-buffers")).toBeNull();

    // toggling geozones on reveals it nested beneath, still disabled (no MAVLINK)
    fireEvent.click(screen.getByTestId("include-geozones"));
    expect(
      (screen.getByTestId("include-runway-buffers") as HTMLInputElement).disabled,
    ).toBe(true);

    // selecting MAVLINK enables it
    selectFormat("MAVLINK");
    expect(
      (screen.getByTestId("include-runway-buffers") as HTMLInputElement).disabled,
    ).toBe(false);

    // toggling geozones back off hides it again - no stale checkbox
    fireEvent.click(screen.getByTestId("include-geozones"));
    expect(screen.queryByTestId("include-runway-buffers")).toBeNull();
  });

  it("renders the advisory note when KML or KMZ is selected and parent is on", () => {
    renderPanel({
      mission: makeMission({
        drone_profile_id: "drone-1",
        supports_geozone_upload: true,
      }),
    });

    // KMZ (default) is an advisory format
    fireEvent.click(screen.getByTestId("include-geozones"));
    expect(screen.queryByTestId("advisory-note")).toBeInTheDocument();

    // switch to a non-advisory but still capable format, advisory disappears
    selectFormat("JSON");
    expect(screen.queryByTestId("advisory-note")).not.toBeInTheDocument();
  });

  it("forwards include_geozones and include_runway_buffers in onExport payload", () => {
    const onExport = vi.fn();
    renderPanel({
      onExport,
      mission: makeMission({
        drone_profile_id: "drone-1",
        supports_geozone_upload: true,
      }),
    });

    selectFormat("MAVLINK");
    fireEvent.click(screen.getByTestId("include-geozones"));
    fireEvent.click(screen.getByTestId("include-runway-buffers"));
    fireEvent.click(screen.getByTestId("download-export-btn"));

    expect(onExport).toHaveBeenCalledTimes(1);
    const [formats, options] = onExport.mock.calls[0];
    expect(formats).toEqual(["MAVLINK"]);
    expect(options).toEqual({
      include_geozones: true,
      include_runway_buffers: true,
    });
  });

  it("sends include_geozones=false in onExport payload when toggle is off", () => {
    const onExport = vi.fn();
    renderPanel({ onExport });

    // switch off the default KMZ (a DJI WPMZ format) to avoid the fallback modal
    selectFormat("JSON");
    fireEvent.click(screen.getByTestId("download-export-btn"));

    expect(onExport).toHaveBeenCalledWith(["JSON"], {
      include_geozones: false,
      include_runway_buffers: false,
    });
  });
});

// dji_heading_mode picker - DJI-only export-time control

function makeDjiProfile(
  overrides: Partial<DroneProfileResponse> = {},
): DroneProfileResponse {
  return {
    id: "dji-1",
    name: "Matrice 4T",
    manufacturer: "DJI",
    model: "Matrice 4T",
    max_speed: null,
    max_climb_rate: null,
    max_altitude: null,
    battery_capacity: null,
    endurance_minutes: null,
    camera_resolution: null,
    camera_frame_rate: null,
    sensor_fov: null,
    weight: null,
    model_identifier: null,
    max_optical_zoom: null,
    sensor_base_focal_length: null,
    default_optical_zoom: null,
    supports_geozone_upload: false,
    supports_dji_wpml: true,
    is_dji: true,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    mission_count: 0,
    ...overrides,
  };
}

describe("ExportPanel - dji heading mode picker", () => {
  function renderDjiPanel(
    missionOverrides: Partial<MissionDetailResponse> = {},
    onExport: ExportPanelProps["onExport"] = vi.fn(),
  ) {
    return renderPanel({
      mission: makeMission({
        drone_profile_id: "dji-1",
        ...missionOverrides,
      }),
      droneProfiles: [makeDjiProfile()],
      onExport,
    });
  }

  it("does not render the picker when manufacturer is non-DJI", () => {
    renderPanel({
      mission: makeMission({ drone_profile_id: "parrot-1" }),
      droneProfiles: [makeDjiProfile({ id: "parrot-1", manufacturer: "Parrot" })],
    });

    // KMZ is selected by default - if the picker were unguarded by manufacturer
    // it would still render. assert it doesn't.
    expect(screen.queryByTestId("dji-heading-mode-select")).toBeNull();
  });

  it("does not render the picker when manufacturer is null", () => {
    renderPanel({
      mission: makeMission({ drone_profile_id: "p-1" }),
      droneProfiles: [makeDjiProfile({ id: "p-1", manufacturer: null })],
    });
    expect(screen.queryByTestId("dji-heading-mode-select")).toBeNull();
  });

  it("does not render the picker when no DJI WPMZ format is selected", () => {
    renderDjiPanel();
    // KMZ is the default WPMZ format - switch to JSON to hide the picker
    selectFormat("JSON");
    expect(screen.queryByTestId("dji-heading-mode-select")).toBeNull();
  });

  it("renders the picker when KMZ is selected on a DJI mission", () => {
    renderDjiPanel();

    const select = screen.getByTestId("dji-heading-mode-select") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["smoothTransition", "towardPOI", "followWayline"]);
  });

  it("renders the picker when WPML is selected on a DJI mission", () => {
    renderDjiPanel();
    selectFormat("WPML");
    expect(screen.getByTestId("dji-heading-mode-select")).toBeInTheDocument();
  });

  it("defaults the picker to smoothTransition when the column is null", () => {
    renderDjiPanel({ dji_heading_mode: null });
    const select = screen.getByTestId("dji-heading-mode-select") as HTMLSelectElement;
    expect(select.value).toBe("smoothTransition");
  });

  it("pre-fills from mission.dji_heading_mode persisted preference", () => {
    renderDjiPanel({ dji_heading_mode: "followWayline" });
    const select = screen.getByTestId("dji-heading-mode-select") as HTMLSelectElement;
    expect(select.value).toBe("followWayline");
  });

  it("forwards dji_heading_mode_override on download", () => {
    const onExport = vi.fn();
    renderDjiPanel({ dji_heading_mode: "smoothTransition" }, onExport);

    const select = screen.getByTestId("dji-heading-mode-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "towardPOI" } });
    fireEvent.click(screen.getByTestId("download-export-btn"));

    expect(onExport).toHaveBeenCalledTimes(1);
    const [, options] = onExport.mock.calls[0];
    expect(options.dji_heading_mode_override).toBe("towardPOI");
  });

  it("omits the override when the picker is hidden", () => {
    const onExport = vi.fn();
    renderDjiPanel({}, onExport);
    // JSON is not a DJI WPMZ format: picker hidden, no override should be sent
    selectFormat("JSON");
    fireEvent.click(screen.getByTestId("download-export-btn"));

    const [, options] = onExport.mock.calls[0];
    expect(options.dji_heading_mode_override).toBeUndefined();
  });
});

// wpml-fallback modal - intercepts KMZ/WPML export for unmapped drones so the
// operator sees the m4t-tagged warning before the download starts.
describe("ExportPanel - wpml fallback modal", () => {
  function selectKmz() {
    selectFormat("KMZ");
  }
  function clickDownload() {
    fireEvent.click(screen.getByTestId("download-export-btn"));
  }

  it("intercepts KMZ download when drone is unmapped and renders the fallback modal", () => {
    const onExport = vi.fn();
    renderPanel({
      mission: makeMission({ drone_profile_id: "dp-1" }),
      droneProfiles: [
        makeDjiProfile({
          id: "dp-1",
          model: "Mavic 2 Pro",
          supports_dji_wpml: false,
          is_dji: true,
        }),
      ],
      onExport,
    });

    selectKmz();
    clickDownload();

    expect(onExport).not.toHaveBeenCalled();
    expect(
      screen.getByText(resolveKey("mission.validationExportPage.wpmlFallback.title")),
    ).toBeInTheDocument();
  });

  it("Continue Export replays the original export args", () => {
    const onExport = vi.fn();
    renderPanel({
      mission: makeMission({ drone_profile_id: "dp-1" }),
      droneProfiles: [
        makeDjiProfile({
          id: "dp-1",
          model: "Mavic 2 Pro",
          supports_dji_wpml: false,
          is_dji: true,
        }),
      ],
      onExport,
    });

    selectKmz();
    clickDownload();
    fireEvent.click(screen.getByTestId("confirm-action-btn"));

    expect(onExport).toHaveBeenCalledTimes(1);
    const [formats] = onExport.mock.calls[0];
    expect(formats).toContain("KMZ");
  });

  it("skips the modal when the drone is mapped", () => {
    const onExport = vi.fn();
    renderPanel({
      mission: makeMission({ drone_profile_id: "dp-1" }),
      droneProfiles: [
        makeDjiProfile({
          id: "dp-1",
          model: "Matrice 4T",
          supports_dji_wpml: true,
          is_dji: true,
        }),
      ],
      onExport,
    });

    selectKmz();
    clickDownload();

    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("uses the non-DJI body copy for non-DJI drones", () => {
    renderPanel({
      mission: makeMission({ drone_profile_id: "dp-1" }),
      droneProfiles: [
        makeDjiProfile({
          id: "dp-1",
          name: "Skydio X10",
          manufacturer: "Skydio",
          model: "Skydio X10",
          supports_dji_wpml: false,
          is_dji: false,
        }),
      ],
    });

    selectKmz();
    clickDownload();

    // resolved body interpolates the drone name; we just check the substring
    // unique to the non-dji copy.
    expect(screen.getByText(/DJI-proprietary/i)).toBeInTheDocument();
  });
});

// altitude-clamp warning + ack checkbox - surfaces the backend 409 payload
// and gates the download button until the operator ticks the acknowledgment.
describe("ExportPanel - altitude clamp warning", () => {
  const CLAMPS = [
    {
      waypoint_index: 4,
      intended_alt: 290.5,
      clamped_alt: 300,
      reason: "below_takeoff" as const,
    },
    {
      waypoint_index: 7,
      intended_alt: 285.0,
      clamped_alt: 300,
      reason: "below_takeoff" as const,
    },
  ];

  it("does not render the warning section when clampWarning is null", () => {
    renderPanel();
    expect(screen.queryByTestId("altitude-clamp-warning")).toBeNull();
  });

  it("renders the warning table with one row per affected waypoint", () => {
    renderPanel({ clampWarning: CLAMPS });

    expect(screen.getByTestId("altitude-clamp-warning")).toBeInTheDocument();
    expect(screen.getByTestId("altitude-clamp-row-4")).toBeInTheDocument();
    expect(screen.getByTestId("altitude-clamp-row-7")).toBeInTheDocument();
  });

  it("disables the download button until the ack checkbox is ticked", () => {
    renderPanel({ clampWarning: CLAMPS });

    const download = screen.getByTestId("download-export-btn") as HTMLButtonElement;
    expect(download.disabled).toBe(true);

    fireEvent.click(screen.getByTestId("altitude-clamp-ack"));
    expect(download.disabled).toBe(false);
  });

  it("re-exports with acknowledge_altitude_clamps=true after the ack click", () => {
    const onExport = vi.fn();
    renderPanel({ onExport, clampWarning: CLAMPS });

    // no drone on the default mission, so switch off KMZ to skip the wpml modal
    selectFormat("JSON");
    fireEvent.click(screen.getByTestId("altitude-clamp-ack"));
    fireEvent.click(screen.getByTestId("download-export-btn"));

    expect(onExport).toHaveBeenCalledTimes(1);
    const [, options] = onExport.mock.calls[0];
    expect(options.acknowledge_altitude_clamps).toBe(true);
  });

  it("omits acknowledge_altitude_clamps when no clamp warning is active", () => {
    const onExport = vi.fn();
    renderPanel({ onExport });

    selectFormat("JSON");
    fireEvent.click(screen.getByTestId("download-export-btn"));
    const [, options] = onExport.mock.calls[0];
    expect(options.acknowledge_altitude_clamps).toBeUndefined();
  });

  it("resets the ack checkbox when a fresh clamp set arrives", () => {
    const { rerender, props } = renderPanel({ clampWarning: CLAMPS });

    fireEvent.click(screen.getByTestId("altitude-clamp-ack"));
    expect((screen.getByTestId("altitude-clamp-ack") as HTMLInputElement).checked).toBe(true);

    rerender(
      <ExportPanel
        {...props}
        clampWarning={[
          { ...CLAMPS[0], waypoint_index: 99, intended_alt: 280 },
        ]}
      />,
    );
    expect((screen.getByTestId("altitude-clamp-ack") as HTMLInputElement).checked).toBe(false);
  });
});

// lifecycle gating - complete / cancel are reachable only from MEASURED, the
// one non-terminal status the state machine lets reach a terminal state.
describe("ExportPanel - lifecycle gating", () => {
  it("disables complete/cancel for a VALIDATED mission", () => {
    renderPanel({ mission: makeMission({ status: "VALIDATED" }) });

    expect(screen.getByTestId("complete-btn")).toBeDisabled();
    expect(screen.getByTestId("cancel-mission-btn")).toBeDisabled();
  });

  it("disables complete/cancel for an EXPORTED mission", () => {
    renderPanel({ mission: makeMission({ status: "EXPORTED" }) });

    expect(screen.getByTestId("complete-btn")).toBeDisabled();
    expect(screen.getByTestId("cancel-mission-btn")).toBeDisabled();
  });

  it("enables complete/cancel for a MEASURED mission", () => {
    renderPanel({ mission: makeMission({ status: "MEASURED" }) });

    expect(screen.getByTestId("complete-btn")).not.toBeDisabled();
    expect(screen.getByTestId("cancel-mission-btn")).not.toBeDisabled();
  });

  it("routes complete/cancel clicks through the confirm modal for MEASURED", () => {
    const onComplete = vi.fn();
    renderPanel({ mission: makeMission({ status: "MEASURED" }), onComplete });

    fireEvent.click(screen.getByTestId("complete-btn"));
    fireEvent.click(screen.getByTestId("confirm-action-btn"));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

// field-link chip + send-to-drone - both fed by the panel's single poll
describe("ExportPanel - field link wiring", () => {
  afterEach(() => {
    vi.mocked(useFieldLinkStatus).mockReturnValue(poll(null));
  });

  it("renders no chip and a disabled send button before the first status response", () => {
    renderPanel();

    expect(screen.queryByTestId("field-link-chip")).toBeNull();
    expect(screen.getByTestId("send-to-drone-btn")).toBeDisabled();
  });

  it("feeds the shared link status to the chip and the send-to-drone gate", () => {
    vi.mocked(useFieldLinkStatus).mockReturnValue(poll(ONLINE_M350));
    renderPanel();

    const rc = screen.getByTestId("field-link-rc");
    expect(rc).toHaveAttribute("data-state", "online");
    expect(rc.textContent).toContain("RC connected");
    // VALIDATED mission + online device -> dispatch allowed
    expect(screen.getByTestId("send-to-drone-btn")).not.toBeDisabled();
  });

  it("keeps the send button disabled for non-exportable missions even when online", () => {
    vi.mocked(useFieldLinkStatus).mockReturnValue(poll(ONLINE_M350));
    renderPanel({ mission: makeMission({ status: "DRAFT" }) });

    expect(screen.getByTestId("send-to-drone-btn")).toBeDisabled();
  });
});
