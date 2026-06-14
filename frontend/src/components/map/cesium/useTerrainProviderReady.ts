import { useEffect, useState } from "react";
import type { TerrainProvider, Viewer as CesiumViewer } from "cesium";

/** tracks the live cesium terrain provider so an async setTerrain() swap
 * (which doesn't cause a react re-render on its own) is observable. seeds
 * from viewer.terrainProvider on mount, then subscribes to
 * terrainProviderChanged and mirrors the live provider. returns null when
 * the viewer is missing or destroyed. */
export function useTerrainProviderReady(
  viewer: CesiumViewer | null | undefined,
): TerrainProvider | null {
  const [terrainProvider, setTerrainProvider] = useState<TerrainProvider | null>(
    () => viewer?.terrainProvider ?? null,
  );
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) {
      setTerrainProvider(null);
      return;
    }
    setTerrainProvider(viewer.terrainProvider);
    const remove = viewer.scene.globe.terrainProviderChanged.addEventListener(() => {
      if (!viewer.isDestroyed()) setTerrainProvider(viewer.terrainProvider);
    });
    return () => {
      remove();
    };
  }, [viewer]);
  return terrainProvider;
}
