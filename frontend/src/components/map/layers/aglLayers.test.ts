import { describe, it, expect } from "vitest";
import type { Map as MaplibreMap } from "maplibre-gl";
import type { AglType, SurfaceResponse } from "@/types/airport";
import {
  addAglLayers,
  AGL_POINT_LAYER,
  AGL_LABEL_LAYER,
  LHA_POINT_LAYER,
  LHA_LABEL_LAYER,
  EDGE_LIGHTS_LINE_LAYER,
} from "./aglLayers";

// fake maplibre map that records source/layer adds in call order
interface Op {
  op: string;
  id: string;
}
function makeFakeMap() {
  const ops: Op[] = [];
  const map = {
    addSource(id: string) {
      ops.push({ op: "addSource", id });
    },
    addLayer(layer: { id: string }) {
      ops.push({ op: "addLayer", id: layer.id });
    },
  };
  return { map: map as unknown as MaplibreMap, ops };
}

// minimal surface with one agl that optionally carries lha units
function surface(aglType: AglType, lhaCount: number): SurfaceResponse {
  const lhas = Array.from({ length: lhaCount }, (_, i) => ({
    id: `lha-${i}`,
    agl_id: "agl-1",
    unit_designator: String(i + 1),
    setting_angle: 3,
    lamp_type: "LED",
    position: { type: "Point", coordinates: [14.0 + i * 0.001, 50.0, 0] },
    sequence_number: i + 1,
  }));
  return {
    id: "surf-1",
    surface_type: "RUNWAY",
    identifier: "09",
    agls: [
      {
        id: "agl-1",
        surface_id: "surf-1",
        agl_type: aglType,
        name: "PAPI RWY 09",
        position: { type: "Point", coordinates: [14.0, 50.0, 0] },
        side: null,
        lhas,
      },
    ],
  } as unknown as SurfaceResponse;
}

function layerOrder(ops: Op[]): string[] {
  return ops.filter((o) => o.op === "addLayer").map((o) => o.id);
}

describe("addAglLayers layer ordering", () => {
  it("adds AGL_LABEL_LAYER after LHA_LABEL_LAYER so it wins collision/stacking", () => {
    const fake = makeFakeMap();
    addAglLayers(fake.map, [surface("PAPI", 2)]);
    const order = layerOrder(fake.ops);
    expect(order.indexOf(AGL_LABEL_LAYER)).toBeGreaterThan(
      order.indexOf(LHA_LABEL_LAYER),
    );
  });

  it("keeps AGL_POINT_LAYER beneath the LHA layers", () => {
    const fake = makeFakeMap();
    addAglLayers(fake.map, [surface("PAPI", 2)]);
    const order = layerOrder(fake.ops);
    expect(order.indexOf(AGL_POINT_LAYER)).toBeLessThan(
      order.indexOf(LHA_POINT_LAYER),
    );
  });

  it("still adds the AGL label when there are no LHAs", () => {
    const fake = makeFakeMap();
    addAglLayers(fake.map, [surface("PAPI", 0)]);
    const order = layerOrder(fake.ops);
    expect(order).toContain(AGL_LABEL_LAYER);
    expect(order).not.toContain(LHA_LABEL_LAYER);
  });

  it("adds the edge-lights line last", () => {
    const fake = makeFakeMap();
    addAglLayers(fake.map, [surface("RUNWAY_EDGE_LIGHTS", 2)]);
    const order = layerOrder(fake.ops);
    expect(order[order.length - 1]).toBe(EDGE_LIGHTS_LINE_LAYER);
  });
});
