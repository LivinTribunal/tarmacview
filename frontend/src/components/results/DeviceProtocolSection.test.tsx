import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type {
  DeviceResults,
  MissionLightResult,
} from "@/types/measurement";
import DeviceProtocolSection from "./DeviceProtocolSection";

function light(over: Partial<MissionLightResult> = {}): MissionLightResult {
  return {
    lha_id: "lha-1",
    unit_designator: "A",
    light_name: "PAPI_A",
    setting_angle: 3.0,
    tolerance: 0.5,
    measured_transition_angle: 3.1,
    measured_transition_angle_touchpoint: null,
    transition_angle_min: 2.9,
    transition_angle_middle: 3.1,
    transition_angle_max: 3.3,
    transition_angle_min_touchpoint: null,
    transition_angle_middle_touchpoint: null,
    transition_angle_max_touchpoint: null,
    passed: true,
    not_measured: false,
    ...over,
  };
}

function device(over: Partial<DeviceResults> = {}): DeviceResults {
  return {
    agl_id: "agl-1",
    device_type: "PAPI",
    device_label: "PAPI 06",
    inspection_id: "insp-1",
    inspection_method: "HORIZONTAL_RANGE",
    measurement_id: "m-1",
    status: "DONE",
    evaluation: "PASS",
    glide_slope: {
      measured_glide_slope_angle: 3.0,
      configured_glide_slope_angle: 3.0,
      glide_slope_angle_tolerance: 0.1,
      within_tolerance: true,
    },
    ils_harmonization: null,
    lights: [light()],
    placeholder_rows: ["chromaticity", "meht"],
    ...over,
  };
}

describe("DeviceProtocolSection", () => {
  it("renders glide slope + measured per-light rows with a pass icon", () => {
    render(<DeviceProtocolSection device={device()} onDrillDown={vi.fn()} />);
    expect(screen.getByTestId("glide-slope-row")).toBeInTheDocument();
    expect(screen.getByTestId("light-row-measured")).toBeInTheDocument();
    expect(screen.getByTestId("light-pass")).toBeInTheDocument();
  });

  it("shows a fail icon for a failed light", () => {
    render(
      <DeviceProtocolSection
        device={device({ lights: [light({ passed: false })] })}
        onDrillDown={vi.fn()}
      />,
    );
    expect(screen.getByTestId("light-fail")).toBeInTheDocument();
  });

  it("renders a not-measured light row greyed with an N/A tag, not as FAIL", () => {
    render(
      <DeviceProtocolSection
        device={device({
          status: "NOT_MEASURED",
          evaluation: "NOT_MEASURED",
          glide_slope: null,
          lights: [light({ not_measured: true, passed: null })],
        })}
        onDrillDown={vi.fn()}
      />,
    );
    const row = screen.getByTestId("light-row-not-measured");
    expect(row.className).toContain("text-tv-text-muted");
    // must not read as FAIL
    expect(row.className).not.toContain("tv-status-cancelled");
    const tag = within(row).getByTestId("not-measured-tag");
    expect(tag.className).not.toContain("tv-status-cancelled");
    expect(screen.queryByTestId("light-fail")).not.toBeInTheDocument();
  });

  it("renders each placeholder row greyed with an N/A tag", () => {
    render(<DeviceProtocolSection device={device()} onDrillDown={vi.fn()} />);
    const rows = screen.getByTestId("placeholder-rows");
    expect(rows.querySelectorAll("li")).toHaveLength(2);
    expect(rows.className).not.toContain("tv-status-cancelled");
  });

  it("renders the ils-harmonization row when present, not among placeholders", () => {
    render(
      <DeviceProtocolSection
        device={device({
          ils_harmonization: {
            measured_glide_slope_angle_touchpoint: 3.01,
            configured_glide_slope_angle: 3.0,
            ils_harmonization_tolerance: 0.05,
            within_tolerance: true,
            evaluation: "PASS",
          },
        })}
        onDrillDown={vi.fn()}
      />,
    );
    const row = screen.getByTestId("ils-harmonization-row");
    // measured / nominal ± tolerance ride in one split span
    expect(row.textContent).toContain("3.01°");
    expect(row.textContent).toContain("3.00° ± 0.05°");
    // ils_alignment is no longer a greyed placeholder row
    expect(screen.queryByText("results.overview.rows.ils_alignment")).not.toBeInTheDocument();
  });

  it("omits the ils-harmonization row when absent", () => {
    render(<DeviceProtocolSection device={device()} onDrillDown={vi.fn()} />);
    expect(screen.queryByTestId("ils-harmonization-row")).not.toBeInTheDocument();
  });

  it("drills down from a DONE device header", () => {
    const onDrillDown = vi.fn();
    render(<DeviceProtocolSection device={device()} onDrillDown={onDrillDown} />);
    fireEvent.click(screen.getByTestId("device-drill-down"));
    expect(onDrillDown).toHaveBeenCalledWith("insp-1");
  });

  it("header is not clickable when the device is not DONE", () => {
    render(
      <DeviceProtocolSection
        device={device({ status: "NOT_MEASURED", evaluation: "NOT_MEASURED" })}
        onDrillDown={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("device-drill-down")).not.toBeInTheDocument();
  });
});
