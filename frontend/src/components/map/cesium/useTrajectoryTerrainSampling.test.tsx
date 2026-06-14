import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// the hook only type-imports cesium; its sole runtime dependency is
// resolveWaypointHeights, which we mock so no live viewer is needed.
const { resolveWaypointHeightsMock } = vi.hoisted(() => ({
  resolveWaypointHeightsMock: vi.fn(),
}));

vi.mock("./terrainSampling", () => ({
  resolveWaypointHeights: resolveWaypointHeightsMock,
}));

import { useTrajectoryTerrainSampling } from "./useTrajectoryTerrainSampling";
import type { WaypointResponse } from "@/types/flightPlan";
import type { PointZ } from "@/types/common";

type HookViewer = Parameters<typeof useTrajectoryTerrainSampling>[0];

/** fake cesium viewer exposing only the surface the hook touches:
 * isDestroyed(), terrainProvider, and the terrainProviderChanged emitter. */
function makeViewer() {
  const listeners = new Set<() => void>();
  return {
    _destroyed: false,
    isDestroyed() {
      return this._destroyed;
    },
    terrainProvider: { id: "ellipsoid" } as unknown,
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
  };
}

const wp = {
  position: { coordinates: [1, 2, 100] },
  camera_target: { coordinates: [3, 4, 0] },
} as unknown as WaypointResponse;

// stable references: the real component feeds a useMemo'd visibleWaypoints, so
// the effect deps only change on real data changes. fresh array literals per
// render would re-fire the sampling effect every render and spin forever.
const NO_WPS: WaypointResponse[] = [];
const WPS: WaypointResponse[] = [wp];

const takeoff = { coordinates: [5, 6, 0] } as unknown as PointZ;
const landing = { coordinates: [7, 8, 0] } as unknown as PointZ;

describe("useTrajectoryTerrainSampling", () => {
  beforeEach(() => {
    resolveWaypointHeightsMock.mockReset();
    resolveWaypointHeightsMock.mockResolvedValue(new Map());
  });

  it("returns an empty Map and never samples without a viewer", () => {
    const { result } = renderHook(() =>
      useTrajectoryTerrainSampling(undefined, NO_WPS, null, null),
    );
    expect(result.current).toBeInstanceOf(Map);
    expect(result.current.size).toBe(0);
    expect(resolveWaypointHeightsMock).not.toHaveBeenCalled();
  });

  it("returns an empty Map and never samples when there are no points", () => {
    const viewer = makeViewer();
    const { result } = renderHook(() =>
      useTrajectoryTerrainSampling(viewer as unknown as HookViewer, NO_WPS, null, null),
    );
    expect(result.current.size).toBe(0);
    expect(resolveWaypointHeightsMock).not.toHaveBeenCalled();
  });

  it("samples wp + camera_target + takeoff + landing points and exposes the resolved heights", async () => {
    resolveWaypointHeightsMock.mockResolvedValue(new Map([["x", 9]]));
    const viewer = makeViewer();
    const { result } = renderHook(() =>
      useTrajectoryTerrainSampling(
        viewer as unknown as HookViewer,
        WPS,
        takeoff,
        landing,
      ),
    );
    await waitFor(() => expect(result.current.get("x")).toBe(9));
    expect(resolveWaypointHeightsMock).toHaveBeenCalledWith(viewer, [
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
    ]);
  });

  it("re-samples when the terrain provider changes", async () => {
    resolveWaypointHeightsMock.mockResolvedValue(new Map([["a", 1]]));
    const viewer = makeViewer();
    renderHook(() =>
      useTrajectoryTerrainSampling(viewer as unknown as HookViewer, WPS, null, null),
    );
    await waitFor(() => expect(resolveWaypointHeightsMock).toHaveBeenCalled());
    resolveWaypointHeightsMock.mockClear();

    act(() => {
      viewer.fireTerrainChange({ id: "world-terrain" });
    });
    await waitFor(() => expect(resolveWaypointHeightsMock).toHaveBeenCalledTimes(1));
  });

  it("does not setState after unmount when a stale sampling promise resolves", async () => {
    let resolveLate: (m: Map<string, number>) => void = () => {};
    resolveWaypointHeightsMock.mockImplementation(
      () =>
        new Promise<Map<string, number>>((res) => {
          resolveLate = res;
        }),
    );
    const viewer = makeViewer();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderHook(() =>
      useTrajectoryTerrainSampling(viewer as unknown as HookViewer, WPS, null, null),
    );
    await waitFor(() => expect(resolveWaypointHeightsMock).toHaveBeenCalled());

    unmount();
    await act(async () => {
      resolveLate(new Map([["late", 1]]));
    });

    // the cancelled flag must swallow the late resolve - no act()/state-after-
    // unmount warning gets logged
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
