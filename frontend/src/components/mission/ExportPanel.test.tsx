import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import en from "@/i18n/locales/en.json";
import ExportPanel, { type ExportPanelProps } from "./ExportPanel";
import { useFieldLinkStatus } from "@/hooks/useFieldLinkStatus";
import type { MissionDetailResponse } from "@/types/mission";
import type { DroneProfileResponse } from "@/types/droneProfile";

// the panel polls the backend through this hook (one poll shared by the chip
// and the send-to-drone gate) - stub it so panel tests stay network-free;
// chip behavior is covered in FieldLinkStatusChip.test.tsx
vi.mock("@/hooks/useFieldLinkStatus", () => ({
  useFieldLinkStatus: vi.fn(() => null),
}));

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
});

describe("ExportPanel - per-format capability notes", () => {
  it("renders zoom-only English copy for KMZ and WPML", () => {
    renderPanel();

    const kmzNote = screen.getByTestId("capability-KMZ");
    const wpmlNote = screen.getByTestId("capability-WPML");
    expect(kmzNote.textContent).toMatch(/Carries optical zoom per inspection/);
    expect(wpmlNote.textContent).toMatch(/Carries optical zoom per inspection/);
  });

  it("renders full-coverage English copy for JSON", () => {
    renderPanel();

    const jsonNote = screen.getByTestId("capability-JSON");
    expect(jsonNote.textContent).toMatch(/Carries all camera settings/);
  });

  it("renders the dedicated KML name+description note", () => {
    renderPanel();

    const kmlNote = screen.getByTestId("capability-KML");
    expect(kmlNote.textContent).toMatch(
      /KML carries waypoint name and description text only/,
    );
  });

  it("renders no-camera-settings English copy for raw-coordinate formats", () => {
    renderPanel();

    for (const fmt of ["MAVLINK", "UGCS", "CSV", "GPX", "LITCHI", "DRONEDEPLOY"]) {
      const note = screen.getByTestId(`capability-${fmt}`);
      expect(note.textContent).toMatch(/No camera settings in this format/);
    }
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

    // KML is selected by default - it IS capable. switch to GPX (incapable).
    fireEvent.click(screen.getByTestId("format-KML"));
    fireEvent.click(screen.getByTestId("format-GPX"));

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

  it("disables runway-buffers nested checkbox until parent is on AND mavlink selected", () => {
    renderPanel({
      mission: makeMission({
        drone_profile_id: "drone-1",
        supports_geozone_upload: true,
      }),
    });

    const runway = screen.getByTestId("include-runway-buffers") as HTMLInputElement;
    expect(runway.disabled).toBe(true);

    fireEvent.click(screen.getByTestId("include-geozones"));
    // still disabled because MAVLINK isn't selected
    expect(runway.disabled).toBe(true);

    fireEvent.click(screen.getByTestId("format-MAVLINK"));
    expect(runway.disabled).toBe(false);
  });

  it("renders the advisory note when KML or KMZ is in selection and parent is on", () => {
    renderPanel({
      mission: makeMission({
        drone_profile_id: "drone-1",
        supports_geozone_upload: true,
      }),
    });

    fireEvent.click(screen.getByTestId("include-geozones"));
    expect(screen.queryByTestId("advisory-note")).toBeInTheDocument();

    // turn KML off, advisory disappears
    fireEvent.click(screen.getByTestId("format-KML"));
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

    fireEvent.click(screen.getByTestId("format-MAVLINK"));
    fireEvent.click(screen.getByTestId("include-geozones"));
    fireEvent.click(screen.getByTestId("include-runway-buffers"));
    fireEvent.click(screen.getByTestId("download-export-btn"));

    expect(onExport).toHaveBeenCalledTimes(1);
    const [formats, options] = onExport.mock.calls[0];
    expect(formats).toEqual(expect.arrayContaining(["KML", "MAVLINK"]));
    expect(options).toEqual({
      include_geozones: true,
      include_runway_buffers: true,
    });
  });

  it("sends include_geozones=false in onExport payload when toggle is off", () => {
    const onExport = vi.fn();
    renderPanel({ onExport });

    fireEvent.click(screen.getByTestId("download-export-btn"));

    expect(onExport).toHaveBeenCalledWith(["KML"], {
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

    // KML is selected by default - if the picker were unguarded by manufacturer
    // it would still render. assert it doesn't.
    fireEvent.click(screen.getByTestId("format-KMZ"));
    expect(screen.queryByTestId("dji-heading-mode-select")).toBeNull();
  });

  it("does not render the picker when manufacturer is null", () => {
    renderPanel({
      mission: makeMission({ drone_profile_id: "p-1" }),
      droneProfiles: [makeDjiProfile({ id: "p-1", manufacturer: null })],
    });
    fireEvent.click(screen.getByTestId("format-KMZ"));
    expect(screen.queryByTestId("dji-heading-mode-select")).toBeNull();
  });

  it("does not render the picker when no DJI WPMZ format is selected", () => {
    renderDjiPanel();
    // KML is selected by default but it is not a DJI WPMZ format
    expect(screen.queryByTestId("dji-heading-mode-select")).toBeNull();
  });

  it("renders the picker when KMZ is selected on a DJI mission", () => {
    renderDjiPanel();
    fireEvent.click(screen.getByTestId("format-KMZ"));

    const select = screen.getByTestId("dji-heading-mode-select") as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(["smoothTransition", "towardPOI", "followWayline"]);
  });

  it("renders the picker when WPML is selected on a DJI mission", () => {
    renderDjiPanel();
    fireEvent.click(screen.getByTestId("format-WPML"));
    expect(screen.getByTestId("dji-heading-mode-select")).toBeInTheDocument();
  });

  it("defaults the picker to smoothTransition when the column is null", () => {
    renderDjiPanel({ dji_heading_mode: null });
    fireEvent.click(screen.getByTestId("format-KMZ"));
    const select = screen.getByTestId("dji-heading-mode-select") as HTMLSelectElement;
    expect(select.value).toBe("smoothTransition");
  });

  it("pre-fills from mission.dji_heading_mode persisted preference", () => {
    renderDjiPanel({ dji_heading_mode: "followWayline" });
    fireEvent.click(screen.getByTestId("format-KMZ"));
    const select = screen.getByTestId("dji-heading-mode-select") as HTMLSelectElement;
    expect(select.value).toBe("followWayline");
  });

  it("forwards dji_heading_mode_override on download", () => {
    const onExport = vi.fn();
    renderDjiPanel({ dji_heading_mode: "smoothTransition" }, onExport);
    fireEvent.click(screen.getByTestId("format-KMZ"));

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
    // KML-only selection: picker hidden, no override should be sent
    fireEvent.click(screen.getByTestId("download-export-btn"));

    const [, options] = onExport.mock.calls[0];
    expect(options.dji_heading_mode_override).toBeUndefined();
  });
});

// wpml-fallback modal - intercepts KMZ/WPML export for unmapped drones so the
// operator sees the m4t-tagged warning before the download starts.
describe("ExportPanel - wpml fallback modal", () => {
  function selectKmz() {
    fireEvent.click(screen.getByTestId("format-KMZ"));
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

    fireEvent.click(screen.getByTestId("altitude-clamp-ack"));
    fireEvent.click(screen.getByTestId("download-export-btn"));

    expect(onExport).toHaveBeenCalledTimes(1);
    const [, options] = onExport.mock.calls[0];
    expect(options.acknowledge_altitude_clamps).toBe(true);
  });

  it("omits acknowledge_altitude_clamps when no clamp warning is active", () => {
    const onExport = vi.fn();
    renderPanel({ onExport });

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

// field-link chip + send-to-drone - both fed by the panel's single poll
describe("ExportPanel - field link wiring", () => {
  afterEach(() => {
    vi.mocked(useFieldLinkStatus).mockReturnValue(null);
  });

  it("renders no chip and a disabled send button before the first status response", () => {
    renderPanel();

    expect(screen.queryByTestId("field-link-chip")).toBeNull();
    expect(screen.getByTestId("send-to-drone-btn")).toBeDisabled();
  });

  it("feeds the shared link status to the chip and the send-to-drone gate", () => {
    vi.mocked(useFieldLinkStatus).mockReturnValue({
      hub_online: true,
      broker_connected: true,
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
    });
    renderPanel();

    const chip = screen.getByTestId("field-link-chip");
    expect(chip).toHaveAttribute("data-state", "online");
    expect(chip.textContent).toContain("RC connected");
    // VALIDATED mission + online device -> dispatch allowed
    expect(screen.getByTestId("send-to-drone-btn")).not.toBeDisabled();
  });

  it("keeps the send button disabled for non-exportable missions even when online", () => {
    vi.mocked(useFieldLinkStatus).mockReturnValue({
      hub_online: true,
      broker_connected: true,
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
    });
    renderPanel({ mission: makeMission({ status: "DRAFT" }) });

    expect(screen.getByTestId("send-to-drone-btn")).toBeDisabled();
  });
});
