import { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useParams, useNavigate, useOutletContext } from "react-router";
import { useTranslation } from "react-i18next";
import { useAirport } from "@/contexts/AirportContext";
import { useComputation } from "@/contexts/ComputationContext";
import { useOnComputationCompleted } from "@/hooks/useOnComputationCompleted";
import { buildInspectionIndexMap } from "@/utils/inspectionIndex";
import { getMission, getFlightPlan } from "@/api/missions";
import { listDroneProfiles } from "@/api/droneProfiles";
import type { MissionDetailResponse } from "@/types/mission";
import type { DroneProfileResponse } from "@/types/droneProfile";
import type { FlightPlanResponse, ValidationViolation } from "@/types/flightPlan";
import type { MissionTabOutletContext } from "@/components/Layout/MissionTabNav";
import PageLoadState from "@/components/common/PageLoadState";
import MissionInfoPanel from "@/components/mission/MissionInfoPanel";
import WarningsPanel from "@/components/mission/WarningsPanel";
import StatsPanel from "@/components/mission/StatsPanel";
import ValidationStatusPanel from "@/components/mission/ValidationStatusPanel";
import MissionMapPanel from "@/components/mission/MissionMapPanel";
import type { MapFeature } from "@/types/map";

/** read-only mission overview with info, validation, and simplified map. */
export default function MissionOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { airportDetail } = useAirport();
  const { setSaveContext, setComputeContext, refreshMissions, updateMissionFromPage, leftPanelEl } =
    useOutletContext<MissionTabOutletContext>();
  const computation = useComputation();
  const { startComputation, isComputing } = computation;

  const [mission, setMission] = useState<MissionDetailResponse | null>(null);
  const [droneProfiles, setDroneProfiles] = useState<DroneProfileResponse[]>([]);
  const [flightPlan, setFlightPlan] = useState<FlightPlanResponse | null>(null);
  const [warnings, setWarnings] = useState<ValidationViolation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [terrainMode, setTerrainMode] = useState<"map" | "satellite">("satellite");
  const [is3D, setIs3D] = useState(false);
  const [selectedWarning, setSelectedWarning] = useState<ValidationViolation | null>(null);
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<MapFeature | null>(null);
  const inspectionIndexMap = useMemo(() => buildInspectionIndexMap(mission), [mission]);

  useOnComputationCompleted((result) => {
    setFlightPlan(result);
    const violations = result.validation_result?.violations ?? [];
    setWarnings(violations.length > 0 ? violations : null);

    if (id) {
      getMission(id)
        .then((fresh) => {
          setMission(fresh);
          refreshMissions();
        })
        .catch((err) => console.warn("mission refresh failed", err));
    }
  });

  // wire up disabled save button
  useEffect(() => {
    setSaveContext({
      onSave: () => {},
      isDirty: false,
      isSaving: false,
      lastSaved: mission?.updated_at ? new Date(mission.updated_at) : null,
    });
    return () => {
      setSaveContext({ onSave: null, isDirty: false, isSaving: false, lastSaved: null });
    };
  }, [setSaveContext, mission]);

  // compute trajectory button in header
  const hasCoordinates = !!(mission?.takeoff_coordinate && mission?.landing_coordinate);
  const computeLabel = flightPlan
    ? t("map.recomputeTrajectory")
    : t("map.computeTrajectory");

  useEffect(() => {
    setComputeContext({
      onCompute: id ? () => startComputation(id) : null,
      canCompute: hasCoordinates && !isComputing,
      isComputing,
      label: computeLabel,
    });
    return () => {
      setComputeContext({ onCompute: null, canCompute: false, isComputing: false });
    };
  }, [setComputeContext, isComputing, startComputation, hasCoordinates, computeLabel, id]);

  const fetchData = useCallback(async () => {
    /** load mission, drone profiles, and flight plan. */
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [missionData, dpData] = await Promise.all([
        getMission(id),
        listDroneProfiles(),
      ]);
      setMission(missionData);
      setDroneProfiles(dpData.data);
      updateMissionFromPage(missionData);
      refreshMissions();

      try {
        const fp = await getFlightPlan(id);
        setFlightPlan(fp);
        const violations = fp.validation_result?.violations ?? [];
        setWarnings(violations.length > 0 ? violations : null);
      } catch (err) {
        console.error("flight plan fetch failed:", err instanceof Error ? err.message : String(err));
        setFlightPlan(null);
      }
    } catch (err) {
      console.error("mission fetch failed:", err instanceof Error ? err.message : String(err));
      setError(t("mission.config.loadError"));
    } finally {
      setLoading(false);
    }
  }, [id, refreshMissions, updateMissionFromPage, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const selectedDroneProfile = useMemo(() => {
    return droneProfiles.find((dp) => dp.id === mission?.drone_profile_id) ?? null;
  }, [droneProfiles, mission]);

  // find the runway name from airport surfaces
  const runwayName = useMemo(() => {
    if (!airportDetail || !mission) return null;
    const runways = airportDetail.surfaces.filter((s) => s.surface_type === "RUNWAY");
    if (runways.length === 0) return null;
    return runways.map((r) => r.identifier).join(", ");
  }, [airportDetail, mission]);

  // collect agl names across all surfaces for the airport
  const aglNames = useMemo(() => {
    if (!airportDetail || !mission) return null;
    const names = airportDetail.surfaces.flatMap((s) => s.agls.map((a) => a.name));
    if (names.length === 0) return null;
    return names.join(", ");
  }, [airportDetail, mission]);

  if (loading || error || !mission) {
    return (
      <PageLoadState
        loading={loading}
        error={loading ? null : error ?? t("common.error")}
        onRetry={fetchData}
      />
    );
  }

  const hasTrajectory = flightPlan !== null;

  return (
    <>
      {/* left panel content - portaled into MissionTabNav left column */}
      {leftPanelEl && createPortal(
        <>
          {/* mission info */}
          <div className="bg-tv-surface border border-tv-border rounded-2xl p-4">
            <MissionInfoPanel
              mission={mission}
              droneProfileName={selectedDroneProfile?.name ?? null}
              runwayName={runwayName}
              aglNames={aglNames}
              validationPassed={flightPlan?.validation_result?.passed ?? null}
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

          {/* validation status */}
          <div className="bg-tv-surface border border-tv-border rounded-2xl p-4">
            <ValidationStatusPanel
              flightPlan={flightPlan}
              hasTrajectory={hasTrajectory}
              missionStatus={mission.status}
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

        </>,
        leftPanelEl,
      )}

      {/* right panel - map */}
      <div className="flex flex-col h-full" data-testid="mission-overview-page">
        <MissionMapPanel
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
          footerActions={
            <>
              <button
                type="button"
                onClick={() => navigate(`/operator-center/missions/${id}/configuration`)}
                className="px-4 py-2.5 rounded-full text-sm font-semibold border border-tv-border bg-tv-surface text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
                data-testid="modify-parameters-btn"
              >
                {t("mission.overview.modifyParameters")}
              </button>
              <button
                type="button"
                onClick={() => navigate(`/operator-center/missions/${id}/map`)}
                className="px-4 py-2.5 rounded-full text-sm font-semibold border border-tv-border bg-tv-surface text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
                data-testid="open-map-btn"
              >
                {t("mission.overview.openMap")}
              </button>
            </>
          }
        />
      </div>

    </>
  );
}
