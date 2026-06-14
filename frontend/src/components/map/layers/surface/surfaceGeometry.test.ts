import { describe, expect, it } from "vitest";
import type { SurfaceResponse } from "@/types/airport";
import {
  bufferLineString,
  dedupPairedRunways,
  pairedRunwayLabel,
} from "./surfaceGeometry";

function rwy(id: string, identifier: string, partnerId: string | null = null): SurfaceResponse {
  return {
    id,
    airport_id: "ap-1",
    identifier,
    surface_type: "RUNWAY",
    geometry: { type: "LineString", coordinates: [[0, 0, 0], [0.01, 0, 0]] },
    boundary: null,
    buffer_distance: 0,
    heading: null,
    length: null,
    width: null,
    threshold_position: null,
    end_position: null,
    touchpoint_latitude: null,
    touchpoint_longitude: null,
    touchpoint_altitude: null,
    paired_surface_id: partnerId,
    agls: [],
  };
}

describe("bufferLineString", () => {
  it("returns [] for a single-point or empty input", () => {
    expect(bufferLineString([[0, 0]], 30)).toEqual([]);
    expect(bufferLineString([], 30)).toEqual([]);
  });

  it("closes the polygon ring (first vertex repeated at the end)", () => {
    const ring = bufferLineString([[0, 0], [0.01, 0]], 60);
    expect(ring.length).toBeGreaterThan(2);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("handles coincident consecutive points without crashing", () => {
    const ring = bufferLineString([[0, 0], [0, 0], [0.01, 0]], 40);
    expect(ring.length).toBeGreaterThan(0);
  });
});

describe("dedupPairedRunways", () => {
  it("keeps the lower-id direction of each pair", () => {
    const a = rwy("a-id", "01", "b-id");
    const b = rwy("b-id", "19", "a-id");
    const out = dedupPairedRunways([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a-id");
  });

  it("passes through unpaired surfaces untouched", () => {
    const a = rwy("a-id", "01");
    const b: SurfaceResponse = { ...rwy("b-id", "09"), surface_type: "TAXIWAY" };
    const out = dedupPairedRunways([a, b]);
    expect(out).toHaveLength(2);
  });

  it("keeps a paired surface whose partner is missing from the input", () => {
    const a = rwy("a-id", "01", "missing");
    const out = dedupPairedRunways([a]);
    expect(out).toHaveLength(1);
  });
});

describe("pairedRunwayLabel", () => {
  it("returns the lone identifier when unpaired", () => {
    const a = rwy("a-id", "07");
    expect(pairedRunwayLabel(a, new Map([["a-id", a]]))).toBe("07");
  });

  it("joins both identifiers in ascending order when paired", () => {
    const a = rwy("a-id", "19", "b-id");
    const b = rwy("b-id", "01", "a-id");
    const byId = new Map([["a-id", a], ["b-id", b]]);
    expect(pairedRunwayLabel(a, byId)).toBe("01/19");
    expect(pairedRunwayLabel(b, byId)).toBe("01/19");
  });

  it("falls back to the surface's own identifier when partner missing", () => {
    const a = rwy("a-id", "01", "missing");
    expect(pairedRunwayLabel(a, new Map([["a-id", a]]))).toBe("01");
  });
});
