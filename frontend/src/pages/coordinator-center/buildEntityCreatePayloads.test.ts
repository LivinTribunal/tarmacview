import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AirportDetailResponse } from "@/types/airport";
import { createEntity, type EntityCreateContext } from "./buildEntityCreatePayloads";

const createSurface = vi.fn().mockResolvedValue({});
const createObstacle = vi.fn().mockResolvedValue({});
const createSafetyZone = vi.fn().mockResolvedValue({});
const createAGL = vi.fn().mockResolvedValue({});
const createLHA = vi.fn().mockResolvedValue({});

vi.mock("@/api/airports", () => ({
  createSurface: (...a: unknown[]) => createSurface(...a),
  createObstacle: (...a: unknown[]) => createObstacle(...a),
  createSafetyZone: (...a: unknown[]) => createSafetyZone(...a),
  createAGL: (...a: unknown[]) => createAGL(...a),
  createLHA: (...a: unknown[]) => createLHA(...a),
}));

const airport = {
  id: "apt-1",
  elevation: 100,
  surfaces: [{ id: "s-1", agls: [{ id: "agl-1" }] }],
} as unknown as AirportDetailResponse;

const rect: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [[[0, 0], [0, 0.001], [0.002, 0.001], [0.002, 0], [0, 0]]],
};

function ctx(over: Partial<EntityCreateContext> = {}): EntityCreateContext {
  return {
    id: "apt-1",
    airport,
    elevationResolver: undefined,
    fallbackElevation: airport.elevation,
    pendingGeometry: rect,
    pendingCircleCenter: undefined,
    pendingPointPosition: undefined,
    pendingLhaParentAglId: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createEntity - surface", () => {
  it("prefers form values over derived geometry and fills boundary Z from fallback", async () => {
    await createEntity("runway", { name: "09/27", heading: 88, length: 1200, width: 30 }, ctx());
    const [aid, body] = createSurface.mock.calls[0];
    expect(aid).toBe("apt-1");
    expect(body.surface_type).toBe("RUNWAY");
    expect(body.heading).toBe(88);
    expect(body.length).toBe(1200);
    expect(body.width).toBe(30);
    expect(body.geometry.type).toBe("LineString");
    expect(body.boundary.coordinates[0][0][2]).toBe(100);
  });

  it("derives values when the form omits them", async () => {
    await createEntity("runway", { name: "r" }, ctx());
    const body = createSurface.mock.calls[0][1];
    expect(typeof body.heading).toBe("number");
    expect(typeof body.length).toBe("number");
    expect(typeof body.width).toBe("number");
  });

  it("omits width for taxiways", async () => {
    await createEntity("taxiway", { name: "A" }, ctx());
    const body = createSurface.mock.calls[0][1];
    expect(body.surface_type).toBe("TAXIWAY");
    expect(body.width).toBeUndefined();
  });

  it("auto-fills touchpoint altitude from the fallback when blank", async () => {
    await createEntity("runway", { name: "r", touchpoint_latitude: 1, touchpoint_longitude: 2 }, ctx());
    const body = createSurface.mock.calls[0][1];
    expect(body.touchpoint_altitude).toBe(100);
  });

  it("throws when geometry is missing", async () => {
    await expect(
      createEntity("runway", { name: "r" }, ctx({ pendingGeometry: null })),
    ).rejects.toThrow("missing geometry");
  });
});

describe("createEntity - safety zone", () => {
  it("maps no_fly to TEMPORARY_NO_FLY and keeps floor/ceiling", async () => {
    await createEntity(
      "safety_zone_no_fly",
      { name: "z", altitude_floor: 0, altitude_ceiling: 120, is_active: true },
      ctx(),
    );
    const body = createSafetyZone.mock.calls[0][1];
    expect(body.type).toBe("TEMPORARY_NO_FLY");
    expect(body.altitude_floor).toBe(0);
    expect(body.altitude_ceiling).toBe(120);
  });

  it("forces is_active and drops floor/ceiling for an airport boundary", async () => {
    await createEntity(
      "safety_zone_airport_boundary",
      { name: "b", altitude_floor: 5, altitude_ceiling: 9 },
      ctx(),
    );
    const body = createSafetyZone.mock.calls[0][1];
    expect(body.type).toBe("AIRPORT_BOUNDARY");
    expect(body.altitude_floor).toBeUndefined();
    expect(body.altitude_ceiling).toBeUndefined();
    expect(body.is_active).toBe(true);
  });
});

describe("createEntity - obstacle", () => {
  it("uses per-vertex DEM ring when polygon is pending", async () => {
    await createEntity("obstacle", { name: "tower", height: 30 }, ctx());
    const body = createObstacle.mock.calls[0][1];
    expect(body.boundary.coordinates[0][0][2]).toBe(100);
    expect(body.type).toBe("BUILDING");
  });

  it("builds a circle ring from the form alt when no polygon", async () => {
    await createEntity(
      "obstacle",
      { name: "ant", height: 10, altitude: 250, buffer_distance: 8, center: [1, 2] },
      ctx({ pendingGeometry: null }),
    );
    const body = createObstacle.mock.calls[0][1];
    expect(body.buffer_distance).toBe(8);
    expect(body.boundary.coordinates[0][0][2]).toBe(250);
  });
});

describe("createEntity - agl + lha", () => {
  it("normalizes an unknown agl_type to PAPI", async () => {
    await createEntity(
      "agl",
      { name: "p", surface_id: "s-1", agl_type: "WEIRD", center: [1, 2] },
      ctx(),
    );
    const [, sid, body] = createAGL.mock.calls[0];
    expect(sid).toBe("s-1");
    expect(body.agl_type).toBe("PAPI");
    expect(body.position.coordinates[2]).toBe(100);
  });

  it("resolves the parent surface for an lha via the pending agl id", async () => {
    await createEntity(
      "lha",
      { name: "l", center: [1, 2] },
      ctx({ pendingPointPosition: [1, 2], pendingLhaParentAglId: "agl-1" }),
    );
    const [aid, sid, aglId] = createLHA.mock.calls[0];
    expect(aid).toBe("apt-1");
    expect(sid).toBe("s-1");
    expect(aglId).toBe("agl-1");
  });

  it("throws on an unknown entity type", async () => {
    await expect(createEntity("nope", {}, ctx())).rejects.toThrow("unknown entity type: nope");
  });
});
