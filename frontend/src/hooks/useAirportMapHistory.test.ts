import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type maplibregl from "maplibre-gl";
import type { AirportDetailResponse } from "@/types/airport";
import type { VertexGeometryUpdate } from "@/hooks/useVertexEditor";
import useAirportMapHistory from "./useAirportMapHistory";

// capture the onGeometryUpdate callback the hook hands to useVertexEditor
let capturedOnUpdate:
  | ((ft: string, fid: string, u: VertexGeometryUpdate) => void)
  | undefined;
vi.mock("@/hooks/useVertexEditor", () => ({
  default: (
    _m: unknown,
    _f: unknown,
    _a: boolean,
    onUpdate: (ft: string, fid: string, u: VertexGeometryUpdate) => void,
  ) => {
    capturedOnUpdate = onUpdate;
    return { isEditing: false };
  },
}));

const syncEntityGeometryToMap = vi.fn();
const updateSourceFeatureGeometry = vi.fn();
vi.mock("@/pages/coordinator-center/syncEntityGeometryToMap", () => ({
  syncEntityGeometryToMap: (...args: unknown[]) => syncEntityGeometryToMap(...args),
  updateSourceFeatureGeometry: (...args: unknown[]) =>
    updateSourceFeatureGeometry(...args),
}));

vi.mock("@/components/map/layers/safetyZoneLayers", () => ({
  AIRPORT_BOUNDARY_SOURCE: "airport-boundary",
}));

const setData = vi.fn();
const fakeMap = {
  getSource: vi.fn().mockReturnValue({ setData }),
} as unknown as maplibregl.Map;
const getMap = vi.fn().mockReturnValue(fakeMap);

const airport = {
  safety_zones: [
    { id: "zb", type: "AIRPORT_BOUNDARY", name: "Boundary" },
    { id: "zr", type: "RESTRICTED", name: "Restricted" },
  ],
  surfaces: [
    { id: "rwy", surface_type: "RUNWAY" },
    { id: "twy", surface_type: "TAXIWAY" },
  ],
} as unknown as AirportDetailResponse;

function setup() {
  /** mount the hook with a fake map and a two-zone / two-surface airport. */
  return renderHook(() =>
    useAirportMapHistory({
      id: "apt-1",
      airport,
      selectedFeature: null,
      vertexEditActive: true,
      map: fakeMap,
      getMap,
    }),
  );
}

const LINE: GeoJSON.Geometry = {
  type: "LineString",
  coordinates: [
    [0, 0],
    [1, 1],
  ],
};
const POLY: GeoJSON.Geometry = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0, 10],
      [2, 0, 20],
      [2, 2, 30],
      [0, 0, 10],
    ],
  ],
};

describe("useAirportMapHistory vertex update payload shapes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnUpdate = undefined;
  });

  it("marks dirty with geometry only when no boundary on the update", () => {
    const { result } = setup();
    act(() => capturedOnUpdate!("surface", "rwy", { geometry: LINE }));
    const pending = result.current.getPendingChanges();
    expect(pending).toHaveLength(1);
    expect(pending[0].data).toEqual({ geometry: LINE });
  });

  it("includes boundary in the dirty payload when present", () => {
    const { result } = setup();
    act(() =>
      capturedOnUpdate!("surface", "rwy", { geometry: LINE, boundary: POLY }),
    );
    expect(result.current.getPendingChanges()[0].data).toEqual({
      geometry: LINE,
      boundary: POLY,
    });
  });
});

describe("useAirportMapHistory source-id branching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnUpdate = undefined;
  });

  it("airport-boundary zone updates the boundary source via setData, not updateSource", () => {
    setup();
    act(() => capturedOnUpdate!("safety_zone", "zb", { geometry: POLY }));
    expect(fakeMap.getSource).toHaveBeenCalledWith("airport-boundary");
    expect(setData).toHaveBeenCalledTimes(1);
    const fc = setData.mock.calls[0][0] as GeoJSON.FeatureCollection;
    expect(fc.features[0].properties?.entityType).toBe("airport_boundary");
    expect(updateSourceFeatureGeometry).not.toHaveBeenCalled();
  });

  it("regular safety zone uses the safety-zones source", () => {
    setup();
    act(() => capturedOnUpdate!("safety_zone", "zr", { geometry: POLY }));
    expect(updateSourceFeatureGeometry).toHaveBeenCalledWith(
      fakeMap,
      "safety-zones",
      "zr",
      POLY,
    );
  });

  it("obstacle update writes boundary then a recomputed centroid point", () => {
    setup();
    act(() => capturedOnUpdate!("obstacle", "o1", { geometry: POLY, boundary: POLY }));
    expect(updateSourceFeatureGeometry).toHaveBeenCalledWith(
      fakeMap,
      "obstacles-boundary",
      "o1",
      POLY,
    );
    const ring = (POLY as GeoJSON.Polygon).coordinates[0];
    const cx = ring.reduce((s, c) => s + c[0], 0) / ring.length;
    const cy = ring.reduce((s, c) => s + c[1], 0) / ring.length;
    const cz = ring.reduce((s, c) => s + (c[2] ?? 0), 0) / ring.length;
    expect(updateSourceFeatureGeometry).toHaveBeenCalledWith(fakeMap, "obstacles", "o1", {
      type: "Point",
      coordinates: [cx, cy, cz],
    });
  });

  it("runway surface uses runways-polygon + runways centerline sources", () => {
    setup();
    act(() => capturedOnUpdate!("surface", "rwy", { geometry: LINE, boundary: POLY }));
    expect(updateSourceFeatureGeometry).toHaveBeenCalledWith(
      fakeMap,
      "runways-polygon",
      "rwy",
      POLY,
    );
    expect(updateSourceFeatureGeometry).toHaveBeenCalledWith(
      fakeMap,
      "runways",
      "rwy",
      LINE,
    );
  });

  it("taxiway surface uses taxiways-polygon + taxiways centerline sources", () => {
    setup();
    act(() => capturedOnUpdate!("surface", "twy", { geometry: LINE, boundary: POLY }));
    expect(updateSourceFeatureGeometry).toHaveBeenCalledWith(
      fakeMap,
      "taxiways-polygon",
      "twy",
      POLY,
    );
    expect(updateSourceFeatureGeometry).toHaveBeenCalledWith(
      fakeMap,
      "taxiways",
      "twy",
      LINE,
    );
  });
});

describe("useAirportMapHistory undo/redo geometry sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnUpdate = undefined;
  });

  it("undo syncs the rolled-back entity geometry to the map", () => {
    const { result } = setup();
    act(() => capturedOnUpdate!("surface", "rwy", { geometry: LINE }));
    act(() => result.current.handleUndo());
    expect(syncEntityGeometryToMap).toHaveBeenCalledTimes(1);
    const [m, apt, entityType, entityId, data] =
      syncEntityGeometryToMap.mock.calls[0];
    expect(m).toBe(fakeMap);
    expect(apt).toBe(airport);
    expect(entityType).toBe("surface");
    expect(entityId).toBe("rwy");
    // first edit rolled back -> no remaining pending data for the entity
    expect(data).toBeUndefined();
  });

  it("redo replays the entity geometry sync", () => {
    const { result } = setup();
    act(() => capturedOnUpdate!("surface", "rwy", { geometry: LINE }));
    act(() => result.current.handleUndo());
    syncEntityGeometryToMap.mockClear();
    act(() => result.current.handleRedo());
    expect(syncEntityGeometryToMap).toHaveBeenCalledTimes(1);
    expect(syncEntityGeometryToMap.mock.calls[0][4]).toEqual({ geometry: LINE });
  });
});

describe("useAirportMapHistory metadata handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnUpdate = undefined;
  });

  it("handleInfraPointDrag marks the point position dirty", () => {
    const { result } = setup();
    act(() => result.current.handleInfraPointDrag("agl", "a1", [1, 2, 3]));
    expect(result.current.getPendingChange("agl", "a1")?.data).toEqual({
      position: { type: "Point", coordinates: [1, 2, 3] },
    });
  });

  it("handleAirportUpdate marks the airport entity dirty under its id", () => {
    const { result } = setup();
    act(() => result.current.handleAirportUpdate({ name: "New" }));
    expect(result.current.getPendingChange("airport", "apt-1")?.data).toEqual({
      name: "New",
    });
  });
});
