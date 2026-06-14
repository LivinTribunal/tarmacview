import { describe, it, expect } from "vitest";
import type maplibregl from "maplibre-gl";
import {
  createDrawingLayer,
  clearDrawingSources,
  removeDrawingSources,
  type DrawingSourceSpec,
} from "./useDrawingSources";

// minimal fake map that records the order of add/remove ops
function makeFakeMap() {
  const sources = new Map<string, { setData: (d: unknown) => void; lastData: unknown }>();
  const layers = new Set<string>();
  const ops: string[] = [];

  const map = {
    getSource(id: string) {
      return sources.get(id);
    },
    addSource(id: string) {
      ops.push(`addSource:${id}`);
      sources.set(id, {
        lastData: undefined,
        setData(d: unknown) { this.lastData = d; },
      });
    },
    addLayer(layer: { id: string }) {
      ops.push(`addLayer:${layer.id}`);
      layers.add(layer.id);
    },
    getLayer(id: string) {
      return layers.has(id) ? { id } : undefined;
    },
    removeLayer(id: string) {
      ops.push(`removeLayer:${id}`);
      layers.delete(id);
    },
    removeSource(id: string) {
      ops.push(`removeSource:${id}`);
      sources.delete(id);
    },
  };

  return { map: map as unknown as maplibregl.Map, sources, layers, ops };
}

// 1-source / 1-layer point spec
const pointSpec: DrawingSourceSpec[] = [
  {
    source: "draw-point-preview",
    layers: [{ id: "draw-point-preview-layer", type: "circle", source: "draw-point-preview" }],
  },
];

// 4-source circle spec; the stroke source carries the dual-filter circle + radius layers
const circleSpec: DrawingSourceSpec[] = [
  {
    source: "draw-circle-fill",
    layers: [{ id: "draw-circle-fill-layer", type: "fill", source: "draw-circle-fill" }],
  },
  {
    source: "draw-circle-stroke",
    layers: [
      { id: "draw-circle-stroke-layer", type: "line", source: "draw-circle-stroke" },
      { id: "draw-circle-radius-layer", type: "line", source: "draw-circle-stroke" },
    ],
  },
  {
    source: "draw-circle-vertices",
    layers: [{ id: "draw-circle-vertices-layer", type: "circle", source: "draw-circle-vertices" }],
  },
  {
    source: "draw-circle-labels",
    layers: [{ id: "draw-circle-labels-layer", type: "symbol", source: "draw-circle-labels" }],
  },
];

describe("createDrawingLayer", () => {
  it("adds the single point source + layer once", () => {
    const { map, sources, layers, ops } = makeFakeMap();
    createDrawingLayer(map, pointSpec);
    expect(sources.has("draw-point-preview")).toBe(true);
    expect(layers.has("draw-point-preview-layer")).toBe(true);
    expect(ops).toEqual(["addSource:draw-point-preview", "addLayer:draw-point-preview-layer"]);
  });

  it("is idempotent - a second call adds nothing", () => {
    const { map, ops } = makeFakeMap();
    createDrawingLayer(map, pointSpec);
    createDrawingLayer(map, pointSpec);
    expect(ops).toEqual(["addSource:draw-point-preview", "addLayer:draw-point-preview-layer"]);
  });

  it("adds both dual-filter layers under the shared circle stroke source", () => {
    const { map, ops } = makeFakeMap();
    createDrawingLayer(map, circleSpec);
    expect(ops).toEqual([
      "addSource:draw-circle-fill",
      "addLayer:draw-circle-fill-layer",
      "addSource:draw-circle-stroke",
      "addLayer:draw-circle-stroke-layer",
      "addLayer:draw-circle-radius-layer",
      "addSource:draw-circle-vertices",
      "addLayer:draw-circle-vertices-layer",
      "addSource:draw-circle-labels",
      "addLayer:draw-circle-labels-layer",
    ]);
  });
});

describe("clearDrawingSources", () => {
  it("resets every spec source to an empty feature collection", () => {
    const { map, sources } = makeFakeMap();
    createDrawingLayer(map, circleSpec);
    clearDrawingSources(map, circleSpec);
    for (const src of sources.values()) {
      expect(src.lastData).toEqual({ type: "FeatureCollection", features: [] });
    }
  });
});

describe("removeDrawingSources", () => {
  it("tears down layers then sources in reverse (LIFO) order", () => {
    const { map, ops } = makeFakeMap();
    createDrawingLayer(map, circleSpec);
    ops.length = 0;
    removeDrawingSources(map, circleSpec);
    expect(ops).toEqual([
      "removeLayer:draw-circle-labels-layer",
      "removeLayer:draw-circle-vertices-layer",
      "removeLayer:draw-circle-radius-layer",
      "removeLayer:draw-circle-stroke-layer",
      "removeLayer:draw-circle-fill-layer",
      "removeSource:draw-circle-labels",
      "removeSource:draw-circle-vertices",
      "removeSource:draw-circle-stroke",
      "removeSource:draw-circle-fill",
    ]);
  });

  it("ignores ids that were never added", () => {
    const { map, ops } = makeFakeMap();
    expect(() => removeDrawingSources(map, pointSpec)).not.toThrow();
    expect(ops).toEqual([]);
  });
});
