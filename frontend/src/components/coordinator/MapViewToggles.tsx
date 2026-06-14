interface MapViewTogglesProps {
  t: (key: string, opts?: Record<string, unknown>) => string;
  is3D: boolean;
  onSet3D: (value: boolean) => void;
  terrainMode: "map" | "satellite";
  onSetTerrainMode: (mode: "map" | "satellite") => void;
}

/** 2d/3d and map/satellite view toggle groups for the airport editor. */
export default function MapViewToggles({
  t,
  is3D,
  onSet3D,
  terrainMode,
  onSetTerrainMode,
}: MapViewTogglesProps) {
  return (
    <>
      {/* 2D/3D toggle */}
      <div className="flex items-center rounded-full border border-tv-border bg-tv-bg px-1 py-1">
        <button
          type="button"
          onClick={() => onSet3D(false)}
          title={t("map.tools.2d")}
          className={`flex items-center justify-center rounded-full h-9 px-3 text-xs font-medium transition-colors ${
            !is3D ? "bg-tv-accent text-tv-accent-text" : "text-tv-text-secondary hover:bg-tv-surface-hover"
          }`}
          data-testid="toggle-2d"
        >
          2D
        </button>
        <button
          type="button"
          onClick={() => onSet3D(true)}
          title={t("map.tools.3d")}
          className={`flex items-center justify-center rounded-full h-9 px-3 text-xs font-medium transition-colors ${
            is3D ? "bg-tv-accent text-tv-accent-text" : "text-tv-text-secondary hover:bg-tv-surface-hover"
          }`}
          data-testid="toggle-3d"
        >
          3D
        </button>
      </div>

      {/* map/satellite toggle */}
      <div className="flex items-center rounded-full border border-tv-border bg-tv-bg px-1 py-1">
        <button
          type="button"
          onClick={() => onSetTerrainMode("map")}
          className={`flex items-center justify-center rounded-full h-9 px-3 text-xs font-medium transition-colors ${
            terrainMode === "map" ? "bg-tv-accent text-tv-accent-text" : "text-tv-text-secondary hover:bg-tv-surface-hover"
          }`}
          data-testid="toggle-map"
        >
          {t("dashboard.mapView")}
        </button>
        <button
          type="button"
          onClick={() => onSetTerrainMode("satellite")}
          className={`flex items-center justify-center rounded-full h-9 px-3 text-xs font-medium transition-colors ${
            terrainMode === "satellite" ? "bg-tv-accent text-tv-accent-text" : "text-tv-text-secondary hover:bg-tv-surface-hover"
          }`}
          data-testid="toggle-satellite"
        >
          {t("dashboard.satelliteView")}
        </button>
      </div>
    </>
  );
}
