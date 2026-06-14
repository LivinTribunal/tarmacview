import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { Viewer as CesiumViewerType } from "cesium";
import type { AirportDetailResponse } from "@/types/airport";
import type {
  MapLayerConfig,
  MapFeature,
  FlyAlongState,
} from "@/types/map";
import type { WaypointResponse } from "@/types/flightPlan";
import type { PointZ } from "@/types/common";
import type { FlightPlanScope } from "@/types/enums";

const LazyCesiumMapViewer = lazy(() => import("./CesiumMapViewer"));

export interface Cesium3DOverlayProps {
  cesiumLoaded: boolean;
  is3D: boolean;
  airport: AirportDetailResponse;
  layers: MapLayerConfig;
  waypoints?: WaypointResponse[];
  selectedWaypointId?: string | null;
  takeoffCoordinate?: PointZ | null;
  landingCoordinate?: PointZ | null;
  flightPlanScope?: FlightPlanScope | null;
  visibleInspectionIds?: Set<string>;
  inspectionIndexMap?: Record<string, number>;
  terrainMode: "map" | "satellite";
  onFeatureClick: (feature: MapFeature | null) => void;
  onWaypointClick?: (id: string | null) => void;
  onBearingChange: (bearing: number) => void;
  onViewerReady: (viewer: CesiumViewerType) => void;
  focusFeature?: MapFeature | null;
  highlightedWaypointIds?: string[] | null;
  flyAlongState?: FlyAlongState | null;
  flyAlongModelUrl?: string;
  flyAlongSegmentDurations?: number[];
  flyAlongSetProgress?: (progress: number) => void;
  flyAlongOnComplete?: () => void;
}

/** lazy-loaded 3d cesium viewer overlay; rendered when cesiumLoaded, hidden via display:none in 2d. */
export default function Cesium3DOverlay({
  cesiumLoaded,
  is3D,
  airport,
  layers,
  waypoints,
  selectedWaypointId,
  takeoffCoordinate,
  landingCoordinate,
  flightPlanScope,
  visibleInspectionIds,
  inspectionIndexMap,
  terrainMode,
  onFeatureClick,
  onWaypointClick,
  onBearingChange,
  onViewerReady,
  focusFeature,
  highlightedWaypointIds,
  flyAlongState,
  flyAlongModelUrl,
  flyAlongSegmentDurations,
  flyAlongSetProgress,
  flyAlongOnComplete,
}: Cesium3DOverlayProps) {
  const { t } = useTranslation();

  if (!cesiumLoaded) return null;

  return (
    <div className="absolute inset-0" style={{ display: is3D ? "block" : "none" }}>
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-full w-full text-tv-text-secondary text-sm">
            {t("map.loading3d")}
          </div>
        }
      >
        <LazyCesiumMapViewer
          airport={airport}
          layers={layers}
          waypoints={waypoints}
          selectedWaypointId={selectedWaypointId}
          takeoffCoordinate={takeoffCoordinate}
          landingCoordinate={landingCoordinate}
          flightPlanScope={flightPlanScope}
          visibleInspectionIds={visibleInspectionIds}
          inspectionIndexMap={inspectionIndexMap}
          terrainMode={terrainMode}
          onFeatureClick={onFeatureClick}
          onWaypointClick={onWaypointClick}
          onBearingChange={onBearingChange}
          onViewerReady={onViewerReady}
          focusFeature={focusFeature}
          highlightedWaypointIds={highlightedWaypointIds}
          flyAlongState={flyAlongState}
          flyAlongModelUrl={flyAlongModelUrl}
          flyAlongSegmentDurations={flyAlongSegmentDurations}
          flyAlongSetProgress={flyAlongSetProgress}
          flyAlongOnComplete={flyAlongOnComplete}
        />
      </Suspense>
    </div>
  );
}
