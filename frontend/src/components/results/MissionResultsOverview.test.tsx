import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { DeviceResults, MissionResults } from "@/types/measurement";
import MissionResultsOverview from "./MissionResultsOverview";

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
    glide_slope: null,
    ils_harmonization: null,
    lights: [],
    placeholder_rows: [],
    ...over,
  };
}

function overview(over: Partial<MissionResults> = {}): MissionResults {
  return {
    mission_id: "mission-1",
    mission_name: "Protocol Mission",
    header: {
      airport_icao: "LZIB",
      airport_name: "Bratislava",
      mission_name: "Protocol Mission",
      measurement_date: null,
      drone_model: "Matrice 4T",
      optical_sensor: null,
      reference_system: null,
      certificate_number: null,
    },
    weather: {
      temperature_c: null,
      wind: null,
      visibility: null,
      conditions: null,
    },
    runways: [
      {
        surface_id: "s-1",
        runway_identifier: "06/24",
        runway_heading: 60,
        devices: [device(), device({ device_label: "ALS 06", device_type: "ALS" })],
      },
    ],
    evaluation: [{ device_label: "PAPI 06", result: "PASS", restrictions: null, recommendations: null }],
    recommendations: null,
    ...over,
  };
}

describe("MissionResultsOverview", () => {
  it("renders header, weather, a section per device, evaluation and recommendations", () => {
    render(
      <MissionResultsOverview
        overview={overview()}
        loading={false}
        error={false}
        onDrillDown={vi.fn()}
      />,
    );
    expect(screen.getByTestId("mission-results-overview")).toBeInTheDocument();
    expect(screen.getByText("results.overview.weather.title")).toBeInTheDocument();
    expect(screen.getByTestId("device-section-PAPI 06")).toBeInTheDocument();
    expect(screen.getByTestId("device-section-ALS 06")).toBeInTheDocument();
    expect(screen.getByTestId("mission-evaluation-table")).toBeInTheDocument();
    expect(
      screen.getByText("results.overview.noRecommendations"),
    ).toBeInTheDocument();
  });

  it("drills down when a DONE device header is clicked", () => {
    const onDrillDown = vi.fn();
    render(
      <MissionResultsOverview
        overview={overview()}
        loading={false}
        error={false}
        onDrillDown={onDrillDown}
      />,
    );
    fireEvent.click(screen.getAllByTestId("device-drill-down")[0]);
    expect(onDrillDown).toHaveBeenCalledWith("insp-1");
  });

  it("shows a spinner while loading", () => {
    render(
      <MissionResultsOverview
        overview={null}
        loading={true}
        error={false}
        onDrillDown={vi.fn()}
      />,
    );
    expect(screen.getByTestId("overview-loading")).toBeInTheDocument();
  });

  it("shows an error card on failure", () => {
    render(
      <MissionResultsOverview
        overview={null}
        loading={false}
        error={true}
        onDrillDown={vi.fn()}
      />,
    );
    expect(screen.getByTestId("overview-error")).toBeInTheDocument();
  });
});
