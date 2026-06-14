import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useCesium } from "resium";
import type { AirportDetailResponse } from "@/types/airport";
import type { MapLayerConfig } from "@/types/map";
import { useTerrainSettled } from "./useTerrainSettled";
import {
  buildAglSystemEntities,
  buildAirportBoundaryEntities,
  buildBufferZoneEntities,
  buildObstacleEntities,
  buildSafetyZoneEntities,
  buildSurfaceEntities,
} from "./infrastructureEntities";

interface CesiumInfrastructureProps {
  airport: AirportDetailResponse;
  layers: MapLayerConfig;
  selectedFeatureKey?: string | null;
}

/** renders airport infrastructure entities (runways, taxiways, safety zones, obstacles, agl) in cesium. */
export default function CesiumInfrastructure({
  airport,
  layers,
  selectedFeatureKey,
}: CesiumInfrastructureProps) {
  const { t } = useTranslation();
  const { viewer } = useCesium();

  // agl/lha markers are CLAMP_TO_GROUND. setTerrain() is async, so on the first
  // 3d open viewer.terrainProvider is still the default ellipsoid and a marker
  // mounting now clamps ~tens of metres below real ground, only snapping up once
  // world terrain streams in (the load flicker - markers briefly under the map).
  // hold them back until terrain has settled. mirrors the terrainProviderChanged
  // pattern in CesiumTrajectory.
  const terrainSettled = useTerrainSettled(viewer);

  const surfaces = useMemo(
    () => buildSurfaceEntities(airport, layers, selectedFeatureKey, t),
    [airport.surfaces, airport.location, layers.runways, layers.taxiways, selectedFeatureKey, t],
  );

  const safetyZones = useMemo(
    () => buildSafetyZoneEntities(airport, layers, selectedFeatureKey, t),
    [airport.safety_zones, layers.safetyZones, selectedFeatureKey, t],
  );

  // airport boundary - dashed outline only (no fill)
  const airportBoundary = useMemo(
    () => buildAirportBoundaryEntities(airport, layers, selectedFeatureKey, t),
    [airport.safety_zones, layers.airportBoundary, selectedFeatureKey, t],
  );

  const obstacles = useMemo(
    () => buildObstacleEntities(airport, layers, selectedFeatureKey, t),
    [airport.obstacles, layers.obstacles, t, selectedFeatureKey],
  );

  // buffer zones for obstacles and surfaces
  const bufferZones = useMemo(
    () => buildBufferZoneEntities(airport, layers),
    [airport.obstacles, airport.surfaces, layers.bufferZones],
  );

  const aglSystems = useMemo(
    () => buildAglSystemEntities(airport, layers, terrainSettled, selectedFeatureKey, t),
    [airport.surfaces, layers.aglSystems, terrainSettled, t, selectedFeatureKey],
  );

  return (
    <>
      {surfaces}
      {safetyZones}
      {airportBoundary}
      {obstacles}
      {bufferZones}
      {aglSystems}
    </>
  );
}
