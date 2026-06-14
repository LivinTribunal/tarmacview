import { useEffect, useState } from "react";
import type { Viewer as CesiumViewer } from "cesium";
import type { WaypointResponse } from "@/types/flightPlan";
import { resolveWaypointHeights } from "./terrainSampling";
import { useTerrainProviderReady } from "./useTerrainProviderReady";

/** pre-samples cesium terrain ellipsoidal heights for every waypoint and re-samples
 * whenever the live terrainProvider swaps in (setTerrain is async). returns null
 * while sampling is unresolved or after a failure. */
export function useFlyAlongTerrain(
  viewer: CesiumViewer | null,
  waypoints: WaypointResponse[],
): Map<string, number> | null {
  const [heights, setHeights] = useState<Map<string, number> | null>(null);
  const terrainProvider = useTerrainProviderReady(viewer);

  // pre-sample terrain ellipsoidal heights for every waypoint
  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || waypoints.length === 0) {
      setHeights(null);
      return;
    }
    let cancelled = false;
    const points: Array<[number, number]> = waypoints.map((wp) => {
      const [lng, lat] = wp.position.coordinates;
      return [lng, lat];
    });
    resolveWaypointHeights(viewer, points)
      .then((map) => {
        if (!cancelled) setHeights(map);
      })
      .catch(() => {
        if (!cancelled) setHeights(null);
      });
    return () => {
      cancelled = true;
    };
  }, [viewer, waypoints, terrainProvider]);

  return heights;
}
