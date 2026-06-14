import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useTerrainProviderReady } from "./useTerrainProviderReady";

type HookViewer = Parameters<typeof useTerrainProviderReady>[0];

/** fake cesium viewer exposing only the surface the hook touches:
 * isDestroyed(), terrainProvider, and the terrainProviderChanged emitter. */
function makeViewer(initial: unknown = { id: "ellipsoid" }) {
  const listeners = new Set<() => void>();
  return {
    _destroyed: false,
    isDestroyed() {
      return this._destroyed;
    },
    terrainProvider: initial,
    scene: {
      globe: {
        terrainProviderChanged: {
          addEventListener(cb: () => void) {
            listeners.add(cb);
            return () => {
              listeners.delete(cb);
            };
          },
        },
      },
    },
    fireTerrainChange(next: unknown) {
      this.terrainProvider = next;
      for (const cb of listeners) cb();
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

describe("useTerrainProviderReady", () => {
  it("captures the initial provider on mount", () => {
    const initial = { id: "ellipsoid" };
    const viewer = makeViewer(initial);
    const { result } = renderHook(() =>
      useTerrainProviderReady(viewer as unknown as HookViewer),
    );
    expect(result.current).toBe(initial);
  });

  it("updates when terrainProviderChanged fires", () => {
    const viewer = makeViewer({ id: "ellipsoid" });
    const { result } = renderHook(() =>
      useTerrainProviderReady(viewer as unknown as HookViewer),
    );
    const next = { id: "world-terrain" };
    act(() => {
      viewer.fireTerrainChange(next);
    });
    expect(result.current).toBe(next);
  });

  it("removes the listener on unmount", () => {
    const viewer = makeViewer();
    const { unmount } = renderHook(() =>
      useTerrainProviderReady(viewer as unknown as HookViewer),
    );
    expect(viewer.listenerCount()).toBe(1);
    unmount();
    expect(viewer.listenerCount()).toBe(0);
  });

  it("returns null and never subscribes when the viewer is null", () => {
    const { result } = renderHook(() => useTerrainProviderReady(null));
    expect(result.current).toBeNull();
  });

  it("returns null and never subscribes when the viewer is destroyed", () => {
    const viewer = makeViewer();
    viewer._destroyed = true;
    const { result } = renderHook(() =>
      useTerrainProviderReady(viewer as unknown as HookViewer),
    );
    expect(result.current).toBeNull();
    expect(viewer.listenerCount()).toBe(0);
  });

  it("does not propagate change events fired after the viewer is destroyed", () => {
    const viewer = makeViewer({ id: "ellipsoid" });
    const { result } = renderHook(() =>
      useTerrainProviderReady(viewer as unknown as HookViewer),
    );
    expect(result.current).toEqual({ id: "ellipsoid" });

    viewer._destroyed = true;
    const stale = { id: "stale" };
    act(() => {
      viewer.fireTerrainChange(stale);
    });
    // listener no-ops once viewer is destroyed: state stays at the
    // previous live provider value rather than picking up the stale one.
    expect(result.current).not.toBe(stale);
  });

  it("does not throw when the viewer flips to destroyed before unmount", () => {
    const viewer = makeViewer();
    const { unmount } = renderHook(() =>
      useTerrainProviderReady(viewer as unknown as HookViewer),
    );
    viewer._destroyed = true;
    expect(() => unmount()).not.toThrow();
  });

  it("re-subscribes to a fresh viewer when the prop changes", () => {
    const first = makeViewer({ id: "first" });
    const second = makeViewer({ id: "second" });
    const { result, rerender } = renderHook(
      ({ v }: { v: ReturnType<typeof makeViewer> }) =>
        useTerrainProviderReady(v as unknown as HookViewer),
      { initialProps: { v: first } },
    );
    expect(result.current).toEqual({ id: "first" });
    expect(first.listenerCount()).toBe(1);

    rerender({ v: second });
    expect(result.current).toEqual({ id: "second" });
    expect(first.listenerCount()).toBe(0);
    expect(second.listenerCount()).toBe(1);
  });
});

