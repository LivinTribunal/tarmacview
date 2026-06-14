import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Minus } from "lucide-react";
import type maplibregl from "maplibre-gl";
import {
  MAP_BEARING_RESET_DURATION_MS,
  MAP_ZOOM_TICK_DURATION_MS,
} from "@/constants/mapAnimations";

export interface MapViewportControlsProps {
  mapRef: RefObject<maplibregl.Map | null>;
  cesiumViewerRef: RefObject<import("cesium").Viewer | null>;
  is3D: boolean;
  bearing: number;
  showCompass: boolean;
  showZoomControls: boolean;
}

/** right-side compass dial + zoom-in/-out cluster overlay for AirportMap. */
export default function MapViewportControls({
  mapRef,
  cesiumViewerRef,
  is3D,
  bearing,
  showCompass,
  showZoomControls,
}: MapViewportControlsProps) {
  const { t } = useTranslation();

  if (!showCompass && !showZoomControls) return null;

  function handleCompassClick() {
    if (is3D && cesiumViewerRef.current && !cesiumViewerRef.current.isDestroyed()) {
      // Camera.flyTo cancels the flight when destination equals
      // the current position, so the orientation-only reset never
      // ran. setView is instant and reliable.
      const cam = cesiumViewerRef.current.camera;
      cam.setView({
        destination: cam.positionWC,
        orientation: { heading: 0, pitch: cam.pitch, roll: 0 },
      });
    } else {
      const map = mapRef.current;
      if (map) map.easeTo({ bearing: 0, duration: MAP_BEARING_RESET_DURATION_MS });
    }
  }

  function handleZoomIn() {
    const map = mapRef.current;
    if (map) map.zoomTo(map.getZoom() + 1, { duration: MAP_ZOOM_TICK_DURATION_MS });
  }

  function handleZoomOut() {
    const map = mapRef.current;
    if (map) map.zoomTo(map.getZoom() - 1, { duration: MAP_ZOOM_TICK_DURATION_MS });
  }

  return (
    <div className="absolute right-3 z-20 flex flex-col items-center gap-1.5" style={{ bottom: "60px" }}>
      {showCompass && (
        <button
          type="button"
          onClick={handleCompassClick}
          title={t("map.resetNorth")}
          className="relative flex items-center justify-center w-11 h-11 rounded-full border border-tv-border bg-tv-surface hover:bg-tv-surface-hover transition-colors"
          data-testid="compass-btn"
        >
          {/* rotating compass dial */}
          <svg
            className="w-9 h-9"
            viewBox="0 0 36 36"
            style={{ transform: `rotate(${-bearing}deg)` }}
          >
            {/* N marker - red */}
            <text x="18" y="7" textAnchor="middle" dominantBaseline="middle" fill="#e54545" fontSize="7" fontWeight="bold">N</text>
            {/* S marker */}
            <text x="18" y="31" textAnchor="middle" dominantBaseline="middle" fill="var(--tv-text-muted)" fontSize="6">S</text>
            {/* E marker */}
            <text x="31" y="18.5" textAnchor="middle" dominantBaseline="middle" fill="var(--tv-text-muted)" fontSize="6">E</text>
            {/* W marker */}
            <text x="5" y="18.5" textAnchor="middle" dominantBaseline="middle" fill="var(--tv-text-muted)" fontSize="6">W</text>
            {/* needle - north half red, south half white */}
            <polygon points="18,10 16.5,18 19.5,18" fill="#e54545" />
            <polygon points="18,26 16.5,18 19.5,18" fill="var(--tv-text-muted)" />
          </svg>
        </button>
      )}
      {showZoomControls && (
        <div className="flex flex-col rounded-full border border-tv-border bg-tv-surface overflow-hidden">
          <button
            type="button"
            onClick={handleZoomIn}
            title={t("map.zoomIn")}
            className="flex items-center justify-center w-8 h-8 text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
            data-testid="zoom-in-btn"
          >
            <Plus className="h-4 w-4" />
          </button>
          <div className="h-px bg-tv-border" />
          <button
            type="button"
            onClick={handleZoomOut}
            title={t("map.zoomOut")}
            className="flex items-center justify-center w-8 h-8 text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
            data-testid="zoom-out-btn"
          >
            <Minus className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
