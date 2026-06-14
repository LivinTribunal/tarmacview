import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useNavigate } from "react-router";
import AirportMap from "@/components/map/AirportMap";
import TerrainToggle from "@/components/map/overlays/TerrainToggle";
import PoiInfoPanel from "@/components/map/overlays/PoiInfoPanel";
import type { AirportDetailResponse } from "@/types/airport";
import type { MapFeature } from "@/types/map";
import type { MissionDetailResponse } from "@/types/mission";
import type {
  FlightPlanResponse,
  ValidationViolation,
} from "@/types/flightPlan";

interface ValidationMapPanelProps {
  airportDetail: AirportDetailResponse | null;
  mission: MissionDetailResponse;
  flightPlan: FlightPlanResponse | null;
  inspectionIndexMap: Record<string, number> | undefined;
  selectedWarning: ValidationViolation | null;
  onWarningClose: () => void;
  selectedWaypointId: string | null;
  onWaypointClick: (id: string | null) => void;
  selectedFeature: MapFeature | null;
  onFeatureClick: (feature: MapFeature | null) => void;
  terrainMode: "map" | "satellite";
  onTerrainChange: (mode: "map" | "satellite") => void;
  is3D: boolean;
  onToggle3D: (next: boolean) => void;
  missionId: string;
}

/** map preview pane (with 2D/3D + terrain toggles) for the validation page. */
export default function ValidationMapPanel({
  airportDetail,
  mission,
  flightPlan,
  inspectionIndexMap,
  selectedWarning,
  onWarningClose,
  selectedWaypointId,
  onWaypointClick,
  selectedFeature,
  onFeatureClick,
  terrainMode,
  onTerrainChange,
  is3D,
  onToggle3D,
  missionId,
}: ValidationMapPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const poiPanel = useMemo(
    () =>
      selectedFeature ? (
        <PoiInfoPanel feature={selectedFeature} onClose={() => onFeatureClick(null)} />
      ) : undefined,
    [selectedFeature, onFeatureClick],
  );

  if (!airportDetail) {
    return (
      <div className="flex-1 flex items-center justify-center bg-tv-surface rounded-2xl border border-tv-border">
        <Loader2 className="h-6 w-6 animate-spin text-tv-accent" />
      </div>
    );
  }

  return (
    <div className="flex-1 relative rounded-2xl overflow-hidden border border-tv-border">
      <AirportMap
        airport={airportDetail}
        helpVariant="preview"
        terrainMode={terrainMode}
        onTerrainChange={onTerrainChange}
        showTerrainToggle={false}
        showWaypointList={false}
        showPoiInfo={false}
        leftPanelChildren={poiPanel}
        simplifiedTrajectory
        is3D={is3D}
        onToggle3D={onToggle3D}
        layers={{
          simplifiedTrajectory: true,
          trajectory: false,
          transitWaypoints: false,
          measurementWaypoints: false,
          path: false,
          takeoffLanding: !!(
            mission.takeoff_coordinate || mission.landing_coordinate
          ),
          cameraHeading: false,
          pathHeading: false,
        }}
        waypoints={flightPlan?.waypoints ?? []}
        selectedWaypointId={selectedWaypointId}
        onWaypointClick={onWaypointClick}
        missionStatus={mission.status}
        flightPlanScope={mission.flight_plan_scope}
        takeoffCoordinate={mission.takeoff_coordinate}
        landingCoordinate={mission.landing_coordinate}
        inspectionIndexMap={inspectionIndexMap}
        onFeatureClick={onFeatureClick}
        focusFeature={selectedFeature}
        highlightedWaypointIds={selectedWarning?.waypoint_ids}
        highlightSeverity={selectedWarning?.severity}
        selectedWarning={selectedWarning}
        onWarningClose={onWarningClose}
      />

      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(`/operator-center/missions/${missionId}/map`)}
          className="px-4 py-2.5 rounded-full text-sm font-semibold border border-tv-border bg-tv-surface text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
          data-testid="open-map-btn"
        >
          {t("mission.validationExportPage.openMap")}
        </button>
        <div className="flex rounded-full border border-tv-border bg-tv-surface p-1">
          <button
            type="button"
            onClick={() => onToggle3D(false)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              !is3D
                ? "bg-tv-accent text-tv-accent-text"
                : "text-tv-text-secondary"
            }`}
          >
            {t("common.2d")}
          </button>
          <button
            type="button"
            onClick={() => onToggle3D(true)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              is3D
                ? "bg-tv-accent text-tv-accent-text"
                : "text-tv-text-secondary"
            }`}
          >
            {t("common.3d")}
          </button>
        </div>
        <TerrainToggle
          mode={terrainMode}
          onToggle={onTerrainChange}
          inline
        />
      </div>
    </div>
  );
}
