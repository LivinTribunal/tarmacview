import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import MapControlsToolbar from "@/components/map/overlays/MapControlsToolbar";
import MapWarningsPanel from "@/components/map/overlays/MapWarningsPanel";
import MapStatsPanel from "@/components/map/overlays/MapStatsPanel";
import { MapTool } from "@/hooks/useMapTools";
import useFlyAlong from "@/hooks/useFlyAlong";
import client from "@/api/client";
import {
  revalidateFlightPlan,
  batchUpdateWaypoints,
  updateMission,
} from "@/api/missions";
import type {
  FlightPlanResponse,
  ValidationViolation,
  WaypointPositionUpdate,
  WaypointResponse,
} from "@/types/flightPlan";
import type { PointZ } from "@/types/common";

vi.mock("@/api/client", () => ({
  default: { post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() },
  isAxiosError: vi.fn(),
}));

// lightweight component tests - avoid rendering full page to prevent OOM in CI

const toolbarDefaults = {
  activeTool: MapTool.SELECT,
  onToolChange: vi.fn(),
  is3D: false,
  onToggle3D: vi.fn(),
  terrainMode: "satellite" as const,
  onTerrainChange: vi.fn(),
  canUndo: false,
  canRedo: false,
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onZoomReset: vi.fn(),
  zoomPercent: 100,
  onZoomTo: vi.fn(),
};

describe("MapControlsToolbar", () => {
  /** tests for the map controls toolbar. */

  it("renders toolbar with tool buttons", () => {
    /** verify toolbar renders with expected test id. */
    render(<MapControlsToolbar {...toolbarDefaults} />);
    expect(screen.getByTestId("map-controls-toolbar")).toBeInTheDocument();
  });

  it("highlights the active tool", () => {
    /** verify the select tool is visually active. */
    render(<MapControlsToolbar {...toolbarDefaults} activeTool={MapTool.SELECT} />);
    const btn = screen.getByTestId("tool-select");
    expect(btn.className).toContain("bg-tv-accent");
  });

  it("calls onToolChange when a tool button is clicked", () => {
    /** verify clicking a tool fires the callback. */
    const onToolChange = vi.fn();
    render(<MapControlsToolbar {...toolbarDefaults} onToolChange={onToolChange} />);
    fireEvent.click(screen.getByTestId("tool-move_waypoint"));
    expect(onToolChange).toHaveBeenCalledWith(MapTool.MOVE_WAYPOINT);
  });

  it("does not render a pan tool button", () => {
    /** verify the pan button has been removed in favor of select/move. */
    render(<MapControlsToolbar {...toolbarDefaults} />);
    expect(screen.queryByTestId("tool-pan")).toBeNull();
    expect(screen.getByTestId("tool-select")).toBeInTheDocument();
    expect(screen.getByTestId("tool-move_waypoint")).toBeInTheDocument();
  });

  it("disables undo when canUndo is false", () => {
    /** verify undo button is disabled. */
    render(<MapControlsToolbar {...toolbarDefaults} canUndo={false} />);
    expect(screen.getByTestId("undo-btn")).toBeDisabled();
  });

  it("enables undo when canUndo is true", () => {
    /** verify undo button is enabled. */
    render(<MapControlsToolbar {...toolbarDefaults} canUndo={true} />);
    expect(screen.getByTestId("undo-btn")).not.toBeDisabled();
  });

  it("calls onUndo when undo button is clicked", () => {
    /** verify undo fires the callback. */
    const onUndo = vi.fn();
    render(<MapControlsToolbar {...toolbarDefaults} canUndo={true} onUndo={onUndo} />);
    fireEvent.click(screen.getByTestId("undo-btn"));
    expect(onUndo).toHaveBeenCalled();
  });

  it("calls onRedo when redo button is clicked", () => {
    /** verify redo fires the callback. */
    const onRedo = vi.fn();
    render(<MapControlsToolbar {...toolbarDefaults} canRedo={true} onRedo={onRedo} />);
    fireEvent.click(screen.getByTestId("redo-btn"));
    expect(onRedo).toHaveBeenCalled();
  });
});

function FlyAlongToolbarSubtree({
  waypoints,
}: {
  waypoints: WaypointResponse[];
  segmentDurations: number[];
}) {
  const { state, play, pause, stop, setSpeed } = useFlyAlong(waypoints.length);
  return (
    <MapControlsToolbar
      {...toolbarDefaults}
      is3D={true}
      hasTrajectory={waypoints.length >= 2}
      flyAlongState={state}
      onFlyAlongPlay={play}
      onFlyAlongPause={pause}
      onFlyAlongStop={stop}
      onFlyAlongSpeedChange={setSpeed}
    />
  );
}

describe("MapControlsToolbar fly-along integration", () => {

  function makeWaypoints(count: number): WaypointResponse[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `wp-${i}`,
      flight_plan_id: "fp",
      inspection_id: null,
      sequence_order: i,
      position: { type: "Point", coordinates: [0, 0, 0] },
      heading: null,
      speed: 1,
      hover_duration: null,
      camera_action: null,
      waypoint_type: "TRANSIT",
      camera_target: null,
      gimbal_pitch: null,
    }));
  }

  it("hides the fly-along pill in 2d", () => {
    render(
      <MapControlsToolbar
        {...toolbarDefaults}
        is3D={false}
        hasTrajectory={true}
        flyAlongState={{ status: "idle", speed: 2, progress: 0 }}
      />,
    );
    expect(screen.queryByTestId("fly-along-play")).toBeNull();
  });

  it("hides the fly-along pill when no trajectory", () => {
    render(
      <MapControlsToolbar
        {...toolbarDefaults}
        is3D={true}
        hasTrajectory={false}
        flyAlongState={{ status: "idle", speed: 2, progress: 0 }}
      />,
    );
    expect(screen.queryByTestId("fly-along-play")).toBeNull();
  });

  it("clicking play swaps play -> pause and renders the progress bar", () => {
    const waypoints = makeWaypoints(5);
    const segmentDurations = [2, 2, 2, 2];
    render(<FlyAlongToolbarSubtree waypoints={waypoints} segmentDurations={segmentDurations} />);

    expect(screen.getByTestId("fly-along-play")).toBeInTheDocument();
    expect(screen.queryByTestId("fly-along-pause")).toBeNull();

    act(() => {
      fireEvent.click(screen.getByTestId("fly-along-play"));
    });

    expect(screen.getByTestId("fly-along-pause")).toBeInTheDocument();
    const progressBar = screen
      .getByTestId("fly-along-pause")
      .parentElement?.querySelector("div.h-full");
    expect(progressBar).toBeInTheDocument();
  });
});

describe("MapWarningsPanel", () => {
  /** tests for the map warnings overlay panel. */

  it("renders nothing when violations is empty", () => {
    /** verify no output for empty violations. */
    const { container } = render(<MapWarningsPanel violations={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders violations sorted by severity", () => {
    /** verify violations appear and panel renders. */
    render(
      <MapWarningsPanel
        violations={[
          { id: "1", message: "Speed warning", category: "warning", is_warning: true, severity: "warning", constraint_id: null, constraint_name: null, violation_kind: "speed", waypoint_ref: null, waypoint_ids: [] },
          { id: "2", message: "Altitude error", category: "violation", is_warning: false, severity: "violation", constraint_id: null, constraint_name: null, violation_kind: "altitude", waypoint_ref: null, waypoint_ids: [] },
        ]}
      />,
    );
    expect(screen.getByTestId("map-warnings-panel")).toBeInTheDocument();
  });
});

describe("MapStatsPanel", () => {
  /** tests for the map stats overlay panel. */

  const baseFlightPlan = {
    id: "fp-1",
    mission_id: "m-1",
    airport_id: "apt-1",
    total_distance: 2500,
    estimated_duration: 600,
    is_validated: false,
    generated_at: "2026-03-19T00:00:00Z",
    waypoints: [
      { id: "wp-1", sequence_order: 1 },
      { id: "wp-2", sequence_order: 2 },
    ],
    validation_result: null,
  };

  it("renders stats panel with flight data", () => {
    /** verify the stats panel renders. */
    render(
      <MapStatsPanel
        flightPlan={baseFlightPlan as never}
        inspectionCount={2}
        enduranceMinutes={55}
      />,
    );
    expect(screen.getByTestId("map-stats-panel")).toBeInTheDocument();
  });

  it("shows distance in kilometers", () => {
    /** verify distance formatting. */
    render(
      <MapStatsPanel
        flightPlan={baseFlightPlan as never}
        inspectionCount={1}
      />,
    );
    expect(screen.getByText("2.50 km")).toBeInTheDocument();
  });

  it("shows formatted duration", () => {
    /** verify duration formatting. */
    render(
      <MapStatsPanel
        flightPlan={baseFlightPlan as never}
        inspectionCount={1}
      />,
    );
    expect(screen.getByText("10:00")).toBeInTheDocument();
  });

  it("shows battery percentage when endurance provided", () => {
    /** verify battery calculation. */
    render(
      <MapStatsPanel
        flightPlan={baseFlightPlan as never}
        inspectionCount={1}
        enduranceMinutes={55}
      />,
    );
    // 600s = 10min, 10/55 = 18.2%, remaining = 82%
    expect(screen.getByText("82%")).toBeInTheDocument();
  });

  it("shows waypoint count", () => {
    /** verify waypoint count display. */
    render(
      <MapStatsPanel
        flightPlan={baseFlightPlan as never}
        inspectionCount={3}
      />,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

// minimal subtree mirroring MissionMapPage's validate-button + warnings-panel wiring
// so we can assert the click -> api -> toast -> panel-rerender path without dragging
// in AirportMap, MapLibre, or the route/outlet/context graph.
function ValidateButtonSubtree({
  missionId,
  initialFlightPlan,
}: {
  missionId: string;
  initialFlightPlan: FlightPlanResponse;
}) {
  const { t } = useTranslation();
  const [flightPlan, setFlightPlan] = useState<FlightPlanResponse>(initialFlightPlan);
  const [revalidating, setRevalidating] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  async function handleClick() {
    setRevalidating(true);
    try {
      const fp = await revalidateFlightPlan(missionId);
      setFlightPlan(fp);
      setNotification(t("map.revalidateSuccess"));
    } catch {
      setNotification(t("map.revalidateFailed"));
    } finally {
      setRevalidating(false);
    }
  }

  const violations: ValidationViolation[] = flightPlan.validation_result?.violations ?? [];

  return (
    <div>
      <button type="button" onClick={handleClick} data-testid="validate-trajectory-btn" disabled={revalidating}>
        {revalidating ? t("map.revalidating") : t("map.validateTrajectory")}
      </button>
      <MapWarningsPanel violations={violations} />
      {notification && <div data-testid="notification-toast">{notification}</div>}
    </div>
  );
}

describe("validate trajectory button", () => {
  /** integration check: button click -> revalidateFlightPlan -> success toast + panel re-renders. */

  const baseFlightPlan: FlightPlanResponse = {
    id: "fp-1",
    mission_id: "m-1",
    airport_id: "apt-1",
    total_distance: 1000,
    estimated_duration: 300,
    is_validated: true,
    generated_at: "2026-04-01T00:00:00Z",
    waypoints: [],
    validation_result: null,
  } as unknown as FlightPlanResponse;

  it("calls the API, shows the success toast, and re-renders violations from the response", async () => {
    const refreshed: FlightPlanResponse = {
      ...baseFlightPlan,
      is_validated: false,
      validation_result: {
        id: "vr-1",
        passed: false,
        violations: [
          {
            id: "v-1",
            category: "violation",
            message: "obstacle blocks waypoint",
            severity: "violation",
            is_warning: false,
            constraint_id: null,
            constraint_name: null,
            violation_kind: "obstacle",
            waypoint_ref: null,
            waypoint_ids: ["wp-1"],
          },
        ],
      },
    } as unknown as FlightPlanResponse;

    vi.mocked(client.post).mockResolvedValueOnce({ data: refreshed });

    render(<ValidateButtonSubtree missionId="mission-xyz" initialFlightPlan={baseFlightPlan} />);

    // panel hidden initially because validation_result is null
    expect(screen.queryByTestId("map-warnings-panel")).toBeNull();

    fireEvent.click(screen.getByTestId("validate-trajectory-btn"));

    expect(client.post).toHaveBeenCalledWith("/missions/mission-xyz/revalidate");

    await waitFor(() => {
      expect(screen.getByTestId("notification-toast")).toHaveTextContent(
        "map.revalidateSuccess",
      );
    });
    expect(screen.getByTestId("map-warnings-panel")).toBeInTheDocument();
    expect(screen.getByText("obstacle blocks waypoint")).toBeInTheDocument();
  });
});

describe("revalidateFlightPlan api", () => {
  /** tests for the /revalidate endpoint client wrapper. */

  it("posts to /missions/{id}/revalidate", async () => {
    /** verify the api function targets the right endpoint. */
    vi.mocked(client.post).mockResolvedValueOnce({ data: { id: "fp-1" } });
    const result = await revalidateFlightPlan("mission-123");
    expect(client.post).toHaveBeenCalledWith("/missions/mission-123/revalidate");
    expect(result).toEqual({ id: "fp-1" });
  });

  it("propagates server errors", async () => {
    /** verify rejected promises bubble to the caller. */
    vi.mocked(client.post).mockRejectedValueOnce(new Error("409 conflict"));
    await waitFor(async () => {
      await expect(revalidateFlightPlan("mission-456")).rejects.toThrow(
        "409 conflict",
      );
    });
  });
});

// drag-end ground resolve - mirrors MissionMapPage's handleSave (in-flight-plan
// TAKEOFF/LANDING waypoints) and handleWaypointDrag (standalone takeoff/landing
// markers). The page itself is too heavy to render in CI (see comment near the
// top), so the same logic is replayed here against the real api wrappers with
// a stubbed elevation resolver - we want to verify the outgoing payload's z is
// the mocked ground value, not the verbatim drag alt.
type ElevationResolver = (lat: number, lon: number) => Promise<number | null>;

function BatchUpdateSaveSubtree({
  missionId,
  waypoints,
  dirtyWaypoints,
  resolveElevation,
}: {
  missionId: string;
  waypoints: WaypointResponse[];
  dirtyWaypoints: Record<string, { position: PointZ; camera_target?: PointZ | null }>;
  resolveElevation: ElevationResolver | undefined;
}) {
  async function handleSave() {
    const wpTypeById = new Map<string, string>();
    for (const wp of waypoints) wpTypeById.set(wp.id, wp.waypoint_type);
    const resolved: WaypointPositionUpdate[] = await Promise.all(
      Object.entries(dirtyWaypoints).map(async ([waypointId, data]) => {
        const wpType = wpTypeById.get(waypointId);
        let position = data.position;
        if (
          resolveElevation &&
          (wpType === "TAKEOFF" || wpType === "LANDING") &&
          position.coordinates.length >= 2
        ) {
          const [lon, lat] = position.coordinates;
          const ground = await resolveElevation(lat, lon);
          if (ground !== null && ground !== undefined) {
            position = { ...position, coordinates: [lon, lat, ground] };
          }
        }
        return {
          waypoint_id: waypointId,
          position,
          ...(data.camera_target !== undefined
            ? { camera_target: data.camera_target }
            : {}),
        };
      }),
    );
    await batchUpdateWaypoints(missionId, resolved);
  }
  return (
    <button type="button" data-testid="save-btn" onClick={handleSave}>
      save
    </button>
  );
}

function StandaloneTakeoffDragSubtree({
  missionId,
  resolveElevation,
  dragTo,
  useTakeoffAsLanding = false,
}: {
  missionId: string;
  resolveElevation: ElevationResolver | undefined;
  dragTo: [number, number, number];
  useTakeoffAsLanding?: boolean;
}) {
  async function handleDrag() {
    let resolvedPos: [number, number, number] = [...dragTo] as [number, number, number];
    if (resolveElevation) {
      const ground = await resolveElevation(resolvedPos[1], resolvedPos[0]);
      if (ground !== null && ground !== undefined) {
        resolvedPos = [resolvedPos[0], resolvedPos[1], ground];
      }
    }
    const newCoord: PointZ = { type: "Point", coordinates: resolvedPos };
    const updates: Record<string, PointZ> = { takeoff_coordinate: newCoord };
    if (useTakeoffAsLanding) {
      updates.landing_coordinate = {
        type: "Point",
        coordinates: [...resolvedPos] as [number, number, number],
      };
    }
    await updateMission(missionId, updates);
  }
  return (
    <button type="button" data-testid="drag-btn" onClick={handleDrag}>
      drag
    </button>
  );
}

describe("drag-end ground resolve", () => {
  /** integration: TAKEOFF/LANDING drags resolve ground via the elevation
   * resolver before the api call so the outgoing payload's z is the mocked
   * ground value, not the verbatim drag alt. */

  beforeEach(() => {
    // shared client.put mock leaks state across tests in this file; reset so
    // each case asserts against its own first call.
    vi.mocked(client.put).mockReset();
  });

  function makeWaypoint(
    id: string,
    type: "TAKEOFF" | "LANDING" | "MEASUREMENT" | "TRANSIT",
    coords: [number, number, number],
  ): WaypointResponse {
    return {
      id,
      flight_plan_id: "fp-1",
      inspection_id: null,
      sequence_order: 1,
      position: { type: "Point", coordinates: coords },
      heading: null,
      speed: null,
      hover_duration: null,
      camera_action: null,
      waypoint_type: type,
      camera_target: null,
      gimbal_pitch: null,
    };
  }

  it("snaps TAKEOFF/LANDING waypoint alts to the resolved ground before batchUpdateWaypoints", async () => {
    /** verify handleSave replaces the drag alt with the stubbed elevation. */
    const resolveElevation = vi
      .fn<ElevationResolver>()
      .mockResolvedValueOnce(212) // takeoff ground
      .mockResolvedValueOnce(207); // landing ground

    vi.mocked(client.put).mockResolvedValueOnce({ data: { id: "fp-1" } });

    const waypoints = [
      makeWaypoint("wp-takeoff", "TAKEOFF", [17.21, 48.17, 0]),
      makeWaypoint("wp-landing", "LANDING", [17.22, 48.18, 0]),
      makeWaypoint("wp-measurement", "MEASUREMENT", [17.23, 48.19, 60]),
    ];
    // dragged alts (999 / 888) should be discarded; resolver wins for T/L.
    // the measurement waypoint's drag alt must pass through untouched.
    const dirtyWaypoints = {
      "wp-takeoff": {
        position: { type: "Point" as const, coordinates: [17.215, 48.175, 999] as [number, number, number] },
      },
      "wp-landing": {
        position: { type: "Point" as const, coordinates: [17.225, 48.185, 888] as [number, number, number] },
      },
      "wp-measurement": {
        position: { type: "Point" as const, coordinates: [17.235, 48.195, 60] as [number, number, number] },
      },
    };

    render(
      <BatchUpdateSaveSubtree
        missionId="mission-xyz"
        waypoints={waypoints}
        dirtyWaypoints={dirtyWaypoints}
        resolveElevation={resolveElevation}
      />,
    );

    fireEvent.click(screen.getByTestId("save-btn"));

    await waitFor(() => {
      expect(client.put).toHaveBeenCalledWith(
        "/missions/mission-xyz/flight-plan/waypoints",
        expect.anything(),
      );
    });

    // resolver was called once for each T/L waypoint, with lat/lon (not lon/lat)
    expect(resolveElevation).toHaveBeenCalledTimes(2);
    expect(resolveElevation).toHaveBeenNthCalledWith(1, 48.175, 17.215);
    expect(resolveElevation).toHaveBeenNthCalledWith(2, 48.185, 17.225);

    const body = vi.mocked(client.put).mock.calls[0][1] as {
      updates: WaypointPositionUpdate[];
    };
    const byId = Object.fromEntries(
      body.updates.map((u) => [u.waypoint_id, u]),
    );
    // T/L alts replaced by the resolved ground value
    expect(byId["wp-takeoff"].position.coordinates).toEqual([17.215, 48.175, 212]);
    expect(byId["wp-landing"].position.coordinates).toEqual([17.225, 48.185, 207]);
    // non-T/L alt left untouched
    expect(byId["wp-measurement"].position.coordinates).toEqual([17.235, 48.195, 60]);
  });

  it("uses the verbatim drag alt when the elevation resolver returns null", async () => {
    /** verify a null resolver result falls through to the dragged alt. */
    const resolveElevation = vi
      .fn<ElevationResolver>()
      .mockResolvedValueOnce(null);
    vi.mocked(client.put).mockResolvedValueOnce({ data: { id: "fp-1" } });

    const waypoints = [makeWaypoint("wp-takeoff", "TAKEOFF", [17.21, 48.17, 0])];
    const dirtyWaypoints = {
      "wp-takeoff": {
        position: { type: "Point" as const, coordinates: [17.215, 48.175, 145] as [number, number, number] },
      },
    };

    render(
      <BatchUpdateSaveSubtree
        missionId="mission-xyz"
        waypoints={waypoints}
        dirtyWaypoints={dirtyWaypoints}
        resolveElevation={resolveElevation}
      />,
    );

    fireEvent.click(screen.getByTestId("save-btn"));

    await waitFor(() => {
      expect(client.put).toHaveBeenCalled();
    });
    const body = vi.mocked(client.put).mock.calls[0][1] as {
      updates: WaypointPositionUpdate[];
    };
    expect(body.updates[0].position.coordinates).toEqual([17.215, 48.175, 145]);
  });

  it("standalone takeoff drag sends the resolved ground alt to updateMission", async () => {
    /** verify handleWaypointDrag for the standalone TAKEOFF marker pulls the
     * stubbed ground value into the PUT /missions/{id} payload. */
    const resolveElevation = vi
      .fn<ElevationResolver>()
      .mockResolvedValueOnce(198);
    vi.mocked(client.put).mockResolvedValueOnce({ data: { id: "m-1" } });

    render(
      <StandaloneTakeoffDragSubtree
        missionId="mission-xyz"
        resolveElevation={resolveElevation}
        dragTo={[17.215, 48.175, 777]}
      />,
    );

    fireEvent.click(screen.getByTestId("drag-btn"));

    await waitFor(() => {
      expect(client.put).toHaveBeenCalledWith(
        "/missions/mission-xyz",
        expect.anything(),
      );
    });
    expect(resolveElevation).toHaveBeenCalledWith(48.175, 17.215);

    const body = vi.mocked(client.put).mock.calls[0][1] as {
      takeoff_coordinate?: PointZ;
      landing_coordinate?: PointZ;
    };
    expect(body.takeoff_coordinate?.coordinates).toEqual([17.215, 48.175, 198]);
    // mirror landing only when useTakeoffAsLanding is on
    expect(body.landing_coordinate).toBeUndefined();
  });

  it("mirrors the resolved takeoff alt to landing for round-trip missions", async () => {
    /** verify the useTakeoffAsLanding mirror also picks up the resolved alt. */
    const resolveElevation = vi
      .fn<ElevationResolver>()
      .mockResolvedValueOnce(225);
    vi.mocked(client.put).mockResolvedValueOnce({ data: { id: "m-1" } });

    render(
      <StandaloneTakeoffDragSubtree
        missionId="mission-xyz"
        resolveElevation={resolveElevation}
        dragTo={[17.215, 48.175, 12]}
        useTakeoffAsLanding={true}
      />,
    );

    fireEvent.click(screen.getByTestId("drag-btn"));

    await waitFor(() => expect(client.put).toHaveBeenCalled());
    const body = vi.mocked(client.put).mock.calls[0][1] as {
      takeoff_coordinate?: PointZ;
      landing_coordinate?: PointZ;
    };
    expect(body.takeoff_coordinate?.coordinates).toEqual([17.215, 48.175, 225]);
    expect(body.landing_coordinate?.coordinates).toEqual([17.215, 48.175, 225]);
  });
});
