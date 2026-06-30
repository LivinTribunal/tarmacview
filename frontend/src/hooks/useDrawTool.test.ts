import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type maplibregl from "maplibre-gl";
import useDrawCircle from "./useDrawCircle";
import useDrawRectangle from "./useDrawRectangle";
import useDrawPolygon from "./useDrawPolygon";
import usePlacePoint from "./usePlacePoint";

// fake map that captures event handlers so tests can drive click/move directly
function makeFakeMap() {
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  const sources = new Map<string, { setData: (d: unknown) => void }>();
  const canvas = { style: { cursor: "" } };

  const map = {
    on(type: string, fn: (e: unknown) => void) {
      (handlers[type] ??= []).push(fn);
    },
    off(type: string, fn: (e: unknown) => void) {
      handlers[type] = (handlers[type] ?? []).filter((h) => h !== fn);
    },
    once() {},
    isStyleLoaded: () => true,
    getCanvas: () => canvas,
    getSource: (id: string) => sources.get(id),
    addSource: (id: string) => sources.set(id, { setData: vi.fn() }),
    addLayer: vi.fn(),
    getLayer: () => undefined,
    project: (c: [number, number]) => ({ x: c[0] * 1000, y: c[1] * 1000 }),
    unproject: (p: [number, number]) => ({ lng: p[0] / 1000, lat: p[1] / 1000 }),
  };

  function fire(type: string, lng: number, lat: number) {
    const e = { lngLat: { lng, lat }, preventDefault: vi.fn() };
    for (const h of handlers[type] ?? []) h(e);
  }

  return { map: map as unknown as maplibregl.Map, canvas, fire, handlers };
}

describe("useDrawCircle", () => {
  it("sets a crosshair cursor while active", () => {
    const { map, canvas } = makeFakeMap();
    renderHook(() => useDrawCircle(map, true, vi.fn()));
    expect(canvas.style.cursor).toBe("crosshair");
  });

  it("completes with center+radius+polygon after click, move, click", () => {
    const { map, fire } = makeFakeMap();
    const onComplete = vi.fn();
    renderHook(() => useDrawCircle(map, true, onComplete));
    fire("click", 10, 50);
    fire("mousemove", 10.01, 50);
    fire("click", 10.01, 50);
    expect(onComplete).toHaveBeenCalledOnce();
    const result = onComplete.mock.calls[0][0];
    expect(result.center).toEqual([10, 50]);
    expect(result.radius).toBeGreaterThan(0);
    expect(result.polygon.type).toBe("Polygon");
  });

  it("cancels on contextmenu without completing", () => {
    const { map, fire, canvas } = makeFakeMap();
    const onComplete = vi.fn();
    renderHook(() => useDrawCircle(map, true, onComplete));
    fire("click", 10, 50);
    fire("contextmenu", 10, 50);
    fire("click", 11, 51);
    // a fresh click after cancel starts a new circle, never completes the old one
    expect(onComplete).not.toHaveBeenCalled();
    expect(canvas.style.cursor).toBe("crosshair");
  });
});

describe("useDrawRectangle", () => {
  it("completes with a polygon after two corner clicks", () => {
    const { map, fire } = makeFakeMap();
    const onComplete = vi.fn();
    renderHook(() => useDrawRectangle(map, true, onComplete));
    fire("click", 10, 50);
    fire("mousemove", 10.02, 50.02);
    fire("click", 10.02, 50.02);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onComplete.mock.calls[0][0].type).toBe("Polygon");
  });
});

describe("useDrawPolygon", () => {
  it("closes on double-click after 3 vertices", () => {
    const { map, fire } = makeFakeMap();
    const onComplete = vi.fn();
    renderHook(() => useDrawPolygon(map, true, onComplete));
    fire("click", 10, 50);
    fire("click", 10.02, 50);
    fire("click", 10.02, 50.02);
    fire("dblclick", 10.02, 50.02);
    expect(onComplete).toHaveBeenCalledOnce();
    const polygon = onComplete.mock.calls[0][0];
    expect(polygon.type).toBe("Polygon");
    // ring is closed (first == last)
    const ring = polygon.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("cancels on contextmenu", () => {
    const { map, fire } = makeFakeMap();
    const onComplete = vi.fn();
    renderHook(() => useDrawPolygon(map, true, onComplete));
    fire("click", 10, 50);
    fire("click", 10.02, 50);
    fire("contextmenu", 0, 0);
    fire("dblclick", 10.02, 50);
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe("usePlacePoint", () => {
  beforeEach(() => {});

  it("completes with the clicked point", () => {
    const { map, fire } = makeFakeMap();
    const onComplete = vi.fn();
    renderHook(() => usePlacePoint(map, true, onComplete));
    fire("click", 12, 48);
    expect(onComplete).toHaveBeenCalledWith([12, 48]);
  });

  it("does nothing while inactive", () => {
    const { map, fire } = makeFakeMap();
    const onComplete = vi.fn();
    renderHook(() => usePlacePoint(map, false, onComplete));
    fire("click", 12, 48);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
