import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate, useOutletContext } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useAirport } from "@/contexts/AirportContext";
import useMissionValidation from "@/hooks/useMissionValidation";
import ValidationResultsPanel from "@/components/mission/ValidationResultsPanel";
import WarningsPanel from "@/components/mission/WarningsPanel";
import StatsPanel from "@/components/mission/StatsPanel";
import ExportPanel from "@/components/mission/ExportPanel";
import UploadDroneMediaDialog from "@/components/mission/UploadDroneMediaDialog";
import ValidationMapPanel from "@/components/mission/ValidationMapPanel";
import type { MissionTabOutletContext } from "@/components/Layout/MissionTabNav";
import type { ValidationViolation } from "@/types/flightPlan";
import type { MapFeature } from "@/types/map";

/** mission validation and export page with map preview and lifecycle actions. */
export default function MissionValidationPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { airportDetail } = useAirport();
  const {
    setSaveContext,
    setComputeContext,
    refreshMissions,
    updateMissionFromPage,
    leftPanelEl,
  } = useOutletContext<MissionTabOutletContext>();

  const v = useMissionValidation({
    id,
    onMissionUpdated: updateMissionFromPage,
    refreshMissions,
  });
  const {
    mission,
    flightPlan,
    warnings,
    droneProfiles,
    isInitialLoad,
    error,
    isValidating,
    isExporting,
    notification,
    inspectionIndexMap,
    clampWarning,
    dismissClampWarning,
    fetchData,
    handleValidate,
    handleExport,
    handleComplete,
    handleCancel,
    handleDelete,
    isDownloadingReport,
    handleDownloadReport,
  } = v;

  const [terrainMode, setTerrainMode] = useState<"map" | "satellite">(
    "satellite",
  );
  const [is3D, setIs3D] = useState(false);
  const [selectedWarning, setSelectedWarning] =
    useState<ValidationViolation | null>(null);
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(
    null,
  );
  const [selectedFeature, setSelectedFeature] = useState<MapFeature | null>(
    null,
  );
  const [isMediaDialogOpen, setIsMediaDialogOpen] = useState(false);

  // wire up disabled save button
  useEffect(() => {
    setSaveContext({
      onSave: () => {},
      isDirty: false,
      isSaving: false,
      lastSaved: mission?.updated_at ? new Date(mission.updated_at) : null,
    });
    return () => {
      setSaveContext({
        onSave: null,
        isDirty: false,
        isSaving: false,
        lastSaved: null,
      });
    };
  }, [setSaveContext, mission]);

  // upload drone media button in header opens the media dialog
  useEffect(() => {
    setComputeContext({
      onCompute: () => setIsMediaDialogOpen(true),
      canCompute: true,
      isComputing: false,
      label: t("mission.validationExportPage.uploadDroneMedia"),
      variant: "secondary",
      icon: "upload",
    });
    return () => {
      setComputeContext({
        onCompute: null,
        canCompute: false,
        isComputing: false,
      });
    };
  }, [setComputeContext, t]);

  if (isInitialLoad) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-tv-accent" />
      </div>
    );
  }

  if (error || !mission) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <p className="text-sm text-tv-error">{error ?? t("common.error")}</p>
        <button
          type="button"
          onClick={fetchData}
          className="px-4 py-2 rounded-full text-sm font-semibold bg-tv-accent text-tv-accent-text hover:bg-tv-accent-hover transition-colors"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  async function onDelete() {
    const ok = await handleDelete();
    if (ok) navigate("/operator-center/missions");
  }

  return (
    <>
      {notification && (
        <div className="fixed top-4 right-4 z-50 px-4 py-2.5 rounded-full bg-tv-error text-white text-sm font-semibold">
          {notification}
        </div>
      )}

      <UploadDroneMediaDialog
        isOpen={isMediaDialogOpen}
        onClose={() => setIsMediaDialogOpen(false)}
        missionId={mission.id}
      />

      {leftPanelEl &&
        createPortal(
          <>
            <div className="bg-tv-surface border border-tv-border rounded-2xl p-4">
              <ValidationResultsPanel
                flightPlan={flightPlan}
                missionStatus={mission.status}
                onValidate={handleValidate}
                onNavigateConfig={() =>
                  navigate(`/operator-center/missions/${id}/configuration`)
                }
                isValidating={isValidating}
              />
            </div>

            <div className="bg-tv-surface border border-tv-border rounded-2xl p-4">
              <WarningsPanel
                warnings={warnings}
                hasTrajectory={flightPlan !== null}
                onWarningClick={setSelectedWarning}
                selectedWarningId={selectedWarning?.id}
              />
            </div>
          </>,
          leftPanelEl,
        )}

      <div
        className="flex h-full gap-4"
        data-testid="mission-validation-page"
      >
        <div className="flex-1 flex flex-col gap-3 min-w-0">
          <ValidationMapPanel
            airportDetail={airportDetail}
            mission={mission}
            flightPlan={flightPlan}
            inspectionIndexMap={inspectionIndexMap}
            selectedWarning={selectedWarning}
            onWarningClose={() => setSelectedWarning(null)}
            selectedWaypointId={selectedWaypointId}
            onWaypointClick={setSelectedWaypointId}
            selectedFeature={selectedFeature}
            onFeatureClick={setSelectedFeature}
            terrainMode={terrainMode}
            onTerrainChange={setTerrainMode}
            is3D={is3D}
            onToggle3D={setIs3D}
            missionId={id ?? ""}
          />
        </div>

        <div className="w-[540px] flex-shrink-0">
          <div
            className="overflow-y-auto h-full flex flex-col gap-4"
            style={{ scrollbarGutter: "stable" }}
          >
            <ExportPanel
              mission={mission}
              droneProfiles={droneProfiles}
              onExport={handleExport}
              onComplete={handleComplete}
              onCancel={handleCancel}
              onDelete={onDelete}
              isExporting={isExporting}
              onDownloadReport={handleDownloadReport}
              isDownloadingReport={isDownloadingReport}
              hasFlightPlan={flightPlan !== null}
              clampWarning={clampWarning}
              onDismissClampWarning={dismissClampWarning}
              onDispatched={fetchData}
              onViewResults={() => navigate("/operator-center/measurements")}
              statsSlot={
                <div className="bg-tv-surface border border-tv-border rounded-2xl p-4">
                  <StatsPanel
                    flightPlan={flightPlan}
                    hasTrajectory={flightPlan !== null}
                    droneProfile={
                      droneProfiles.find(
                        (dp) => dp.id === mission.drone_profile_id,
                      ) ?? null
                    }
                  />
                </div>
              }
            />
          </div>
        </div>
      </div>
    </>
  );
}
