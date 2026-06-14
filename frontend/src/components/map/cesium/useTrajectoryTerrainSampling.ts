import { useEffect, useState } from "react";
import type { Viewer as CesiumViewer } from "cesium";
import type { WaypointResponse } from "@/types/flightPlan";
import type { PointZ } from "@/types/common";
import { resolveWaypointHeights } from "./terrainSampling";
import { useTerrainProviderReady } from "./useTerrainProviderReady";

/** owns the terrain-sampling effect for CesiumTrajectory: batches every
 * (lng, lat) we need and resolves sampled cesium terrain heights keyed by
 * terrainKey(lng, lat). re-runs whenever the live terrain provider swaps in
 * so the first 3d open re-samples once world terrain finishes loading. */
export function useTrajectoryTerrainSampling(
  viewer: CesiumViewer | undefined,
  visibleWaypoints: WaypointResponse[],
  takeoffCoordinate: PointZ | null | undefined,
  landingCoordinate: PointZ | null | undefined,
): Map<string, number> {
  // sampled cesium terrain heights keyed by terrainKey(lng, lat)
  const [sampledHeights, setSampledHeights] = useState<Map<string, number>>(new Map());

  const terrainProvider = useTerrainProviderReady(viewer);

  // collect every (lng, lat) we need terrain for, then await sampleTerrainMostDetailed.
  // re-runs on waypoint set, takeoff/landing or terrain provider change.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    const points: Array<[number, number]> = [];
    for (const wp of visibleWaypoints) {
      const [lng, lat] = wp.position.coordinates;
      points.push([lng, lat]);
      if (wp.camera_target) {
        const [tLng, tLat] = wp.camera_target.coordinates;
        points.push([tLng, tLat]);
      }
    }
    if (takeoffCoordinate) {
      const [lng, lat] = takeoffCoordinate.coordinates;
      points.push([lng, lat]);
    }
    if (landingCoordinate) {
      const [lng, lat] = landingCoordinate.coordinates;
      points.push([lng, lat]);
    }

    if (points.length === 0) {
      setSampledHeights(new Map());
      return;
    }

    let cancelled = false;
    resolveWaypointHeights(viewer, points)
      .then((map) => {
        if (!cancelled) setSampledHeights(map);
      })
      .catch((err) => {
        console.warn(
          "terrain sampling failed:",
          err instanceof Error ? err.message : String(err),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [viewer, visibleWaypoints, takeoffCoordinate, landingCoordinate, terrainProvider]);

  return sampledHeights;
}
