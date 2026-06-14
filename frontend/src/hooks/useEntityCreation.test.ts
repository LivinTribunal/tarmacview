import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { AirportDetailResponse } from "@/types/airport";
import useEntityCreation from "./useEntityCreation";

vi.mock("@/api/airports", () => ({
  createSurface: vi.fn().mockResolvedValue({}),
  createObstacle: vi.fn().mockResolvedValue({}),
  createSafetyZone: vi.fn().mockResolvedValue({}),
  createAGL: vi.fn().mockResolvedValue({}),
  createLHA: vi.fn().mockResolvedValue({}),
  fetchElevationAt: vi.fn().mockResolvedValue({ elevation: 0, source: "FLAT" }),
}));

const airport = { id: "apt-1", elevation: 100, surfaces: [] } as unknown as AirportDetailResponse;

function setup() {
  /** render useEntityCreation with stub collaborators. */
  const setActiveTool = vi.fn();
  const setSelectedFeature = vi.fn();
  const fetchAirport = vi.fn().mockResolvedValue(airport);
  const view = renderHook(() =>
    useEntityCreation({
      id: "apt-1",
      airport,
      elevationResolver: undefined,
      fetchAirport,
      setActiveTool,
      setSelectedFeature,
    }),
  );
  return { view, setActiveTool, setSelectedFeature };
}

const rectangle: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [[[0, 0], [0, 0.001], [0.002, 0.001], [0.002, 0], [0, 0]]],
};

describe("useEntityCreation drawing-complete handlers", () => {
  it("handlePolygonComplete sets polygon type and clears siblings", () => {
    const { view, setActiveTool } = setup();
    act(() => view.result.current.handleCircleComplete({ polygon: rectangle, radius: 5, center: [1, 1] }));
    act(() => view.result.current.handlePolygonComplete(rectangle));
    expect(view.result.current.pendingGeometry).toBe(rectangle);
    expect(view.result.current.pendingGeometryType).toBe("polygon");
    expect(view.result.current.pendingCircleRadius).toBeUndefined();
    expect(view.result.current.pendingCircleCenter).toBeUndefined();
    expect(view.result.current.pendingPointPosition).toBeUndefined();
    expect(setActiveTool).toHaveBeenLastCalledWith("select");
  });

  it("handleCircleComplete keeps radius + center and sets circle type", () => {
    const { view } = setup();
    act(() => view.result.current.handleCircleComplete({ polygon: rectangle, radius: 7, center: [2, 3] }));
    expect(view.result.current.pendingGeometryType).toBe("circle");
    expect(view.result.current.pendingCircleRadius).toBe(7);
    expect(view.result.current.pendingCircleCenter).toEqual([2, 3]);
    expect(view.result.current.pendingPointPosition).toBeUndefined();
  });

  it("handleRectangleComplete behaves like polygon", () => {
    const { view } = setup();
    act(() => view.result.current.handleRectangleComplete(rectangle));
    expect(view.result.current.pendingGeometry).toBe(rectangle);
    expect(view.result.current.pendingGeometryType).toBe("polygon");
  });

  it("handlePointComplete sets point position and clears geometry", () => {
    const { view } = setup();
    act(() => view.result.current.handlePolygonComplete(rectangle));
    act(() => view.result.current.handlePointComplete([5, 6]));
    expect(view.result.current.pendingGeometry).toBeNull();
    expect(view.result.current.pendingGeometryType).toBe("point");
    expect(view.result.current.pendingPointPosition).toEqual([5, 6]);
    expect(view.result.current.pendingCircleRadius).toBeUndefined();
  });
});

describe("useEntityCreation clearPending vs handleCreationCancel", () => {
  it("clearPending resets geometry but keeps the boundary override", () => {
    const { view } = setup();
    act(() => {
      view.result.current.handlePolygonComplete(rectangle);
      view.result.current.setBoundaryEntityOverride("safety_zone_airport_boundary");
    });
    act(() => view.result.current.clearPending());
    expect(view.result.current.pendingGeometry).toBeNull();
    expect(view.result.current.pendingPointPosition).toBeUndefined();
    expect(view.result.current.boundaryEntityOverride).toBe("safety_zone_airport_boundary");
  });

  it("handleCreationCancel resets geometry and the boundary override", () => {
    const { view } = setup();
    act(() => {
      view.result.current.handlePolygonComplete(rectangle);
      view.result.current.setBoundaryEntityOverride("safety_zone_airport_boundary");
    });
    act(() => view.result.current.handleCreationCancel());
    expect(view.result.current.pendingGeometry).toBeNull();
    expect(view.result.current.boundaryEntityOverride).toBeNull();
  });
});

describe("useEntityCreation handleAddLha", () => {
  it("clears the selection and switches to the place-point tool", () => {
    const { view, setActiveTool, setSelectedFeature } = setup();
    act(() => view.result.current.handleAddLha("agl-9"));
    expect(setSelectedFeature).toHaveBeenCalledWith(null);
    expect(setActiveTool).toHaveBeenCalledWith("placePoint");
  });
});

describe("useEntityCreation prefilledGeometry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is empty when there is no pending geometry", () => {
    const { view } = setup();
    expect(view.result.current.prefilledGeometry).toEqual({});
  });

  it("derives width/length/heading/area for a rectangle", () => {
    const { view } = setup();
    act(() => view.result.current.handleRectangleComplete(rectangle));
    const pf = view.result.current.prefilledGeometry;
    expect(typeof pf.width).toBe("number");
    expect(typeof pf.length).toBe("number");
    expect(typeof pf.heading).toBe("number");
    expect(pf.area).toBeGreaterThan(0);
  });

  it("uses pi*r^2 for circle area", () => {
    const { view } = setup();
    act(() => view.result.current.handleCircleComplete({ polygon: rectangle, radius: 10, center: [0, 0] }));
    expect(view.result.current.prefilledGeometry.area).toBeCloseTo(Math.PI * 100, 6);
  });
});

describe("useEntityCreation beginExtractorHandoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("polygon handoff seeds polygon geometry + entity override, no lens", () => {
    const { view } = setup();
    act(() =>
      view.result.current.beginExtractorHandoff({
        kind: "polygon",
        polygon: rectangle,
        entityType: "obstacle",
      }),
    );
    expect(view.result.current.pendingGeometry).toBe(rectangle);
    expect(view.result.current.pendingGeometryType).toBe("polygon");
    expect(view.result.current.boundaryEntityOverride).toBe("obstacle");
    expect(view.result.current.prefilledLensHeights).toBeNull();
  });

  it("point handoff seeds a single point, entity override, and lens prefill", () => {
    const { view, setSelectedFeature } = setup();
    act(() =>
      view.result.current.beginExtractorHandoff({
        kind: "point",
        position: [9, 8],
        entityType: "lha",
        lens: { msl: 380, agl: 12 },
      }),
    );
    expect(setSelectedFeature).toHaveBeenCalledWith(null);
    expect(view.result.current.pendingPointPosition).toEqual([9, 8]);
    expect(view.result.current.pendingGeometryType).toBe("point");
    expect(view.result.current.boundaryEntityOverride).toBe("lha");
    expect(view.result.current.prefilledLensHeights).toEqual({ msl: 380, agl: 12 });
  });

  it("points handoff consumes the first point and advances the queue on each create", async () => {
    // airport with a PAPI AGL so the lha create payload resolves
    const aglAirport = {
      id: "apt-1",
      elevation: 100,
      surfaces: [{ id: "surf-1", agls: [{ id: "agl-1" }] }],
    } as unknown as AirportDetailResponse;
    const setActiveTool = vi.fn();
    const fetchAirport = vi.fn().mockResolvedValue(aglAirport);
    const view = renderHook(() =>
      useEntityCreation({
        id: "apt-1",
        airport: aglAirport,
        elevationResolver: undefined,
        fetchAirport,
        setActiveTool,
        setSelectedFeature: vi.fn(),
      }),
    );

    act(() =>
      view.result.current.beginExtractorHandoff({
        kind: "points",
        positions: [[1, 1], [2, 2]],
        entityType: "lha",
        lensPerPoint: [{ msl: 10, agl: 1 }, { msl: 20, agl: 2 }],
      }),
    );
    // first point consumed immediately
    expect(view.result.current.pendingPointPosition).toEqual([1, 1]);
    expect(view.result.current.prefilledLensHeights).toEqual({ msl: 10, agl: 1 });
    expect(view.result.current.boundaryEntityOverride).toBe("lha");

    // creating the first lha advances to the queued second point
    await act(async () => {
      await view.result.current.handleCreate("lha", { agl_id: "agl-1" });
    });
    expect(view.result.current.pendingPointPosition).toEqual([2, 2]);
    expect(view.result.current.prefilledLensHeights).toEqual({ msl: 20, agl: 2 });
    // override is preserved so the next point lands the same entity type
    expect(view.result.current.boundaryEntityOverride).toBe("lha");
    expect(setActiveTool).toHaveBeenLastCalledWith("select");

    // creating the last lha drains the queue and resets the handoff
    await act(async () => {
      await view.result.current.handleCreate("lha", { agl_id: "agl-1" });
    });
    expect(view.result.current.pendingPointPosition).toBeUndefined();
    expect(view.result.current.boundaryEntityOverride).toBeNull();
    expect(view.result.current.prefilledLensHeights).toBeNull();
  });
});

describe("useEntityCreation centerlineEndpoints", () => {
  it("is undefined when there is no pending geometry", () => {
    const { view } = setup();
    expect(view.result.current.centerlineEndpoints).toBeUndefined();
  });

  it("exposes the (start, end) of the derived centerline for a polygon", () => {
    const { view } = setup();
    act(() => view.result.current.handleRectangleComplete(rectangle));
    const ep = view.result.current.centerlineEndpoints;
    expect(ep).toBeDefined();
    if (!ep) return;
    expect(ep).toHaveLength(2);
    expect(ep[0]).toHaveLength(2);
    expect(ep[1]).toHaveLength(2);
    expect(ep[0]).not.toEqual(ep[1]);
  });
});
