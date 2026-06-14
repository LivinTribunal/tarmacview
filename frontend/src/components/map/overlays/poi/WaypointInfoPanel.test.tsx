import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { MapFeatureWaypoint } from "@/types/map";
import WaypointInfoPanel from "./WaypointInfoPanel";

function makeWaypoint(
  overrides: Partial<MapFeatureWaypoint["data"]> = {},
): MapFeatureWaypoint["data"] {
  /** build a minimal single-waypoint fixture. */
  return {
    id: "wp-1",
    waypoint_type: "MEASUREMENT",
    sequence_order: 4,
    position: { type: "Point", coordinates: [14.5, 50.1, 123.4] },
    stack_count: 1,
    ...overrides,
  };
}

describe("WaypointInfoPanel - stacked variant", () => {
  it("renders the seq-min/seq-max/(count) row and altitude range inside the coords block", () => {
    const waypoint = makeWaypoint({
      stack_count: 4,
      seq_min: 7,
      seq_max: 10,
      alt_min: 100,
      alt_max: 140,
      gimbal_pitch_min: -45,
      gimbal_pitch_max: -10,
    });
    render(<WaypointInfoPanel waypoint={waypoint} editable={false} />);

    // count row shows "min-max (count)"
    expect(screen.getByText("7-10 (4)")).toBeInTheDocument();

    // alt range rides inside the alt row of the coordinates block (no
    // standalone altitude row any more)
    expect(screen.queryByText("dashboard.poiAltitude")).not.toBeInTheDocument();
    const altRow = screen.getByText("map.coordinates.alt").closest("div")!;
    expect(altRow).toHaveTextContent("100.00 → 140.00");

    // gimbal pitch widens to a range
    const gimbalRow = screen.getByText("mission.config.gimbalPitch").closest("div")!;
    expect(gimbalRow).toHaveTextContent("-45.0° → -10.0°");
  });

  it("omits type, camera action, and hover duration rows in the stacked variant", () => {
    render(
      <WaypointInfoPanel
        waypoint={makeWaypoint({
          stack_count: 3,
          seq_min: 1,
          seq_max: 3,
          alt_min: 10,
          alt_max: 30,
          camera_action: "RECORDING_START",
          hover_duration: 5,
        })}
        editable={false}
      />,
    );
    expect(screen.queryByText("mission.config.type")).not.toBeInTheDocument();
    expect(screen.queryByText("mission.config.cameraAction")).not.toBeInTheDocument();
    expect(screen.queryByText("map.dwell")).not.toBeInTheDocument();
  });
});

describe("WaypointInfoPanel - single variant, read-only", () => {
  it("renders read-only CoordRows when not editable", () => {
    render(<WaypointInfoPanel waypoint={makeWaypoint()} editable={false} />);
    // sequence row appears in the single-variant branch
    expect(screen.getByText("mission.config.sequence")).toBeInTheDocument();
    // no inline input in the read-only branch
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("WaypointInfoPanel - single variant, editable", () => {
  it("commits an edit on Enter via onCoordinateChange", () => {
    const onCoordinateChange = vi.fn();
    render(
      <WaypointInfoPanel
        waypoint={makeWaypoint()}
        editable
        onCoordinateChange={onCoordinateChange}
      />,
    );

    const latRow = screen.getByText("map.coordinates.lat").closest("div")!;
    // start editing via the lat display button
    fireEvent.click(within(latRow).getByRole("button"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "51.5" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCoordinateChange).toHaveBeenCalledWith("wp-1", 51.5, 14.5, 123.4);
  });
});

describe("WaypointInfoPanel - delete branch", () => {
  it("renders the delete button only for TAKEOFF/LANDING and confirms before deleting", () => {
    const onDeleteTakeoffLanding = vi.fn();
    const { rerender } = render(
      <WaypointInfoPanel
        waypoint={makeWaypoint({ waypoint_type: "TAKEOFF" })}
        editable
        onDeleteTakeoffLanding={onDeleteTakeoffLanding}
      />,
    );
    const deleteBtn = screen.getByTestId("delete-waypoint-btn");
    fireEvent.click(deleteBtn);
    // after first click the confirm step appears with a delete button
    fireEvent.click(screen.getByText("common.delete"));
    expect(onDeleteTakeoffLanding).toHaveBeenCalledWith("TAKEOFF");

    // MEASUREMENT waypoints have no delete button at all
    rerender(
      <WaypointInfoPanel
        waypoint={makeWaypoint({ waypoint_type: "MEASUREMENT" })}
        editable
        onDeleteTakeoffLanding={onDeleteTakeoffLanding}
      />,
    );
    expect(screen.queryByTestId("delete-waypoint-btn")).not.toBeInTheDocument();
  });
});

describe("WaypointInfoPanel - bookend type label", () => {
  it("appends the recording start/stop label to the type row for bookend MEASUREMENTs", () => {
    // after #754 the recording dwell rides on a MEASUREMENT; without this
    // suffix the row reads as a plain measurement and the dwell value looks
    // unmotivated.
    render(
      <WaypointInfoPanel
        waypoint={makeWaypoint({
          camera_action: "RECORDING_START",
          hover_duration: 5,
        })}
        editable={false}
      />,
    );
    const typeRow = screen.getByText("mission.config.type").closest("div")!;
    expect(typeRow).toHaveTextContent("map.cameraActionLabel.RECORDING_START");
  });

  it("leaves the type row untouched for plain measurements", () => {
    render(
      <WaypointInfoPanel waypoint={makeWaypoint()} editable={false} />,
    );
    const typeRow = screen.getByText("mission.config.type").closest("div")!;
    expect(typeRow).not.toHaveTextContent("map.cameraActionLabel");
  });
});

describe("WaypointInfoPanel - dwell row", () => {
  it("renders a Dwell row when hover_duration is non-null on a single waypoint", () => {
    render(
      <WaypointInfoPanel
        waypoint={makeWaypoint({ hover_duration: 3, camera_action: "RECORDING_START" })}
        editable={false}
      />,
    );
    const dwellRow = screen.getByText("map.dwell").closest("div")!;
    expect(dwellRow).toHaveTextContent("3");
    expect(dwellRow).toHaveTextContent("common.units.s");
  });

  it("omits the Dwell row when hover_duration is null", () => {
    render(<WaypointInfoPanel waypoint={makeWaypoint({ hover_duration: null })} editable={false} />);
    expect(screen.queryByText("map.dwell")).not.toBeInTheDocument();
  });

});

describe("WaypointInfoPanel - alt row MSL/AGL split", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  it("renders MSL and AGL as two independently-copyable segments when agl is set", () => {
    render(
      <WaypointInfoPanel
        waypoint={makeWaypoint({ agl: 12.5 })}
        editable={false}
      />,
    );
    const altRow = screen.getByText("map.coordinates.alt").closest("div")!;
    const [mslCopy, aglCopy] = within(altRow).getAllByTestId("copyable-value");
    expect(mslCopy).toHaveTextContent("mission.config.altMsl");
    expect(aglCopy).toHaveTextContent("mission.config.altAgl");
    fireEvent.click(mslCopy);
    expect(writeText).toHaveBeenLastCalledWith("123.40");
    fireEvent.click(aglCopy);
    expect(writeText).toHaveBeenLastCalledWith("12.50");
  });
});
