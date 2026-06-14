import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LegendPanel from "./LegendPanel";
import type { MapLayerConfig } from "@/types/map";

describe("LegendPanel", () => {
  it("renders with the legend-panel test id", () => {
    render(<LegendPanel />);
    expect(screen.getByTestId("legend-panel")).toBeInTheDocument();
  });

  it("collapses the panel when the header is clicked", () => {
    render(<LegendPanel />);

    // obstacles default-open, so its label is visible up front
    expect(screen.getByText("dashboard.obstacles")).toBeInTheDocument();

    const header = screen.getByText("dashboard.legend");
    fireEvent.click(header);

    expect(screen.queryByText("dashboard.obstacles")).not.toBeInTheDocument();
  });

  it("renders the full waypoint set for a PLANNED mission", () => {
    render(<LegendPanel missionStatus="PLANNED" />);

    expect(screen.getByText("dashboard.measurement")).toBeInTheDocument();
    expect(screen.getByText("dashboard.transit")).toBeInTheDocument();
    expect(screen.getByText("dashboard.hover")).toBeInTheDocument();
    expect(screen.getByText("dashboard.transitPath")).toBeInTheDocument();
    expect(screen.getByText("dashboard.waypointTakeoff")).toBeInTheDocument();
    expect(screen.getByText("dashboard.waypointLanding")).toBeInTheDocument();
  });

  it("renders only takeoff/landing for a DRAFT mission with takeoff set", () => {
    render(<LegendPanel missionStatus="DRAFT" hasTakeoff />);

    expect(screen.getByText("dashboard.waypointTakeoff")).toBeInTheDocument();
    expect(screen.getByText("dashboard.waypointLanding")).toBeInTheDocument();
    expect(screen.queryByText("dashboard.measurement")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard.transit")).not.toBeInTheDocument();
  });

  it("respects the layers config and only renders enabled sections", () => {
    const layers: MapLayerConfig = {
      runways: false,
      taxiways: false,
      safetyZones: true,
      airportBoundary: true,
      obstacles: false,
      aglSystems: false,
      bufferZones: false,
      simplifiedTrajectory: false,
      trajectory: false,
      transitWaypoints: false,
      measurementWaypoints: false,
      path: false,
      takeoffLanding: false,
      cameraHeading: false,
      pathHeading: false,
    };

    render(<LegendPanel layers={layers} />);

    expect(screen.getByText("layers.safetyZonesAndBoundary")).toBeInTheDocument();
    expect(screen.queryByText("dashboard.groundSurfaces")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard.obstacles")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard.aglSystems")).not.toBeInTheDocument();
    expect(screen.queryByText("dashboard.flightPlan")).not.toBeInTheDocument();
  });

  it("renders the safety zones section when only airportBoundary is on", () => {
    const layers: MapLayerConfig = {
      runways: false,
      taxiways: false,
      safetyZones: false,
      airportBoundary: true,
      obstacles: false,
      aglSystems: false,
      bufferZones: false,
      simplifiedTrajectory: false,
      trajectory: false,
      transitWaypoints: false,
      measurementWaypoints: false,
      path: false,
      takeoffLanding: false,
      cameraHeading: false,
      pathHeading: false,
    };

    render(<LegendPanel layers={layers} />);

    expect(screen.getByText("layers.safetyZonesAndBoundary")).toBeInTheDocument();
  });

  it("hides the safety zones section when both safetyZones and airportBoundary are off", () => {
    const layers: MapLayerConfig = {
      runways: false,
      taxiways: false,
      safetyZones: false,
      airportBoundary: false,
      obstacles: false,
      aglSystems: false,
      bufferZones: false,
      simplifiedTrajectory: false,
      trajectory: false,
      transitWaypoints: false,
      measurementWaypoints: false,
      path: false,
      takeoffLanding: false,
      cameraHeading: false,
      pathHeading: false,
    };

    render(<LegendPanel layers={layers} />);

    expect(screen.queryByText("layers.safetyZonesAndBoundary")).not.toBeInTheDocument();
  });
});
