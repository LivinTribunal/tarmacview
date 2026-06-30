import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useParams, useNavigate, useOutletContext } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { isAxiosError } from "@/api/client";
import { useAirport } from "@/contexts/AirportContext";
import { useComputation } from "@/contexts/ComputationContext";
import { useOnComputationCompleted } from "@/hooks/useOnComputationCompleted";
import {
  getMission,
  updateMission,
  getFlightPlan,
  revalidateFlightPlan,
} from "@/api/missions";
import { useElevationResolver } from "@/hooks/useElevationResolver";
import { getDroneProfile } from "@/api/droneProfiles";
import type { MissionDetailResponse } from "@/types/mission";
import type {
  FlightPlanResponse,
  ValidationViolation,
  WaypointResponse,
} from "@/types/flightPlan";
import type { MapFeature, MapLayerConfig } from "@/types/map";
import type { MissionTabOutletContext } from "@/components/Layout/MissionTabNav";
import AirportMap, { buildWaypointFeatureFromResponse } from "@/components/map/AirportMap";
import type { AirportMapHandle } from "@/components/map/AirportMap";
import LegendPanel from "@/components/map/overlays/LegendPanel";
import AirportInfoPanel from "@/components/map/overlays/AirportInfoPanel";
import WaypointListPanel from "@/components/map/overlays/WaypointListPanel";
import PoiInfoPanel from "@/components/map/overlays/PoiInfoPanel";
import InspectionListPanel from "@/components/map/overlays/InspectionListPanel";
import MapControlsToolbar from "@/components/map/overlays/MapControlsToolbar";
import MapWarningsPanel from "@/components/map/overlays/MapWarningsPanel";
import MapStatsPanel from "@/components/map/overlays/MapStatsPanel";
import { MapTool } from "@/hooks/useMapTools";
import useFlyAlong from "@/hooks/useFlyAlong";
import { computeSegmentDurations } from "@/utils/flyAlongTiming";
import { getBundledModel } from "@/config/droneModels";
import MeasureInfoCard from "@/components/map/overlays/MeasureInfoCard";
import HeadingInfoCard from "@/components/map/overlays/HeadingInfoCard";
import useWaypointEditing from "@/hooks/useWaypointEditing";
import useMapInteractionTools from "@/hooks/useMapInteractionTools";
import { SLOW_NOTIFICATION_TIMEOUT_MS } from "@/constants/ui";

export default function MissionMapPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { airportDetail } = useAirport();
  const { setSaveContext, setComputeContext, refreshMissions, updateMissionFromPage, setCompactLeftPanel, mission: routeMission } =
    useOutletContext<MissionTabOutletContext>();
  const computation = useComputation();

  // hide left panel column - map uses full width
  useEffect(() => {
    setCompactLeftPanel(true);
    return () => setCompactLeftPanel(false);
  }, [setCompactLeftPanel]);

  // core data - mission is provided by the route guard (see RequireMissionAirportMatch)
  const [mission, setMission] = useState<MissionDetailResponse | null>(
    routeMission?.id === id ? routeMission : null,
  );
  const [flightPlan, setFlightPlan] = useState<FlightPlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [revalidating, setRevalidating] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [enduranceMinutes, setEnduranceMinutes] = useState<number | null>(null);
  const [droneModelIdentifier, setDroneModelIdentifier] = useState<string | null>(null);

  // map state
  const mapHandleRef = useRef<AirportMapHandle>(null);
  const [terrainMode, setTerrainMode] = useState<"map" | "satellite">("satellite");
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<MapFeature | null>(null);
  const [hiddenInspectionIds, setHiddenInspectionIds] = useState<Set<string>>(new Set());
  const [selectedInspectionId, setSelectedInspectionId] = useState<string | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [bearing, setBearing] = useState(0);
  const [bearingResetKey, setBearingResetKey] = useState(0);
  const [selectedWarning, setSelectedWarning] = useState<ValidationViolation | null>(null);

  // mirror mode is derived: true when takeoff and landing coordinates match
  const useTakeoffAsLanding = useMemo(() => {
    const t = mission?.takeoff_coordinate?.coordinates;
    const l = mission?.landing_coordinate?.coordinates;
    if (!t || !l) return false;
    return t[0] === l[0] && t[1] === l[1] && t[2] === l[2];
  }, [mission?.takeoff_coordinate, mission?.landing_coordinate]);

  const notificationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDraft = mission?.status === "DRAFT";
  const hasFlightPlan = flightPlan !== null;

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

  // elevation resolver - shared by handleSave (drag → ground snap for TAKEOFF/LANDING)
  // and handleMapClick (PLACE_TAKEOFF / PLACE_LANDING tool placement).
  const resolveElevation = useElevationResolver(
    airportDetail?.id ?? mission?.airport_id ?? null,
  );

  const {
    setDirtyWaypoints,
    effectiveWaypoints,
    isDirty,
    saving,
    handleSave,
    handleWaypointDrag,
    handleTransitInsert,
    handleTransitDelete,
    handleUndo,
    handleRedo,
    canUndo,
    canRedo,
    clearHistory,
  } = useWaypointEditing({
    id,
    flightPlan,
    setFlightPlan,
    setMission,
    setLastSaved,
    resolveElevation,
    useTakeoffAsLanding,
    refreshMissions,
    updateMissionFromPage,
    showNotification,
    t,
  });

  const {
    activeTool,
    is3D,
    setTool,
    setIs3D,
    measure,
    heading,
    pendingPlacement,
    handleMapClick,
    handleToolChange,
  } = useMapInteractionTools({
    id,
    mission,
    setMission,
    airportDetail,
    useTakeoffAsLanding,
    resolveElevation,
    refreshMissions,
    showNotification,
    handleUndo,
    handleRedo,
    t,
  });

  // fetch data
  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      // reuse the mission already fetched by the route guard if it matches
      const missionData =
        routeMission?.id === id ? routeMission : await getMission(id);
      setMission(missionData);

      if (missionData.updated_at) {
        setLastSaved(new Date(missionData.updated_at));
      }

      try {
        const fp = await getFlightPlan(id);
        setFlightPlan(fp);
      } catch (err) {
        if (!isAxiosError(err) || err.response?.status !== 404) throw err;
        setFlightPlan(null);
      }

      if (missionData.drone_profile_id) {
        try {
          const dp = await getDroneProfile(missionData.drone_profile_id);
          setEnduranceMinutes(dp.endurance_minutes);
          setDroneModelIdentifier(dp.model_identifier ?? null);
        } catch (err) {
          console.error("drone profile fetch failed:", err instanceof Error ? err.message : String(err));
          setEnduranceMinutes(null);
          setDroneModelIdentifier(null);
        }
      }
    } catch (err) {
      console.error("mission load failed:", err instanceof Error ? err.message : String(err));
      setError(t("mission.config.loadError"));
    } finally {
      setLoading(false);
    }
  }, [id, t, routeMission]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // visible inspection ids - all non-hidden
  const visibleInspectionIds = useMemo(() => {
    if (!mission) return new Set<string>();
    return new Set(
      mission.inspections.flatMap((i) =>
        hiddenInspectionIds.has(i.id) ? [] : [i.id],
      ),
    );
  }, [mission, hiddenInspectionIds]);

  // waypoints filtered by selected inspection
  const filteredWaypoints = useMemo((): WaypointResponse[] => {
    if (!selectedInspectionId) return effectiveWaypoints;
    return effectiveWaypoints.filter(
      (wp) => wp.inspection_id === selectedInspectionId,
    );
  }, [effectiveWaypoints, selectedInspectionId]);

  // inspection index map
  const inspectionIndexMap = useMemo(() => {
    if (!mission) return undefined;
    const sorted = mission.inspections.slice().sort((a, b) => a.sequence_order - b.sequence_order);
    return Object.fromEntries(sorted.map((insp, i) => [insp.id, i + 1]));
  }, [mission]);

  const violations = useMemo((): ValidationViolation[] => {
    return flightPlan?.validation_result?.violations ?? [];
  }, [flightPlan]);

  // fly-along - per-segment 1x durations (s) from waypoint speeds, falling
  // back to flight plan average_speed for transit hops with no per-wp speed.
  const flyAlongWaypoints = useMemo(() => flightPlan?.waypoints ?? [], [flightPlan]);
  const segmentDurations = useMemo(
    () =>
      computeSegmentDurations(flyAlongWaypoints, {
        fallbackSpeed: flightPlan?.average_speed ?? flightPlan?.transit_speed ?? null,
      }),
    [flyAlongWaypoints, flightPlan?.average_speed, flightPlan?.transit_speed],
  );
  const {
    state: flyAlongState,
    play: flyAlongPlay,
    pause: flyAlongPause,
    stop: flyAlongStop,
    setSpeed: flyAlongSetSpeed,
    setProgress: flyAlongSetProgress,
  } = useFlyAlong(flyAlongWaypoints.length);

  // resolve drone .glb url with fallback to generic quadcopter
  const flyAlongModelUrl = useMemo(() => {
    const bundled = droneModelIdentifier ? getBundledModel(droneModelIdentifier) : null;
    return bundled?.path ?? "/models/drones/generic_quadcopter.glb";
  }, [droneModelIdentifier]);

  // teardown on 3d off, flight-plan reload, or unmount
  useEffect(() => {
    if (!is3D && flyAlongState.status !== "idle") flyAlongStop();
  }, [is3D, flyAlongState.status, flyAlongStop]);

  useEffect(() => {
    flyAlongStop();
  }, [flightPlan?.id, flightPlan?.generated_at, flyAlongStop]);

  useEffect(() => {
    return () => flyAlongStop();
  }, [flyAlongStop]);

  // handle revalidate - re-run validation without recomputing trajectory
  const handleRevalidate = useCallback(async () => {
    if (!id || revalidating) return;
    setRevalidating(true);
    try {
      const fp = await revalidateFlightPlan(id);
      setFlightPlan(fp);
      showNotification(t("map.revalidateSuccess"));
    } catch (err) {
      console.error("revalidate error:", err instanceof Error ? err.message : String(err));
      showNotification(t("map.revalidateFailed"));
    } finally {
      setRevalidating(false);
    }
  }, [id, revalidating, t]);

  // wire save context
  useEffect(() => {
    setSaveContext({
      onSave: handleSave,
      isDirty,
      isSaving: saving,
      lastSaved,
    });
    return () => {
      setSaveContext({
        onSave: null,
        isDirty: false,
        isSaving: false,
        lastSaved: null,
      });
    };
  }, [setSaveContext, handleSave, isDirty, saving, lastSaved]);

  useOnComputationCompleted((result) => {
    setFlightPlan(result);
    setDirtyWaypoints({});
    clearHistory();

    if (id) {
      getMission(id)
        .then((fresh) => {
          setMission(fresh);
          updateMissionFromPage(fresh);
          refreshMissions();
        })
        .catch((err) => console.warn("mission refresh failed", err));
    }
  });

  // compute button state
  const computeLabel = useMemo(() => {
    if (!hasFlightPlan) return t("map.computeTrajectory");
    return t("map.recomputeTrajectory");
  }, [hasFlightPlan, t]);

  const hasCoordinates = !!(mission?.takeoff_coordinate && mission?.landing_coordinate);

  const canCompute = useMemo(() => {
    if (!hasCoordinates) return false;
    if (!hasFlightPlan) return true;
    if (isDirty || mission?.has_unsaved_map_changes) return true;
    return false;
  }, [hasFlightPlan, isDirty, mission?.has_unsaved_map_changes, hasCoordinates]);

  // wire compute context to tab bar - "Compute / Recompute Trajectory" button
  useEffect(() => {
    setComputeContext({
      onCompute: id ? () => computation.startComputation(id) : null,
      canCompute: canCompute && !computation.isComputing,
      isComputing: computation.isComputing,
      label: computeLabel,
      ...(!hasCoordinates ? { tooltip: t("mission.config.setCoordinatesTooltip") } : {}),
    });
    return () => {
      setComputeContext({
        onCompute: null,
        canCompute: false,
        isComputing: false,
      });
    };
  }, [setComputeContext, computation.isComputing, computation.startComputation, canCompute, computeLabel, hasCoordinates, t, id]);

  // handle feature click from map
  const handleFeatureClick = useCallback((feature: MapFeature | null) => {
    setSelectedFeature(feature);
  }, []);

  // clear waypoint selection when waypoint layers are hidden
  const handleLayerChange = useCallback((layers: MapLayerConfig) => {
    if (!layers.trajectory && !layers.transitWaypoints && !layers.measurementWaypoints) {
      setSelectedWaypointId(null);
      setSelectedFeature((prev) => prev?.type === "waypoint" ? null : prev);
    }
  }, []);

  // build a MapFeature for a waypoint id (including standalone takeoff/landing).
  // shared by click (select-only) and locate (select + recenter) paths.
  const buildWaypointFeatureFromId = useCallback(
    (wpId: string): MapFeature | null => {
      if (wpId === "takeoff" && mission?.takeoff_coordinate) {
        const [lon, lat, alt] = mission.takeoff_coordinate.coordinates;
        return {
          type: "waypoint",
          data: {
            id: "takeoff",
            waypoint_type: "TAKEOFF",
            sequence_order: 0,
            position: { type: "Point", coordinates: [lon, lat, alt] },
            stack_count: 1,
          },
        };
      }
      if (wpId === "landing" && mission?.landing_coordinate) {
        const [lon, lat, alt] = mission.landing_coordinate.coordinates;
        return {
          type: "waypoint",
          data: {
            id: "landing",
            waypoint_type: "LANDING",
            sequence_order: 0,
            position: { type: "Point", coordinates: [lon, lat, alt] },
            stack_count: 1,
          },
        };
      }
      const wp = effectiveWaypoints.find((w) => w.id === wpId);
      if (!wp) return null;
      return buildWaypointFeatureFromResponse(wp);
    },
    [effectiveWaypoints, mission],
  );

  // handle waypoint click - select waypoint and show as feature info
  const handleWaypointClick = useCallback(
    (wpId: string | null) => {
      setSelectedWaypointId(wpId);
      if (!wpId) {
        setSelectedFeature(null);
        return;
      }
      const feature = buildWaypointFeatureFromId(wpId);
      if (feature) setSelectedFeature(feature);
    },
    [buildWaypointFeatureFromId],
  );

  // double-click on a waypoint row in the side panel: select + recenter the map.
  // routes through the AirportMap imperative handle, which picks 2d vs cesium.
  const handleWaypointLocate = useCallback(
    (wpId: string) => {
      const feature = buildWaypointFeatureFromId(wpId);
      if (!feature) return;
      setSelectedWaypointId(wpId);
      setSelectedFeature(feature);
      mapHandleRef.current?.locateFeature(feature);
    },
    [buildWaypointFeatureFromId],
  );

  // handle inspection toggle visibility
  const handleToggleInspectionVisibility = useCallback((inspId: string) => {
    setHiddenInspectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(inspId)) {
        next.delete(inspId);
      } else {
        next.add(inspId);
      }
      return next;
    });
  }, []);

  // handle inspection selection - click to select, click again to deselect
  const handleInspectionSelect = useCallback((inspId: string) => {
    setSelectedInspectionId((prev) => (prev === inspId ? null : inspId));
  }, []);

  // handle inspection click - scroll to waypoints
  const handleInspectionClick = useCallback(
    (inspId: string) => {
      // make visible if hidden
      if (hiddenInspectionIds.has(inspId)) {
        setHiddenInspectionIds((prev) => {
          const next = new Set(prev);
          next.delete(inspId);
          return next;
        });
      }
    },
    [hiddenInspectionIds],
  );

  // handle delete takeoff/landing
  const handleDeleteTakeoffLanding = useCallback(
    async (waypointType: string) => {
      if (!id || !mission) return;
      const key = waypointType === "TAKEOFF" ? "takeoff_coordinate" : "landing_coordinate";
      try {
        await updateMission(id, { [key]: null });
        const fresh = await getMission(id);
        setMission(fresh);
        refreshMissions();
        setSelectedFeature(null);
        setSelectedWaypointId(null);
      } catch (err) {
        console.error("map save error:", err instanceof Error ? err.message : String(err));
        showNotification(t("map.saveError"));
      }
    },
    [id, mission, t, refreshMissions],
  );

  // place takeoff/landing
  const handlePlaceTakeoff = useCallback(() => {
    setTool(MapTool.PLACE_TAKEOFF);
  }, [setTool]);

  const handlePlaceLanding = useCallback(() => {
    setTool(MapTool.PLACE_LANDING);
  }, [setTool]);

  // zoom reset - not yet wired to map API
  const handleZoomReset = useCallback(() => {}, []);

  // zoom to specific percent
  const handleZoomTo = useCallback((percent: number) => {
    setZoomPercent(percent);
  }, []);

  // beforeunload for dirty state
  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const hasTakeoffOrLanding = !!(mission?.takeoff_coordinate || mission?.landing_coordinate);
  const showPanels = !isDraft || hasFlightPlan || hasTakeoffOrLanding;

  const leftPanelChildren = useMemo(
    () => (
      <>
        {pendingPlacement.size > 0 && (
          <div
            className="flex items-center justify-between rounded-2xl border border-tv-warning bg-tv-bg px-3 py-1.5 text-xs font-semibold text-tv-warning"
            data-testid="pending-placement-indicator"
          >
            <span>{t("map.markerUnsaved")}</span>
            <span>
              {Array.from(pendingPlacement)
                .map((k) =>
                  k === "takeoff" ? t("map.placeTakeoff") : t("map.placeLanding"),
                )
                .join(", ")}
            </span>
          </div>
        )}
        {showPanels && mission && mission.inspections.length > 0 && (
          <InspectionListPanel
            inspections={mission.inspections}
            hiddenInspectionIds={hiddenInspectionIds}
            onToggleVisibility={handleToggleInspectionVisibility}
            onInspectionClick={handleInspectionClick}
            selectedId={selectedInspectionId}
            onSelect={handleInspectionSelect}
          />
        )}
        {showPanels && (
          <WaypointListPanel
            waypoints={filteredWaypoints}
            selectedId={selectedWaypointId}
            onSelect={handleWaypointClick}
            onLocate={handleWaypointLocate}
            takeoffCoordinate={selectedInspectionId ? null : mission?.takeoff_coordinate ?? null}
            landingCoordinate={selectedInspectionId ? null : mission?.landing_coordinate ?? null}
            visibleInspectionIds={visibleInspectionIds}
          />
        )}
        {measure.isComplete && (
          <MeasureInfoCard
            totalDistance={measure.totalDistance}
            segmentCount={measure.segments.length}
            onClose={measure.dismiss}
          />
        )}
        {heading.isComplete && (
          <HeadingInfoCard
            bearing={heading.bearing ?? 0}
            onClose={heading.dismiss}
          />
        )}
        {selectedFeature && (
          <PoiInfoPanel
            feature={selectedFeature}
            onClose={() => {
              setSelectedFeature(null);
              setSelectedWaypointId(null);
            }}
            editable={true}
            onDeleteTakeoffLanding={handleDeleteTakeoffLanding}
          />
        )}
      </>
    ),
    [
      pendingPlacement,
      t,
      showPanels,
      mission,
      hiddenInspectionIds,
      handleToggleInspectionVisibility,
      handleInspectionClick,
      selectedInspectionId,
      handleInspectionSelect,
      filteredWaypoints,
      selectedWaypointId,
      handleWaypointClick,
      handleWaypointLocate,
      visibleInspectionIds,
      measure.isComplete,
      measure.totalDistance,
      measure.segments.length,
      measure.dismiss,
      heading.isComplete,
      heading.bearing,
      heading.dismiss,
      selectedFeature,
      handleDeleteTakeoffLanding,
    ],
  );

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
          onClick={fetchData}
          className="px-4 py-2 rounded-full text-sm font-semibold bg-tv-accent text-tv-accent-text hover:bg-tv-accent-hover transition-colors"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  // determine if map click handler should be active
  const mapClickActive =
    activeTool === MapTool.PLACE_TAKEOFF ||
    activeTool === MapTool.PLACE_LANDING ||
    activeTool === MapTool.MEASURE ||
    activeTool === MapTool.HEADING;

  return (
    <div
      className="relative px-4 h-full"
      data-testid="mission-map-page"
    >
      {airportDetail ? (
        <div className="relative w-full h-full rounded-2xl overflow-hidden border border-tv-border">
          <AirportMap
            ref={mapHandleRef}
            airport={airportDetail}
            terrainMode={terrainMode}
            onTerrainChange={setTerrainMode}
            is3D={is3D}
            showTerrainToggle={false}
            showLayerPanel={true}
            showLegend={false}
            showPoiInfo={false}
            showWaypointList={false}
            showZoomControls={false}
            showCompass={false}
            onBearingChange={setBearing}
            bearingResetKey={bearingResetKey}

            waypoints={effectiveWaypoints}
            selectedWaypointId={selectedWaypointId}
            onWaypointClick={handleWaypointClick}
            missionStatus={mission.status}
            onMapClick={mapClickActive ? handleMapClick : undefined}
            flightPlanScope={mission.flight_plan_scope}
            takeoffCoordinate={mission.takeoff_coordinate}
            landingCoordinate={mission.landing_coordinate}
            inspectionIndexMap={inspectionIndexMap}
            visibleInspectionIds={visibleInspectionIds}
            onFeatureClick={handleFeatureClick}
            focusFeature={selectedFeature}
            onLayerChange={handleLayerChange}
            activeTool={activeTool}
            onPlaceTakeoff={handlePlaceTakeoff}
            onPlaceLanding={useTakeoffAsLanding ? undefined : handlePlaceLanding}
            measureData={{
              points: measure.pointsGeoJSON,
              lines: measure.linesGeoJSON,
              labels: measure.labelsGeoJSON,
            }}
            onMeasureClear={measure.clear}
            onMeasureFinish={measure.finishDrawing}
            onMeasureMouseMove={measure.setCursor}
            isMeasureDrawing={measure.isDrawing}
            headingData={{
              point: heading.pointGeoJSON,
              line: heading.lineGeoJSON,
              label: heading.labelGeoJSON,
            }}
            onHeadingClear={heading.clear}
            headingOrigin={heading.origin}
            isHeadingDrawing={heading.isDrawing}
            onWaypointDrag={handleWaypointDrag}
            onTransitInsert={handleTransitInsert}
            onTransitDelete={handleTransitDelete}
            zoomPercent={zoomPercent}
            onZoomChange={setZoomPercent}
            highlightedWaypointIds={selectedWarning?.waypoint_ids}
            highlightSeverity={selectedWarning?.severity}
            highlightedInspectionId={selectedInspectionId}
            selectedWarning={selectedWarning}
            onWarningClose={() => setSelectedWarning(null)}
            useTakeoffAsLanding={useTakeoffAsLanding}
            flyAlongState={flyAlongState}
            flyAlongModelUrl={flyAlongModelUrl}
            flyAlongSegmentDurations={segmentDurations}
            flyAlongSetProgress={flyAlongSetProgress}
            flyAlongOnComplete={flyAlongStop}
            leftPanelChildren={leftPanelChildren}
          >
            {/* map controls toolbar - top center */}
            <MapControlsToolbar
              activeTool={activeTool}
              onToolChange={handleToolChange}
              is3D={is3D}
              onToggle3D={setIs3D}
              terrainMode={terrainMode}
              onTerrainChange={setTerrainMode}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onZoomReset={handleZoomReset}
              zoomPercent={zoomPercent}
              onZoomTo={handleZoomTo}
              bearing={bearing}
              onBearingReset={() => setBearingResetKey((k) => k + 1)}
              hasTrajectory={flyAlongWaypoints.length >= 2}
              flyAlongState={flyAlongState}
              onFlyAlongPlay={flyAlongPlay}
              onFlyAlongPause={flyAlongPause}
              onFlyAlongStop={flyAlongStop}
              onFlyAlongSpeedChange={flyAlongSetSpeed}
            />

            {/* right side overlays */}
            <div
              className="absolute top-3 right-3 bottom-[60px] z-10 w-56 flex flex-col gap-2 overflow-y-auto pr-1"
              style={{ scrollbarGutter: "stable" }}
            >
              <LegendPanel
                missionStatus={mission.status}
                hasTakeoff={!!mission.takeoff_coordinate}
                hasLanding={!!mission.landing_coordinate}
                className="w-full rounded-2xl border border-tv-border bg-tv-bg flex-shrink-0"
              />

              {airportDetail && (
                <AirportInfoPanel
                  airport={airportDetail}
                  className="w-full rounded-2xl border border-tv-border bg-tv-bg flex-shrink-0"
                />
              )}

              {hasFlightPlan && violations.length > 0 && (
                <MapWarningsPanel
                  violations={violations}
                  onWarningClick={setSelectedWarning}
                  selectedWarningId={selectedWarning?.id}
                />
              )}

              {hasFlightPlan && (
                <MapStatsPanel
                  flightPlan={flightPlan}
                  inspectionCount={mission.inspections.length}
                  enduranceMinutes={enduranceMinutes}
                />
              )}
            </div>

          </AirportMap>

          {/* bottom bar - right-aligned under right panel edge */}
          <div className="absolute bottom-3 z-10 flex items-center gap-2" style={{ right: "32px" }}>
            {/* modify parameters */}
            <button
              type="button"
              onClick={() =>
                navigate(`/operator-center/missions/${id}/configuration`)
              }
              className="px-5 py-2.5 rounded-full text-sm font-semibold border border-tv-border bg-tv-surface text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
              data-testid="modify-parameters-btn"
            >
              {t("map.modifyParameters")}
            </button>

            {hasFlightPlan && (
              <button
                type="button"
                onClick={handleRevalidate}
                disabled={revalidating || isDirty || !!mission?.has_unsaved_map_changes}
                title={isDirty || mission?.has_unsaved_map_changes ? t("map.recomputeBeforeValidating") : undefined}
                className={`px-5 py-2.5 rounded-full text-sm font-semibold transition-colors border-2 ${
                  revalidating || isDirty || mission?.has_unsaved_map_changes
                    ? "border-tv-border bg-tv-surface text-tv-text-muted opacity-50 cursor-not-allowed"
                    : "border-tv-success bg-tv-surface text-tv-success hover:bg-tv-success/10"
                }`}
                data-testid="validate-trajectory-btn"
              >
                {revalidating ? t("map.revalidating") : t("map.validateTrajectory")}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-tv-surface rounded-2xl border border-tv-border h-full">
          <Loader2 className="h-6 w-6 animate-spin text-tv-accent" />
        </div>
      )}

      {/* notification toast */}
      {notification && (
        <div
          className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl bg-tv-surface border border-tv-border text-sm text-tv-text-primary"
          data-testid="notification-toast"
        >
          {notification}
        </div>
      )}
    </div>
  );
}
