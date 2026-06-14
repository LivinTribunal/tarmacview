import { describe, expect, it, vi } from "vitest";
import {
  GLYPHS_URL,
  makeMapStyle,
  makeSatelliteStyle,
  waitForStyleLoaded,
} from "./mapStyles";

describe("GLYPHS_URL", () => {
  it("falls back to the public demotiles glyphs endpoint", () => {
    // VITE_GLYPHS_URL is unset in the test env, so the fallback applies.
    expect(GLYPHS_URL).toBe(
      "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    );
  });
});

describe("makeSatelliteStyle", () => {
  it("builds a v8 raster style with the satellite source + base layer", () => {
    const style = makeSatelliteStyle();
    expect(style.version).toBe(8);
    expect(style.glyphs).toBe(GLYPHS_URL);
    expect(style.sources.satellite).toMatchObject({
      type: "raster",
      tileSize: 256,
      maxzoom: 18,
    });
    expect(style.layers).toEqual([
      { id: "satellite-base", type: "raster", source: "satellite" },
    ]);
  });
});

describe("makeMapStyle", () => {
  it("builds a v8 raster style with the osm source + base layer", () => {
    const style = makeMapStyle();
    expect(style.version).toBe(8);
    expect(style.glyphs).toBe(GLYPHS_URL);
    expect(style.sources.osm).toMatchObject({
      type: "raster",
      tileSize: 256,
      maxzoom: 19,
    });
    expect(style.layers).toEqual([
      { id: "osm-base", type: "raster", source: "osm" },
    ]);
  });
});

describe("waitForStyleLoaded", () => {
  it("invokes the callback once the style reports loaded", async () => {
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    const callback = vi.fn();
    const isStyleLoaded = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const map = { isStyleLoaded } as unknown as import("maplibre-gl").Map;

    waitForStyleLoaded(map, callback);

    expect(callback).toHaveBeenCalledTimes(1);
    rafSpy.mockRestore();
  });

  it("returns a cancel fn that prevents the callback from firing", () => {
    const holder: { cb: FrameRequestCallback | null } = { cb: null };
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        holder.cb = cb;
        return 0;
      });
    const callback = vi.fn();
    const map = {
      isStyleLoaded: vi.fn().mockReturnValue(false),
    } as unknown as import("maplibre-gl").Map;

    const cancel = waitForStyleLoaded(map, callback);
    cancel();
    holder.cb?.(0);

    expect(callback).not.toHaveBeenCalled();
    rafSpy.mockRestore();
  });
});
