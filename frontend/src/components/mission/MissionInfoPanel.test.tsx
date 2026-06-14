import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MissionInfoPanel from "./MissionInfoPanel";
import type { MissionDetailResponse } from "@/types/mission";

function mission(overrides: Partial<MissionDetailResponse> = {}): MissionDetailResponse {
  /** build a minimal mission detail for tests. */
  return {
    id: "m1",
    name: "Mission 1",
    status: "DRAFT",
    airport_id: "a1",
    created_at: "2026-05-01T10:00:00Z",
    updated_at: "2026-05-02T11:00:00Z",
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
  } as MissionDetailResponse;
}

describe("MissionInfoPanel - AGLs cell", () => {
  it("renders the comma-joined AGL names", () => {
    render(
      <MissionInfoPanel
        mission={mission()}
        droneProfileName="Profile"
        runwayName="09L/27R"
        aglNames="PAPI 09L, PAPI 27R, REL 09L"
        validationPassed={null}
      />,
    );
    expect(screen.getByText("mission.overview.agls:")).toBeInTheDocument();
    expect(screen.getByText("PAPI 09L, PAPI 27R, REL 09L")).toBeInTheDocument();
  });

  it("falls back to em dash when no AGLs are present", () => {
    render(
      <MissionInfoPanel
        mission={mission()}
        droneProfileName="Profile"
        runwayName="09L/27R"
        aglNames={null}
        validationPassed={null}
      />,
    );
    const cell = screen.getByText("mission.overview.agls:").parentElement;
    expect(cell?.textContent).toContain("—");
  });
});
