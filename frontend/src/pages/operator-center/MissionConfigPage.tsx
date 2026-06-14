import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate, useOutletContext } from "react-router";
import { useTranslation } from "react-i18next";
import { isAxiosError } from "@/api/client";
import { Loader2 } from "lucide-react";
import { useAirport } from "@/contexts/AirportContext";
import { useComputation } from "@/contexts/ComputationContext";
import { useOnComputationCompleted } from "@/hooks/useOnComputationCompleted";
import { getMission, getFlightPlan } from "@/api/missions";
import { listDroneProfiles } from "@/api/droneProfiles";
import { listInspectionTemplates } from "@/api/inspectionTemplates";
import type { MissionDetailResponse } from "@/types/mission";
import type { DroneProfileResponse } from "@/types/droneProfile";
import type { InspectionTemplateResponse } from "@/types/inspectionTemplate";
import type { FlightPlanResponse, ValidationViolation } from "@/types/flightPlan";
import type { MissionTabOutletContext } from "@/components/Layout/MissionTabNav";
import InspectionList from "@/components/mission/InspectionList";
import TemplatePicker from "@/components/mission/TemplatePicker";
import MissionConfigForm from "@/components/mission/MissionConfigForm";
import InspectionConfigForm from "@/components/mission/InspectionConfigForm";
import WarningsPanel from "@/components/mission/WarningsPanel";
import StatsPanel from "@/components/mission/StatsPanel";
import AirportMap from "@/components/map/AirportMap";
import TerrainToggle from "@/components/map/overlays/TerrainToggle";
import Modal from "@/components/common/Modal";
import type { MapFeature } from "@/types/map";
import useInspectionEditing from "@/hooks/useInspectionEditing";
import useMissionSave from "@/hooks/useMissionSave";
import useTakeoffLandingPicker from "@/hooks/useTakeoffLandingPicker";
import { STATUS_ORDER, TERMINAL_STATUSES } from "@/constants/mission";
import { SLOW_NOTIFICATION_TIMEOUT_MS } from "@/constants/ui";

export default function MissionConfigPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { airportDetail } = useAirport();
  const { setSaveContext, setComputeContext, refreshMissions, updateMissionFromPage, leftPanelEl } =
    useOutletContext<MissionTabOutletContext>();
  const computation = useComputation();
  const { startComputation, isComputing } = computation;

  // core data
  const [mission, setMission] = useState<MissionDetailResponse | null>(null);
  const [droneProfiles, setDroneProfiles] = useState<DroneProfileResponse[]>(
    [],
  );
  const [templates, setTemplates] = useState<InspectionTemplateResponse[]>([]);
  const [flightPlan, setFlightPlan] = useState<FlightPlanResponse | null>(null);
  const [warnings, setWarnings] = useState<ValidationViolation[] | null>(null);

  // ui state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedInspectionId, setSelectedInspectionId] = useState<
    string | null
  >(null);
  const [visibleInspectionIds, setVisibleInspectionIds] = useState<Set<string>>(
    new Set(),
  );
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(
    null,
  );
  const [selectedFeature, setSelectedFeature] = useState<MapFeature | null>(null);
  const [selectedWarning, setSelectedWarning] = useState<ValidationViolation | null>(null);

  // terrain mode lifted from map for bottom bar toggle
  const [terrainMode, setTerrainMode] = useState<"map" | "satellite">(
    "satellite",
  );
  const [is3D, setIs3D] = useState(false);

  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const notificationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDraft = mission?.status === "DRAFT";
  const canModify = mission
    ? !TERMINAL_STATUSES.includes(mission.status)
    : false;

  const templateMap = useMemo(
    () => new Map(templates.map((t) => [t.id, t])),
    [templates],
  );

  // all AGLs from airport
  const allAgls = useMemo(() => {
    if (!airportDetail) return [];
    return airportDetail.surfaces.flatMap((s) => s.agls);
  }, [airportDetail]);

  // cleanup notification timer on unmount
  useEffect(() => {
    return () => {
      if (notificationTimer.current) clearTimeout(notificationTimer.current);
    };
  }, []);

  function showNotification(msg: string) {
    setNotification(msg);
    if (notificationTimer.current) clearTimeout(notificationTimer.current);
    notificationTimer.current = setTimeout(() => setNotification(null), SLOW_NOTIFICATION_TIMEOUT_MS);
  }

  const updateMissionState = useCallback(
    (fresh: MissionDetailResponse, previousStatus?: string) => {
      /** update local mission state, detect regression, and refresh nav. */
      if (previousStatus) {
        const oldIdx = STATUS_ORDER.indexOf(previousStatus);
        const newIdx = STATUS_ORDER.indexOf(fresh.status);
        if (newIdx < oldIdx) {
          showNotification(
            t("mission.config.statusRegressed", { status: fresh.status }),
          );
        }
      }
      setMission(fresh);
      updateMissionFromPage(fresh);
      refreshMissions();
    },
    [updateMissionFromPage, refreshMissions, t],
  );

  const {
    inspectionDirty,
    selectedLhas,
    lhaRules,
    restoreLhaSelectionsFromMission,
    handleInspectionConfigChange,
    handleToggleLha,
    handleSelectionForAglChange,
    handleLhaRulesChange,
    handleAddInspection,
    handleChangeMethod,
    handleRemoveInspection,
    handleReorder,
    setInspectionDirty,
  } = useInspectionEditing({
    id,
    mission,
    templateMap,
    allAgls,
    selectedInspectionId,
    setSelectedInspectionId,
    setVisibleInspectionIds,
    updateMissionState,
    setLastSaved,
    showNotification,
    t,
  });

  const {
    missionDirty,
    pendingNav,
    setPendingNav,
    handleMissionChange,
    confirmDiscard,
    handleEditWaypoints,
  } = useMissionSave({
    id,
    mission,
    inspectionDirty,
    setInspectionDirty,
    updateMissionState,
    lastSaved,
    setLastSaved,
    setSaveContext,
    navigate,
    showNotification,
    t,
  });

  const {
    pickingCoord,
    setPickingCoord,
    useTakeoffAsLanding,
    setUseTakeoffAsLanding,
    handleMapClick,
  } = useTakeoffLandingPicker({
    mission,
    missionDirty,
    airportDetail,
    handleMissionChange,
  });

  // selected drone profile
  const selectedDroneProfile = useMemo(() => {
    const dpId = missionDirty.drone_profile_id ?? mission?.drone_profile_id;
    return droneProfiles.find((dp) => dp.id === dpId) ?? null;
  }, [droneProfiles, missionDirty, mission]);

  // fetch mission data
  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [missionData, dpData, tplData] = await Promise.all([
        getMission(id),
        listDroneProfiles(),
        listInspectionTemplates(
          airportDetail ? { airport_id: airportDetail.id } : undefined,
        ),
      ]);
      setMission(missionData);
      setDroneProfiles(dpData.data);
      setTemplates(tplData.data);

      // initialize last saved from db timestamp
      if (missionData.updated_at) {
        setLastSaved(new Date(missionData.updated_at));
      } else if (missionData.created_at) {
        setLastSaved(new Date(missionData.created_at));
      }

      // set all inspections visible by default
      setVisibleInspectionIds(
        new Set(missionData.inspections.map((i) => i.id)),
      );

      restoreLhaSelectionsFromMission(missionData);

      // fetch existing flight plan
      try {
        const fp = await getFlightPlan(id);
        setFlightPlan(fp);

        // load warnings from existing flight plan
        const violations = fp.validation_result?.violations ?? [];
        setWarnings(violations.length > 0 ? violations : null);
      } catch (err) {
        if (!isAxiosError(err) || err.response?.status !== 404) throw err;
        setFlightPlan(null);
      }
    } catch (err) {
      console.error("mission load failed:", err instanceof Error ? err.message : String(err));
      setError(t("mission.config.loadError"));
    } finally {
      setLoading(false);
    }
  }, [id, airportDetail, t, restoreLhaSelectionsFromMission]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // compute coordinate availability from dirty state or mission data
  const hasCoordinates = useMemo(() => {
    const scope = missionDirty.flight_plan_scope ?? mission?.flight_plan_scope ?? "FULL";
    if (scope === "MEASUREMENTS_ONLY") return true;
    const takeoff = missionDirty.takeoff_coordinate !== undefined
      ? missionDirty.takeoff_coordinate
      : mission?.takeoff_coordinate;
    const landing = missionDirty.landing_coordinate !== undefined
      ? missionDirty.landing_coordinate
      : mission?.landing_coordinate;
    return !!(takeoff && landing);
  }, [missionDirty, mission]);

  useEffect(() => {
    setComputeContext({
      onCompute: id ? () => startComputation(id) : null,
      canCompute: isDraft && hasCoordinates,
      isComputing,
      ...(!hasCoordinates && isDraft
        ? { label: t("mission.config.setCoordinatesFirst"), tooltip: t("mission.config.setCoordinatesTooltip") }
        : {}),
    });

    return () => {
      setComputeContext({
        onCompute: null,
        canCompute: false,
        isComputing: false,
      });
    };
  }, [setComputeContext, isDraft, isComputing, startComputation, hasCoordinates, t, id]);

  useOnComputationCompleted((result) => {
    setFlightPlan(result);
    const violations = result.validation_result?.violations ?? [];
    setWarnings(violations.length > 0 ? violations : null);

    if (id) {
      getMission(id)
        .then((fresh) => updateMissionState(fresh))
        .catch((err) => console.warn("mission refresh failed", err));
    }
  });

  function handleToggleVisibility(inspId: string) {
    setVisibleInspectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(inspId)) {
        next.delete(inspId);
      } else {
        next.add(inspId);
      }
      return next;
    });
  }

  // current selected inspection
  const selectedInspection = useMemo(
    () => mission?.inspections.find((i) => i.id === selectedInspectionId),
    [mission, selectedInspectionId],
  );

  // inspection index map for waypoint labels
  const inspectionIndexMap = useMemo(() => {
    if (!mission) return undefined;
    const sorted = mission.inspections.slice().sort((a, b) => a.sequence_order - b.sequence_order);
    return Object.fromEntries(sorted.map((insp, i) => [insp.id, i + 1]));
  }, [mission]);

  const selectedTemplate = useMemo(
    () =>
      selectedInspection
        ? templateMap.get(selectedInspection.template_id) ?? null
        : null,
    [selectedInspection, templateMap],
  );

  const currentInspectionConfig = useMemo(() => {
    if (!selectedInspectionId) return {};
    return inspectionDirty[selectedInspectionId] ?? {};
  }, [selectedInspectionId, inspectionDirty]);

  const inspectionLhas = useMemo(() => {
    if (!selectedInspectionId) return new Set<string>();
    return selectedLhas[selectedInspectionId] ?? new Set<string>();
  }, [selectedInspectionId, selectedLhas]);

  // loading state
  if (loading) {
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
          onClick={() => {
            void fetchData();
          }}
          className="px-4 py-2 rounded-full text-sm font-semibold bg-tv-accent text-tv-accent-text hover:bg-tv-accent-hover transition-colors"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  const hasTrajectory = flightPlan !== null;

  const currentTakeoff = missionDirty.takeoff_coordinate !== undefined
    ? missionDirty.takeoff_coordinate
    : mission.takeoff_coordinate;
  const currentLanding = missionDirty.landing_coordinate !== undefined
    ? missionDirty.landing_coordinate
    : mission.landing_coordinate;

  return (
    <>
      {/* left panel content - portaled into MissionTabNav left column */}
      {leftPanelEl && createPortal(
        <>
          {/* inspection list */}
          <div className="bg-tv-surface border border-tv-border rounded-2xl p-4">
            <InspectionList
              inspections={mission.inspections}
              templates={templateMap}
              selectedId={selectedInspectionId}
              onSelect={setSelectedInspectionId}
              onReorder={handleReorder}
              onAdd={() => setShowTemplatePicker(true)}
              onRemove={handleRemoveInspection}
              isDraft={canModify}
              canReorder={canModify}
              visibleIds={visibleInspectionIds}
              onToggleVisibility={handleToggleVisibility}
              agls={allAgls}
              onChangeMethod={handleChangeMethod}
            />
          </div>

          {/* inspection config - only when selected */}
          {selectedInspection && selectedTemplate && (
            <div className="bg-tv-surface border border-tv-border rounded-2xl p-4">
              <InspectionConfigForm
                inspection={selectedInspection}
                template={selectedTemplate}
                agls={allAgls}
                surfaces={airportDetail?.surfaces ?? []}
                droneProfile={selectedDroneProfile}
                mission={mission}
                configOverride={currentInspectionConfig}
                onChange={handleInspectionConfigChange}
                selectedLhaIds={inspectionLhas}
                onToggleLha={(lhaId) => {
                  if (!selectedInspectionId) return;
                  handleToggleLha(selectedInspectionId, lhaId);
                }}
                onSelectionForAglChange={(aglId, lhaIds) => {
                  if (!selectedInspectionId) return;
                  handleSelectionForAglChange(selectedInspectionId, aglId, lhaIds);
                }}
                lhaSelectionRules={
                  selectedInspectionId ? lhaRules[selectedInspectionId] : undefined
                }
                onLhaSelectionRulesChange={(rules) => {
                  if (!selectedInspectionId) return;
                  handleLhaRulesChange(selectedInspectionId, rules);
                }}
                disabled={!canModify}
                directionBearing={
                  flightPlan?.inspection_stats.find(
                    (s) => s.inspection_id === selectedInspectionId,
                  )?.direction_bearing ?? null
                }
              />
            </div>
          )}

          {/* mission config */}
          <div className="bg-tv-surface border border-tv-border rounded-2xl p-4">
            <MissionConfigForm
              mission={mission}
              droneProfiles={droneProfiles}
              values={missionDirty}
              onChange={handleMissionChange}
              pickingCoord={pickingCoord}
              onPickCoord={setPickingCoord}
              defaultAltitude={airportDetail?.elevation ?? 0}
              disabled={!canModify}
              useTakeoffAsLanding={useTakeoffAsLanding}
              onUseTakeoffAsLandingChange={setUseTakeoffAsLanding}
            />
          </div>

          {/* warnings */}
          <div className="bg-tv-surface border border-tv-border rounded-2xl p-4">
            <WarningsPanel
              warnings={warnings}
              hasTrajectory={hasTrajectory}
              onWarningClick={setSelectedWarning}
              selectedWarningId={selectedWarning?.id}
            />
          </div>

          {/* stats */}
          <div className="bg-tv-surface border border-tv-border rounded-2xl p-4">
            <StatsPanel
              flightPlan={flightPlan}
              hasTrajectory={hasTrajectory}
              droneProfile={selectedDroneProfile}
            />
          </div>
        </>,
        leftPanelEl,
      )}

      {/* right panel - map */}
      <div className="flex flex-col h-full" data-testid="mission-config-page">
        {airportDetail ? (
          <div className={`flex-1 relative rounded-2xl overflow-hidden border border-tv-border ${pickingCoord ? "cursor-crosshair" : ""}`}>
            <AirportMap
              airport={airportDetail}
              helpVariant="preview"
              terrainMode={terrainMode}
              onTerrainChange={setTerrainMode}
              showTerrainToggle={false}
              is3D={is3D}
              onToggle3D={setIs3D}
              waypoints={flightPlan?.waypoints ?? []}
              selectedWaypointId={selectedWaypointId}
              onWaypointClick={setSelectedWaypointId}
              missionStatus={mission?.status}
              flightPlanScope={missionDirty.flight_plan_scope ?? mission?.flight_plan_scope}
              onMapClick={pickingCoord ? handleMapClick : undefined}
              takeoffCoordinate={currentTakeoff}
              landingCoordinate={currentLanding}
              inspectionIndexMap={inspectionIndexMap}
              visibleInspectionIds={visibleInspectionIds}
              onFeatureClick={setSelectedFeature}
              focusFeature={selectedFeature}
              highlightedWaypointIds={selectedWarning?.waypoint_ids}
              highlightSeverity={selectedWarning?.severity}
              highlightedInspectionId={selectedInspectionId}
              selectedWarning={selectedWarning}
              onWarningClose={() => setSelectedWarning(null)}
            >
              {/* feature info panel renders on the left inside AirportMap for all feature types */}

              {/* pick-on-map banner */}
              {pickingCoord && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-full bg-tv-accent text-tv-accent-text text-sm font-semibold">
                  {t("mission.config.pickingOnMap", {
                    field: pickingCoord === "takeoff"
                      ? t("mission.config.takeoffCoordinate")
                      : t("mission.config.landingCoordinate"),
                  })}
                </div>
              )}

              {/* stale trajectory warning */}
              {isDraft && hasTrajectory && (
                <div
                  className="absolute top-3 right-52 z-10 flex items-center gap-2 px-4 py-2 rounded-full border border-tv-warning bg-tv-bg text-tv-warning text-xs font-semibold"
                  data-testid="stale-trajectory-warning"
                >
                  <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {t("mission.config.staleTrajectory")}
                </div>
              )}

            </AirportMap>

            {/* bottom bar inside map */}
            <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2">
              <button
                type="button"
                onClick={handleEditWaypoints}
                className="px-4 py-2.5 rounded-full text-sm font-semibold border border-tv-border bg-tv-surface text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
                data-testid="edit-waypoints-btn"
              >
                {t("mission.config.editWaypoints")}
              </button>
              <div className="flex rounded-full border border-tv-border bg-tv-surface p-1">
                <button
                  type="button"
                  onClick={() => setIs3D(false)}
                  className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                    !is3D ? "bg-tv-accent text-tv-accent-text" : "text-tv-text-secondary"
                  }`}
                >
                  {t("common.2d")}
                </button>
                <button
                  type="button"
                  onClick={() => setIs3D(true)}
                  className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                    is3D ? "bg-tv-accent text-tv-accent-text" : "text-tv-text-secondary"
                  }`}
                >
                  {t("common.3d")}
                </button>
              </div>
              <TerrainToggle mode={terrainMode} onToggle={setTerrainMode} inline />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-tv-surface rounded-2xl border border-tv-border">
            <Loader2 className="h-6 w-6 animate-spin text-tv-accent" />
          </div>
        )}
      </div>

      {/* template picker modal */}
      <TemplatePicker
        isOpen={showTemplatePicker}
        onClose={() => setShowTemplatePicker(false)}
        templates={templates}
        onSelect={handleAddInspection}
        usedTemplateIds={new Set(mission.inspections.map((i) => i.template_id))}
        agls={allAgls}
        surfaces={airportDetail?.surfaces}
      />

      {/* unsaved changes dialog */}
      <Modal
        isOpen={pendingNav !== null}
        onClose={() => setPendingNav(null)}
        title={t("mission.config.unsavedChanges")}
      >
        <p className="text-sm text-tv-text-secondary mt-2">
          {t("mission.config.unsavedChangesBody")}
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={() => setPendingNav(null)}
            className="px-4 py-2 rounded-full text-sm font-semibold border border-tv-border text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
          >
            {t("mission.config.keepEditing")}
          </button>
          <button
            type="button"
            onClick={confirmDiscard}
            className="px-4 py-2 rounded-full text-sm font-semibold bg-tv-error text-white hover:opacity-90 transition-colors"
            data-testid="discard-changes-btn"
          >
            {t("mission.config.discardChanges")}
          </button>
        </div>
      </Modal>

      {/* notification toast */}
      {notification && (
        <div
          className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl bg-tv-surface border border-tv-border text-sm text-tv-text-primary"
          data-testid="notification-toast"
        >
          {notification}
        </div>
      )}
    </>
  );
}
