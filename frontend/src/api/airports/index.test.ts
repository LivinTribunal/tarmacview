import { describe, it, expect, beforeEach, vi } from "vitest";

const get = vi.fn().mockResolvedValue({ data: {} });
const post = vi.fn().mockResolvedValue({ data: {} });
const put = vi.fn().mockResolvedValue({ data: {} });
const del = vi.fn().mockResolvedValue({ data: {} });

vi.mock("@/api/client", () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));

import * as airports from "@/api/airports";

beforeEach(() => {
  vi.clearAllMocks();
});

const EXPECTED = [
  "listAirports",
  "listAirportSummaries",
  "getAirport",
  "createAirport",
  "lookupAirport",
  "updateAirport",
  "deleteAirport",
  "setDefaultDrone",
  "bulkChangeDrone",
  "uploadTerrainDEM",
  "deleteTerrainDEM",
  "downloadTerrainData",
  "fetchElevationAt",
  "extractPhotoMetadata",
  "listSurfaces",
  "createSurface",
  "updateSurface",
  "deleteSurface",
  "recalculateSurface",
  "createReverseSurface",
  "coupleSurface",
  "decoupleSurface",
  "listObstacles",
  "createObstacle",
  "updateObstacle",
  "deleteObstacle",
  "recalculateObstacle",
  "listSafetyZones",
  "createSafetyZone",
  "updateSafetyZone",
  "deleteSafetyZone",
  "listAGLs",
  "createAGL",
  "updateAGL",
  "deleteAGL",
  "listLHAs",
  "createLHA",
  "updateLHA",
  "deleteLHA",
  "bulkCreateLHAs",
  "reverseLHAs",
] as const;

describe("@/api/airports barrel", () => {
  it("re-exports every airport api function", () => {
    for (const name of EXPECTED) {
      expect(typeof (airports as Record<string, unknown>)[name]).toBe("function");
    }
  });

  it("exposes no extra exports beyond the contract", () => {
    expect(Object.keys(airports).sort()).toEqual([...EXPECTED].sort());
  });
});

describe("@/api/airports url + params (mocked client)", () => {
  it("getAirport hits /airports/:id", async () => {
    await airports.getAirport("apt-1");
    expect(get).toHaveBeenCalledWith("/airports/apt-1");
  });

  it("lookupAirport encodes the icao and forwards radius_km", async () => {
    await airports.lookupAirport("LZIB", 25);
    expect(get).toHaveBeenCalledWith("/airports/lookup/LZIB", {
      params: { radius_km: 25 },
    });
  });

  it("updateAirport defaults rewrite_existing to true", async () => {
    await airports.updateAirport("apt-1", { name: "x" } as never);
    expect(put).toHaveBeenCalledWith(
      "/airports/apt-1",
      { name: "x" },
      { params: { rewrite_existing: true } },
    );
  });

  it("createSurface posts to the nested surfaces path", async () => {
    await airports.createSurface("apt-1", { identifier: "09" } as never);
    expect(post).toHaveBeenCalledWith("/airports/apt-1/surfaces", {
      identifier: "09",
    });
  });

  it("createLHA posts to the deeply nested lhas path", async () => {
    await airports.createLHA("apt-1", "s-1", "agl-1", {} as never);
    expect(post).toHaveBeenCalledWith(
      "/airports/apt-1/surfaces/s-1/agls/agl-1/lhas",
      {},
    );
  });

  it("bulkCreateLHAs posts to the /lhas/bulk path", async () => {
    await airports.bulkCreateLHAs("apt-1", "s-1", "agl-1", {} as never);
    expect(post).toHaveBeenCalledWith(
      "/airports/apt-1/surfaces/s-1/agls/agl-1/lhas/bulk",
      {},
    );
  });

  it("reverseLHAs posts to the /lhas/reverse path", async () => {
    await airports.reverseLHAs("apt-1", "s-1", "agl-1");
    expect(post).toHaveBeenCalledWith(
      "/airports/apt-1/surfaces/s-1/agls/agl-1/lhas/reverse",
    );
  });

  it("deleteSafetyZone deletes the nested safety-zone path", async () => {
    await airports.deleteSafetyZone("apt-1", "sz-1");
    expect(del).toHaveBeenCalledWith("/airports/apt-1/safety-zones/sz-1");
  });

  it("fetchElevationAt forwards lat/lon params", async () => {
    await airports.fetchElevationAt("apt-1", 48.1, 17.2);
    expect(get).toHaveBeenCalledWith("/airports/apt-1/elevation", {
      params: { lat: 48.1, lon: 17.2 },
    });
  });

  it("extractPhotoMetadata posts form data to the extract path", async () => {
    const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
    await airports.extractPhotoMetadata("apt-1", [file]);
    const [url, body] = post.mock.calls[post.mock.calls.length - 1];
    expect(url).toBe("/airports/apt-1/extract-photo-metadata");
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).getAll("files")).toHaveLength(1);
  });
});
