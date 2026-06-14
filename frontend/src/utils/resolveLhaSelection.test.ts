import { describe, expect, it } from "vitest";
import type { AGLResponse, LHAResponse, SurfaceResponse } from "@/types/airport";
import { resolveLhaSelection } from "./resolveLhaSelection";

function makeLha(seq: number, lon = 14.27, lat = 50.1): LHAResponse {
  return {
    id: `lha-${seq}`,
    agl_id: "agl-1",
    unit_designator: String(seq),
    setting_angle: null,
    transition_sector_width: null,
    lamp_type: "HALOGEN",
    position: { type: "Point", coordinates: [lon, lat, 0] },
    tolerance: null,
    sequence_number: seq,
    lens_height_msl_m: null,
    lens_height_agl_m: null,
  };
}

function makeAgl(lhas: LHAResponse[]): AGLResponse {
  return {
    id: "agl-1",
    surface_id: "surface-1",
    agl_type: "RUNWAY_EDGE_LIGHTS",
    name: "Test AGL",
    position: { type: "Point", coordinates: [14.27, 50.1, 0] },
    side: null,
    glide_slope_angle: null,
    distance_from_threshold: null,
    offset_from_centerline: null,
    lhas,
  };
}

function makeRunwaySurface(): SurfaceResponse {
  return {
    id: "surface-1",
    airport_id: "airport-1",
    identifier: "06/24",
    surface_type: "RUNWAY",
    geometry: {
      type: "LineString",
      coordinates: [
        [14.24, 50.1, 0],
        [14.27, 50.1, 0],
      ],
    },
    boundary: null,
    buffer_distance: 0,
    heading: 90,
    length: 3000,
    width: 45,
    threshold_position: { type: "Point", coordinates: [14.24, 50.1, 0] },
    end_position: { type: "Point", coordinates: [14.27, 50.1, 0] },
    touchpoint_latitude: null,
    touchpoint_longitude: null,
    touchpoint_altitude: null,
    paired_surface_id: null,
    agls: [],
  };
}

describe("resolveLhaSelection", () => {
  it("ALL picks every lha", () => {
    const lhas = [makeLha(1), makeLha(2), makeLha(3)];
    const out = resolveLhaSelection({ mode: "ALL" }, makeAgl(lhas), null);
    expect(out).toEqual(new Set(lhas.map((l) => l.id)));
  });

  it("CUSTOM returns null so the canonical selection is preserved", () => {
    const out = resolveLhaSelection(
      { mode: "CUSTOM" },
      makeAgl([makeLha(1)]),
      null,
    );
    expect(out).toBeNull();
  });

  it("RANGE [2,4] picks sequence 2/3/4", () => {
    const lhas = [1, 2, 3, 4, 5].map((seq) => makeLha(seq));
    const out = resolveLhaSelection(
      { mode: "RANGE", params: { from: 2, to: 4 } },
      makeAgl(lhas),
      null,
    );
    expect(out).toEqual(new Set(["lha-2", "lha-3", "lha-4"]));
  });

  it("RANGE empty from -> 1", () => {
    const lhas = [1, 2, 3].map((seq) => makeLha(seq));
    const out = resolveLhaSelection(
      { mode: "RANGE", params: { from: null, to: 2 } },
      makeAgl(lhas),
      null,
    );
    expect(out).toEqual(new Set(["lha-1", "lha-2"]));
  });

  it("RANGE empty to -> max", () => {
    const lhas = [1, 2, 3].map((seq) => makeLha(seq));
    const out = resolveLhaSelection(
      { mode: "RANGE", params: { from: 2, to: null } },
      makeAgl(lhas),
      null,
    );
    expect(out).toEqual(new Set(["lha-2", "lha-3"]));
  });

  it("RANGE rejects from > to", () => {
    const lhas = [1, 2, 3].map((seq) => makeLha(seq));
    const out = resolveLhaSelection(
      { mode: "RANGE", params: { from: 5, to: 2 } },
      makeAgl(lhas),
      null,
    );
    expect(out?.size ?? 0).toBe(0);
  });

  it("FROM_THRESHOLD START with 100m picks lhas near threshold", () => {
    const surface = makeRunwaySurface();
    const lhas = [
      makeLha(1, 14.2401), // ~7m past start
      makeLha(2, 14.2412), // ~86m past start
      makeLha(3, 14.2420), // ~143m - outside band
    ];
    const out = resolveLhaSelection(
      { mode: "FROM_THRESHOLD", params: { threshold: "START", distance_m: 100 } },
      makeAgl(lhas),
      surface,
    );
    expect(out).toEqual(new Set(["lha-1", "lha-2"]));
  });

  it("FROM_THRESHOLD END mirrors anchor", () => {
    const surface = makeRunwaySurface();
    const lhas = [
      makeLha(1, 14.2401), // near start
      makeLha(2, 14.2698), // ~14m before end
    ];
    const out = resolveLhaSelection(
      { mode: "FROM_THRESHOLD", params: { threshold: "END", distance_m: 100 } },
      makeAgl(lhas),
      surface,
    );
    expect(out).toEqual(new Set(["lha-2"]));
  });

  it("FROM_THRESHOLD with no surface returns empty set", () => {
    const out = resolveLhaSelection(
      { mode: "FROM_THRESHOLD", params: { threshold: "START", distance_m: 100 } },
      makeAgl([makeLha(1)]),
      null,
    );
    expect(out?.size ?? 0).toBe(0);
  });
});
