import { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAirport } from "@/contexts/AirportContext";
import { useMission } from "@/contexts/MissionContext";
import { useDroneProfiles } from "@/api/queries/droneProfiles";
import Button from "@/components/common/Button";
import AirportMap from "@/components/map/AirportMap";
import TerrainToggle from "@/components/map/overlays/TerrainToggle";
import type { MapFeature } from "@/types/map";
import CreateMissionDialog from "@/components/mission/CreateMissionDialog";
import AirportSelectionView from "@/components/operator/dashboard/AirportSelectionView";
import MissionListSection from "@/components/operator/dashboard/MissionListSection";
import StatisticsSection from "@/components/operator/dashboard/StatisticsSection";
import DroneProfilesSection from "@/components/operator/dashboard/DroneProfilesSection";
import Spinner from "@/components/operator/dashboard/Spinner";

function DashboardView() {
  const { t } = useTranslation();
  const {
    selectedAirport,
    airportDetail,
    airportDetailLoading,
    airportDetailError,
    refreshAirportDetail,
  } = useAirport();
  const {
    missions,
    missionsLoading,
    refreshMissions,
  } = useMission();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const [missionsError, setMissionsError] = useState(false);
  const { data: droneData, isLoading: droneProfilesLoading, isError: droneProfilesError } = useDroneProfiles();
  const droneProfiles = droneData?.data ?? [];
  const [terrainMode, setTerrainMode] = useState<"map" | "satellite">("satellite");
  const [is3D, setIs3D] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState<MapFeature | null>(null);

  const fetchMissions = useCallback(() => {
    /** refresh missions and track the error state. */
    setMissionsError(false);
    refreshMissions().catch(() => setMissionsError(true));
  }, [refreshMissions]);

  const newMissionButton = useMemo(
    () => (
      <Button
        onClick={() => setShowCreateDialog(true)}
        data-testid="new-mission-btn"
        className="!h-8 !px-3 !text-xs"
      >
        {t("dashboard.newMission")}
      </Button>
    ),
    [t],
  );

  if (!selectedAirport) return null;

  return (
    <div className="flex p-4 h-full">
      {/* left panel - 30% */}
      <div className="w-[30%] flex-shrink-0 flex">
        <div className="flex-1 overflow-y-auto flex flex-col gap-4 pr-4">
          <MissionListSection
            missions={missions}
            loading={missionsLoading}
            error={missionsError}
            onRetry={fetchMissions}
            onRefresh={fetchMissions}
            droneProfiles={droneProfiles}
            headerRight={newMissionButton}
          />

          <StatisticsSection missions={missions} />
          <DroneProfilesSection profiles={droneProfiles} loading={droneProfilesLoading} error={droneProfilesError} missions={missions} defaultDroneProfileId={selectedAirport?.default_drone_profile_id} />
        </div>
        <div className="w-2.5 flex-shrink-0" />
      </div>

      {/* right panel - 70% */}
      <div className="flex-1">
        {airportDetailLoading ? (
          <div
            className="h-full rounded-2xl flex items-center justify-center"
            style={{ backgroundColor: "var(--tv-map-bg)" }}
          >
            <Spinner />
          </div>
        ) : airportDetailError ? (
          <div
            className="h-full rounded-2xl flex flex-col items-center justify-center gap-3"
            style={{ backgroundColor: "var(--tv-map-bg)" }}
            data-testid="map-error"
          >
            <p className="text-sm text-tv-error">{t("common.error")}</p>
            <Button variant="secondary" onClick={refreshAirportDetail}>
              {t("common.retry")}
            </Button>
          </div>
        ) : airportDetail ? (
          <div className="relative h-full">
            <AirportMap
              airport={airportDetail}
              terrainMode={terrainMode}
              onTerrainChange={setTerrainMode}
              is3D={is3D}
              onToggle3D={setIs3D}
              onFeatureClick={setSelectedFeature}
              focusFeature={selectedFeature}
              helpVariant="preview"
            />
            <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2">
              <div className="flex rounded-full border border-tv-border bg-tv-surface p-1">
                <button
                  type="button"
                  onClick={() => setIs3D(false)}
                  className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                    !is3D ? "bg-tv-accent text-tv-accent-text" : "text-tv-text-secondary"
                  }`}
                >
                  2D
                </button>
                <button
                  type="button"
                  onClick={() => setIs3D(true)}
                  className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                    is3D ? "bg-tv-accent text-tv-accent-text" : "text-tv-text-secondary"
                  }`}
                >
                  3D
                </button>
              </div>
              <TerrainToggle mode={terrainMode} onToggle={setTerrainMode} inline />
            </div>
          </div>
        ) : (
          <div
            className="h-full rounded-2xl flex items-center justify-center"
            style={{ backgroundColor: "var(--tv-map-bg)" }}
          >
            <Spinner />
          </div>
        )}
      </div>

      <CreateMissionDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        airportId={selectedAirport.id}
        defaultDroneProfileId={selectedAirport.default_drone_profile_id}
      />
    </div>
  );
}

export default function DashboardPage() {
  const { selectedAirport } = useAirport();

  if (!selectedAirport) {
    return <AirportSelectionView />;
  }

  return <DashboardView />;
}
