import { useEffect, useState } from "react";
import { EllipsoidTerrainProvider } from "cesium";
import type { Viewer as CesiumViewer } from "cesium";
import { useTerrainProviderReady } from "./useTerrainProviderReady";

// closed-network / missing-ion-token deploys never swap terrain - reveal the
// clamped markers anyway after this long rather than hiding them forever
const TERRAIN_SETTLE_FALLBACK_MS = 8000;

/** returns true once the viewer's terrain provider is real (not the default
 * ellipsoid). gates CLAMP_TO_GROUND infra markers so they don't snap from below
 * real ground during the async setTerrain() swap. one-shot: stays true after
 * the first real provider is seen; closed-network deploys reveal via the
 * fallback timer. */
export function useTerrainSettled(viewer: CesiumViewer | undefined): boolean {
  const terrainProvider = useTerrainProviderReady(viewer);
  const [terrainSettled, setTerrainSettled] = useState(false);

  useEffect(() => {
    if (terrainProvider && !(terrainProvider instanceof EllipsoidTerrainProvider)) {
      setTerrainSettled(true);
    }
  }, [terrainProvider]);

  // fallback for closed-network / missing-ion-token deploys: the terrain
  // provider never swaps off the ellipsoid, so reveal markers anyway.
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const timer = window.setTimeout(() => setTerrainSettled(true), TERRAIN_SETTLE_FALLBACK_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [viewer]);

  return terrainSettled;
}
