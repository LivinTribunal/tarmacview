import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useAirport } from "@/contexts/AirportContext";
import type { MapFeature, MapLayerConfig } from "@/types/map";
import { DEFAULT_LAYER_CONFIG } from "@/types/map";
import AirportMap, { type AirportMapHandle } from "@/components/map/AirportMap";
import LegendPanel from "@/components/map/overlays/LegendPanel";
import PoiInfoPanel from "@/components/map/overlays/PoiInfoPanel";
import GroundSurfacesPanel from "@/components/map/overlays/GroundSurfacesPanel";
import ObstaclesPanel from "@/components/map/overlays/ObstaclesPanel";
import SafetyZonesPanel from "@/components/map/overlays/SafetyZonesPanel";
import AGLPanel from "@/components/map/overlays/AGLPanel";
import TerrainToggle from "@/components/map/overlays/TerrainToggle";
import AirportInfoPanel from "@/components/map/overlays/AirportInfoPanel";

/** read-only airport infrastructure viewer with full-screen map. */
export default function AirportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    selectedAirport,
    airportDetail,
    airportDetailLoading,
    airportDetailError,
    refreshAirportDetail,
  } = useAirport();

  const [selectedFeature, setSelectedFeature] = useState<MapFeature | null>(null);
  const mapHandleRef = useRef<AirportMapHandle>(null);
  const [layerConfig, setLayerConfig] = useState<MapLayerConfig>(DEFAULT_LAYER_CONFIG);
  const [terrainMode, setTerrainMode] = useState<"map" | "satellite">("satellite");
  const [is3D, setIs3D] = useState(false);

  // redirect to dashboard if no airport selected
  useEffect(() => {
    if (!selectedAirport) {
      navigate("/operator-center", { replace: true });
    }
  }, [selectedAirport, navigate]);

  const handleFeatureClick = useCallback((feature: MapFeature | null) => {
    /** set selected feature when clicked on map or list panel. */
    setSelectedFeature(feature);
  }, []);

  const handleFeatureLocate = useCallback((feature: MapFeature) => {
    /** double-click intent: select and recenter via the active map (2d or 3d). */
    setSelectedFeature(feature);
    mapHandleRef.current?.locateFeature(feature);
  }, []);

  const handleLayerChange = useCallback((layers: MapLayerConfig) => {
    /** sync layer config from map component. */
    setLayerConfig(layers);
  }, []);


  const surfaces = useMemo(
    () => airportDetail?.surfaces ?? [],
    [airportDetail],
  );
  const obstacles = useMemo(
    () => airportDetail?.obstacles ?? [],
    [airportDetail],
  );
  const safetyZones = useMemo(
    () => airportDetail?.safety_zones ?? [],
    [airportDetail],
  );

  const leftPanelChildren = useMemo(
    () => (
      <>
        <GroundSurfacesPanel
          surfaces={surfaces}
          layerConfig={layerConfig}
          onSelect={handleFeatureClick}
          onLocate={handleFeatureLocate}
        />
        <ObstaclesPanel
          obstacles={obstacles}
          layerConfig={layerConfig}
          onSelect={handleFeatureClick}
          onLocate={handleFeatureLocate}
        />
        <SafetyZonesPanel
          safetyZones={safetyZones}
          layerConfig={layerConfig}
          onSelect={handleFeatureClick}
          onLocate={handleFeatureLocate}
        />
        <AGLPanel
          surfaces={surfaces}
          layerConfig={layerConfig}
          onSelect={handleFeatureClick}
          onLocate={handleFeatureLocate}
        />
        {selectedFeature && (
          <PoiInfoPanel
            feature={selectedFeature}
            onClose={() => setSelectedFeature(null)}
          />
        )}
      </>
    ),
    [
      surfaces,
      obstacles,
      safetyZones,
      layerConfig,
      handleFeatureClick,
      handleFeatureLocate,
      selectedFeature,
    ],
  );

  if (!selectedAirport) return null;

  if (airportDetailLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-tv-bg">
        <Loader2 className="h-6 w-6 animate-spin text-tv-accent" />
      </div>
    );
  }

  if (airportDetailError || !airportDetail) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-tv-bg gap-3">
        <p className="text-sm text-tv-error">{t("common.error")}</p>
        <button
          type="button"
          onClick={refreshAirportDetail}
          className="px-4 py-2 rounded-full text-sm font-semibold bg-tv-accent text-tv-accent-text hover:bg-tv-accent-hover transition-colors"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-full px-4 py-3"
      data-testid="airport-page"
    >
      <AirportMap
        ref={mapHandleRef}
        airport={airportDetail}
        interactive={true}
        showLayerPanel={true}
        showLegend={false}
        showPoiInfo={false}
        showWaypointList={false}
        helpVariant="preview"
        terrainMode={terrainMode}
        onTerrainChange={setTerrainMode}
        onFeatureClick={handleFeatureClick}
        onLayerChange={handleLayerChange}
        focusFeature={selectedFeature}
        is3D={is3D}
        onToggle3D={setIs3D}
        leftPanelChildren={leftPanelChildren}
      >
        {/* right side: legend panel */}
        <div
          className="absolute top-3 right-3 bottom-[60px] z-10 w-56 flex flex-col gap-2 overflow-y-auto pr-1"
          style={{ scrollbarGutter: "stable" }}
        >
          <LegendPanel
            layers={layerConfig}
            className="w-full rounded-2xl border border-tv-border bg-tv-bg flex-shrink-0"
          />
          {airportDetail && (
            <AirportInfoPanel
              airport={airportDetail}
              className="w-full rounded-2xl border border-tv-border bg-tv-bg flex-shrink-0"
            />
          )}
        </div>
        {/* bottom-right: 2D/3D + terrain toggle */}
        <div className="absolute bottom-2 right-2 z-10 flex items-center gap-2">
          <div className="flex rounded-full border border-tv-border bg-tv-surface p-1">
            <button
              type="button"
              onClick={() => setIs3D(false)}
              title={t("map.toggle2d")}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                !is3D ? "bg-tv-accent text-tv-accent-text" : "text-tv-text-secondary hover:text-tv-text-primary"
              }`}
            >
              2D
            </button>
            <button
              type="button"
              onClick={() => setIs3D(true)}
              title={t("map.toggle3d")}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                is3D ? "bg-tv-accent text-tv-accent-text" : "text-tv-text-secondary hover:text-tv-text-primary"
              }`}
            >
              3D
            </button>
          </div>
          <TerrainToggle mode={terrainMode} onToggle={setTerrainMode} inline />
        </div>
      </AirportMap>
    </div>
  );
}
