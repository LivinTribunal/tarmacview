import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import PoiInfoPanel from "./PoiInfoPanel";
import type { LHAResponse, ObstacleResponse } from "@/types/airport";
import type { MapFeature } from "@/types/map";

function makeLha(overrides: Partial<LHAResponse> = {}): LHAResponse {
  /** build a minimal LHA fixture for tests. */
  return {
    id: "lha-1",
    agl_id: "agl-1",
    unit_designator: "A",
    setting_angle: 3,
    transition_sector_width: null,
    lamp_type: "HALOGEN",
    position: { type: "Point", coordinates: [14.5, 50.1, 380] },
    tolerance: 0.2,
    sequence_number: 2,
    lens_height_msl_m: null,
    lens_height_agl_m: null,
    ...overrides,
  };
}

describe("PoiInfoPanel - LHA", () => {
  it("renders the sequence number row with #n prefix", () => {
    const feature: MapFeature = { type: "lha", data: makeLha({ sequence_number: 3 }) };
    render(<PoiInfoPanel feature={feature} onClose={vi.fn()} />);

    // setupTests stubs useTranslation so t(key) === key; assert on key + value
    expect(screen.getByText("featureFields.sequenceNumber")).toBeInTheDocument();
    expect(screen.getByText("#3")).toBeInTheDocument();
  });

  it("still renders the unit designator and lamp type alongside the sequence row", () => {
    const feature: MapFeature = {
      type: "lha",
      data: makeLha({ sequence_number: 1, unit_designator: "B", lamp_type: "LED" }),
    };
    render(<PoiInfoPanel feature={feature} onClose={vi.fn()} />);

    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("LED")).toBeInTheDocument();
  });

  it("renders both lens-height rows for a PAPI LHA that carries them", () => {
    const feature: MapFeature = {
      type: "lha",
      data: makeLha({ lens_height_agl_m: 4.2, lens_height_msl_m: 384.2 }),
    };
    render(<PoiInfoPanel feature={feature} onClose={vi.fn()} />);

    expect(screen.getByText("featureFields.lensHeightAgl")).toBeInTheDocument();
    expect(screen.getByText("featureFields.lensHeightMsl")).toBeInTheDocument();
    expect(screen.getByText("4.20common.units.m common.datum.agl")).toBeInTheDocument();
    expect(screen.getByText("384.20common.units.m common.datum.msl")).toBeInTheDocument();
  });

  it("hides both lens-height rows when the LHA has null lens heights", () => {
    const feature: MapFeature = { type: "lha", data: makeLha() };
    render(<PoiInfoPanel feature={feature} onClose={vi.fn()} />);

    expect(
      screen.queryByText("featureFields.lensHeightAgl"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("featureFields.lensHeightMsl"),
    ).not.toBeInTheDocument();
  });
});

describe("PoiInfoPanel - click-to-copy coordinates", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  it("copies raw lat/lon (9 dp) and alt (no units) from an LHA's CoordRows", () => {
    const feature: MapFeature = {
      type: "lha",
      data: makeLha({ position: { type: "Point", coordinates: [14.5, 50.1, 380] } }),
    };
    render(<PoiInfoPanel feature={feature} onClose={vi.fn()} />);

    const latRow = screen.getByText("map.coordinates.lat").closest("div")!;
    fireEvent.click(within(latRow).getByTestId("copyable-value"));
    expect(writeText).toHaveBeenCalledWith("50.100000000");

    const altRow = screen.getByText("map.coordinates.alt").closest("div")!;
    // unit is shown next to the value but excluded from the copied payload
    expect(altRow).toHaveTextContent("common.units.m");
    fireEvent.click(within(altRow).getByTestId("copyable-value"));
    expect(writeText).toHaveBeenCalledWith("380.00");
    // unit is nested inside CopyableValue, so the swap reads just "Copied" - not "Copiedm"
    expect(within(altRow).getByTestId("copyable-value")).toHaveTextContent(
      "common.copied",
    );
    expect(altRow).not.toHaveTextContent("common.copiedcommon.units.m");
  });

  it("copies the whole lat, lon, alt triplet from a polygon vertex row", () => {
    const obstacle: ObstacleResponse = {
      id: "o-1",
      airport_id: "a-1",
      name: "Hangar",
      height: 12,
      buffer_distance: 5,
      type: "BUILDING",
      boundary: {
        type: "Polygon",
        coordinates: [
          [
            [14.0, 50.0, 10],
            [14.2, 50.2, 12],
            [14.4, 50.0, 14],
            [14.0, 50.0, 10],
          ],
        ],
      },
    };
    render(
      <PoiInfoPanel feature={{ type: "obstacle", data: obstacle }} onClose={vi.fn()} />,
    );

    // centroid is copyable as a bare number
    const centroidLat = screen.getByText("map.coordinates.lat").closest("div")!;
    fireEvent.click(within(centroidLat).getByTestId("copyable-value"));
    expect(writeText).toHaveBeenCalledWith("50.066666667");

    // expand the vertex list, then copy the first vertex as a full triplet
    fireEvent.click(screen.getByText(/map\.vertices/));
    const vtxRow = screen.getByText("#1").closest("div")!;
    fireEvent.click(within(vtxRow).getByTestId("copyable-value"));
    expect(writeText).toHaveBeenCalledWith("50.000000000, 14.000000000, 10.00");
  });
});

describe("PoiInfoPanel - waypoint MSL/AGL", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  function waypointFeature(
    data: Partial<Extract<MapFeature, { type: "waypoint" }>["data"]> = {},
  ): MapFeature {
    return {
      type: "waypoint",
      data: {
        id: "wp-1",
        waypoint_type: "MEASUREMENT",
        sequence_order: 4,
        position: { type: "Point", coordinates: [14.5, 50.1, 123.4] },
        stack_count: 1,
        ...data,
      },
    };
  }

  it("shows MSL and AGL on the alt row when agl is present", () => {
    render(
      <PoiInfoPanel
        feature={waypointFeature({
          agl: 12.5,
          camera_target: { type: "Point", coordinates: [14.6, 50.2, 5] },
          camera_target_agl: 3.2,
        })}
        onClose={vi.fn()}
      />,
    );

    const altRow = screen.getAllByText("map.coordinates.alt")[0].closest("div")!;
    expect(altRow).toHaveTextContent("123.40");
    expect(altRow).toHaveTextContent("common.datum.msl");
    expect(altRow).toHaveTextContent("12.50");
    expect(altRow).toHaveTextContent("common.datum.agl");

    // camera-target alt row uses camera_target_agl
    const camAltRow = screen.getAllByText("map.coordinates.alt")[1].closest("div")!;
    expect(camAltRow).toHaveTextContent("3.20");
    expect(camAltRow).toHaveTextContent("common.datum.agl");

    // MSL and AGL are separate copy targets so the user knows which they copied
    const [mslCopy, aglCopy] = within(altRow).getAllByTestId("copyable-value");
    expect(mslCopy).toHaveTextContent("common.datum.msl");
    expect(aglCopy).toHaveTextContent("common.datum.agl");

    fireEvent.click(mslCopy);
    expect(writeText).toHaveBeenLastCalledWith("123.40");
    fireEvent.click(aglCopy);
    expect(writeText).toHaveBeenLastCalledWith("12.50");
  });

  it("shows the AGL suffix on the editable alt row too", () => {
    render(
      <PoiInfoPanel
        feature={waypointFeature({ waypoint_type: "TAKEOFF", agl: 30 })}
        onClose={vi.fn()}
        editable
        onCoordinateChange={vi.fn()}
      />,
    );

    const altRow = screen.getByText("map.coordinates.alt").closest("div")!;
    expect(altRow).toHaveTextContent("123.4");
    expect(altRow).toHaveTextContent("common.datum.msl");
    expect(altRow).toHaveTextContent("30.0");
    expect(altRow).toHaveTextContent("common.datum.agl");
    // the MSL value stays an edit button; AGL is static text
    expect(within(altRow).getByRole("button")).toHaveTextContent("123.4");
  });

  it("shows MSL only when agl is null", () => {
    render(
      <PoiInfoPanel feature={waypointFeature({ agl: null })} onClose={vi.fn()} />,
    );

    const altRow = screen.getByText("map.coordinates.alt").closest("div")!;
    expect(altRow).toHaveTextContent("123.40");
    expect(altRow).not.toHaveTextContent("common.datum.msl");
    expect(altRow).not.toHaveTextContent("common.datum.agl");
  });
});
