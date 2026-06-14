import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { getAirport } from "@/api/airports";
import { useAirport } from "@/contexts/AirportContext";
import type { AirportDetailResponse } from "@/types/airport";
import type { MapFeature, MapLayerConfig } from "@/types/map";
import { DEFAULT_LAYER_CONFIG } from "@/types/map";
import AirportMap from "@/components/map/AirportMap";
import type { AirportMapHandle } from "@/components/map/AirportMap";
import LegendPanel from "@/components/map/overlays/LegendPanel";
import { clearSourceDataCache } from "./syncEntityGeometryToMap";
import AirportInfoPanel from "@/components/coordinator/AirportInfoPanel";
import TerrainSettingsCard from "@/components/coordinator/TerrainSettingsCard";
import UnsavedChangesDialog from "@/components/coordinator/UnsavedChangesDialog";
import ConfirmDeleteDialog from "@/components/coordinator/ConfirmDeleteDialog";
import MapDrawingToolbar from "@/components/coordinator/MapDrawingToolbar";
import CoordinatorMapHelpPanel from "@/components/coordinator/CoordinatorMapHelpPanel";
import GeoJsonEditorModal from "@/components/coordinator/GeoJsonEditorModal";
import ImageMetadataExtractorModal from "@/components/coordinator/ImageMetadataExtractorModal";
import AirportInfraPanels from "@/components/coordinator/AirportInfraPanels";
import FeatureEditorPanel from "@/components/coordinator/FeatureEditorPanel";
import MapViewToggles from "@/components/coordinator/MapViewToggles";
import useMapDrawing from "@/hooks/useMapDrawing";
import useDrawPolygon from "@/hooks/useDrawPolygon";
import useDrawCircle from "@/hooks/useDrawCircle";
import useDrawRectangle from "@/hooks/useDrawRectangle";
import usePlacePoint from "@/hooks/usePlacePoint";
import useMeasureDistance from "@/hooks/useMeasureDistance";
import useHeadingTool from "@/hooks/useHeadingTool";
import { useElevationResolver } from "@/hooks/useElevationResolver";
import useEntityCreation from "@/hooks/useEntityCreation";
import useMapPickingTools from "@/hooks/useMapPickingTools";
import useAirportCrud from "@/hooks/useAirportCrud";
import useAirportMapHistory from "@/hooks/useAirportMapHistory";
import { matchUndoRedoShortcut } from "@/utils/keyboardShortcuts";
import { pairAwareSurfaceOrder } from "@/utils/surfacePairing";
import type { DrawingTool } from "@/types/map";
import { MapTool } from "@/hooks/useMapTools";

const DRAWING_TOOL_TO_MAP_TOOL: Record<DrawingTool, MapTool> = {
  select: MapTool.SELECT,
  move: MapTool.MOVE_FEATURE,
  measurement: MapTool.MEASURE,
  heading: MapTool.HEADING,
  zoom: MapTool.ZOOM,
  zoomReset: MapTool.ZOOM_RESET,
  drawPolygon: MapTool.SELECT,
  drawCircle: MapTool.SELECT,
  drawRectangle: MapTool.SELECT,
  placePoint: MapTool.SELECT,
  geoJsonEditor: MapTool.SELECT,
};

const DRAWING_TOOLS: DrawingTool[] = [
  "drawPolygon", "drawCircle", "drawRectangle", "placePoint", "heading", "measurement",
];

// tools that don't cancel a pending creation when selected
const SAFE_TOOLS: DrawingTool[] = ["select", "move", "zoom", "zoomReset", "measurement", "heading"];

/** full airport detail editor with map, drawing tools, and infrastructure crud. */
export default function AirportEditPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectAirport, clearAirport } = useAirport();
  const selectAirportRef = useRef(selectAirport);
  selectAirportRef.current = selectAirport;

  const [airport, setAirport] = useState<AirportDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState<MapFeature | null>(null);
  const [layerConfig, setLayerConfig] = useState<MapLayerConfig>(DEFAULT_LAYER_CONFIG);
  const [terrainMode, setTerrainMode] = useState<"map" | "satellite">("satellite");
  const [is3D, setIs3D] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [showGeoJsonEditor, setShowGeoJsonEditor] = useState(false);
  const [showExtractor, setShowExtractor] = useState(false);
  const [showDeleteAirportDialog, setShowDeleteAirportDialog] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [bearing, setBearing] = useState(0);
  const [bearingResetKey, setBearingResetKey] = useState(0);

  const { activeTool, setActiveTool } = useMapDrawing();
  const mapTool = DRAWING_TOOL_TO_MAP_TOOL[activeTool] ?? MapTool.SELECT;
  const isDrawingActive = DRAWING_TOOLS.includes(activeTool);
  const [pendingNav, setPendingNav] = useState<string | null>(null);

  // fetch airport data - declared early so drawing hooks can reference it
  const initialLoadDone = useRef(false);
  const fetchAirport = useCallback(async (): Promise<AirportDetailResponse | null> => {
    /** fetch airport detail data. retries once on initial load to absorb a backend cold-start race. */
    if (!id) return null;
    if (!initialLoadDone.current) setLoading(true);
    setError(false);
    const attempt = () => getAirport(id);
    try {
      const data = await attempt();
      setAirport(data);
      initialLoadDone.current = true;
      return data;
    } catch {
      if (!initialLoadDone.current) {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const data = await attempt();
          setAirport(data);
          initialLoadDone.current = true;
          return data;
        } catch {
          // fall through
        }
      }
      setError(true);
      return null;
    } finally {
      setLoading(false);
    }
  }, [id]);

  // map ref for drawing hooks
  const mapHandleRef = useRef<AirportMapHandle>(null);
  const getMap = useCallback(() => mapHandleRef.current?.getMap() ?? null, []);
  const map = getMap();

  // per-airport DEM resolver shared by creation form and polygon submit
  const elevationResolver = useElevationResolver(id);

  const {
    isDirty,
    clearAll,
    getPendingChanges,
    getPendingChange,
    canUndo,
    canRedo,
    handleUndo,
    handleRedo,
    handleInfraPointDrag,
    handleFeatureUpdate,
    handleAirportUpdate,
    handleGeoJsonApply,
  } = useAirportMapHistory({
    id,
    airport,
    selectedFeature,
    vertexEditActive: activeTool === "move",
    map,
    getMap,
  });

  const creation = useEntityCreation({
    id,
    airport,
    elevationResolver,
    fetchAirport,
    setActiveTool,
    setSelectedFeature,
  });

  const picking = useMapPickingTools({
    selectedFeature,
    airport,
    pendingGeometry: creation.pendingGeometry,
    pendingPointPosition: creation.pendingPointPosition,
    getMap,
    t,
  });

  // destructure called methods so effect/callback deps track the function, not the whole hook object
  const { clearPending, handleCreationCancel } = creation;
  const { handlePickingMapClick } = picking;

  const crud = useAirportCrud({
    id,
    airport,
    fetchAirport,
    getPendingChanges,
    clearAll,
    selectedFeature,
    setSelectedFeature,
    clearAirport,
    navigate,
    t,
    getMap,
  });

  // wire drawing hooks
  useDrawPolygon(map, activeTool === "drawPolygon", creation.handlePolygonComplete);
  useDrawCircle(map, activeTool === "drawCircle", creation.handleCircleComplete);
  useDrawRectangle(map, activeTool === "drawRectangle", creation.handleRectangleComplete, bearing);
  usePlacePoint(map, activeTool === "placePoint", creation.handlePointComplete);

  // measurement and heading tools
  const measure = useMeasureDistance();
  const heading = useHeadingTool();
  const measureRef = useRef(measure);
  measureRef.current = measure;
  const headingRef = useRef(heading);
  headingRef.current = heading;
  const handleMapClick = useCallback(
    (lngLat: { lng: number; lat: number }) => {
      /** handle map click for measurement, heading, and touchpoint pick tools. */
      if (handlePickingMapClick(lngLat)) return;

      const m = measureRef.current;
      const h = headingRef.current;
      if (mapTool === MapTool.MEASURE && (m.isDrawing || !m.hasPoints)) {
        m.addPoint(lngLat.lng, lngLat.lat);
      } else if (mapTool === MapTool.HEADING) {
        h.addPoint(lngLat.lng, lngLat.lat);
      }
    },
    [mapTool, handlePickingMapClick],
  );

  // cancel pending creation when user picks another drawing tool, clear tools on switch
  const handleToolChange = useCallback((tool: DrawingTool) => {
    /** handle toolbar tool change, cancelling pending creation if needed. */
    setActiveTool(tool);

    // dismiss heading when switching away from heading
    if (tool !== "heading") headingRef.current.dismiss();
    // dismiss measurement when switching away from measurement
    if (tool !== "measurement") measureRef.current.dismiss();

    if (SAFE_TOOLS.includes(tool)) return;
    if (!(creation.pendingGeometry || creation.pendingPointPosition)) return;
    clearPending();
  }, [setActiveTool, creation.pendingGeometry, creation.pendingPointPosition, clearPending]);

  // 3d disables vertex editing, so drop move back to select
  useEffect(() => {
    if (is3D && activeTool === "move") setActiveTool("select");
  }, [is3D, activeTool, setActiveTool]);

  // warn on browser refresh / tab close
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  useEffect(() => {
    fetchAirport();
    return () => clearSourceDataCache();
  }, [fetchAirport]);

  // sync fetched airport to context so the navbar selector shows it
  useEffect(() => {
    if (airport) {
      selectAirportRef.current(airport);
    }
  }, [airport]);

  // keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      /** handle keyboard shortcuts for drawing tools. */
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "Escape") {
        if (measureRef.current.isComplete) {
          measureRef.current.dismiss();
          return;
        }
        if (headingRef.current.isComplete) {
          headingRef.current.dismiss();
          return;
        }
        // clear in-progress heading/measure so the live line disappears too
        if (headingRef.current.hasPoints) headingRef.current.clear();
        if (measureRef.current.hasPoints) measureRef.current.clear();
        handleCreationCancel();
        setActiveTool("select");
        setSelectedFeature(null);
        return;
      }

      const undoRedo = matchUndoRedoShortcut(e);
      if (undoRedo === "undo") {
        e.preventDefault();
        handleUndo();
        return;
      }
      if (undoRedo === "redo") {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const keyMap: Record<string, () => void> = {
        s: () => handleToolChange("select"),
        v: () => handleToolChange("move"),
        m: () => handleToolChange("measurement"),
        h: () => handleToolChange("heading"),
        g: () => handleToolChange("drawPolygon"),
        c: () => handleToolChange("drawCircle"),
        e: () => handleToolChange("drawRectangle"),
        t: () => handleToolChange("placePoint"),
        z: () => handleToolChange("zoom"),
        r: () => handleToolChange("zoomReset"),
      };

      const action = keyMap[e.key.toLowerCase()];
      if (action) {
        e.preventDefault();
        action();
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedFeature && (activeTool === "select" || activeTool === "move")) {
          // delete is handled by EditableFeatureInfo's delete button
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleToolChange, handleUndo, handleRedo, selectedFeature, activeTool, handleCreationCancel, setActiveTool]);

  const handleFeatureClick = useCallback((feature: MapFeature | null) => {
    /** set selected feature when clicked on map or list panel - skip during drawing or picking. */
    if (isDrawingActive) return;
    if (picking.anyPicking) return;
    setSelectedFeature(feature);
  }, [isDrawingActive, picking.anyPicking]);

  const handleFeatureLocate = useCallback((feature: MapFeature) => {
    /** double-click intent: select and recenter via the active map (2d or 3d). */
    if (isDrawingActive) return;
    if (picking.anyPicking) return;
    setSelectedFeature(feature);
    mapHandleRef.current?.locateFeature(feature);
  }, [isDrawingActive, picking.anyPicking]);

  const handleLayerChange = useCallback((layers: MapLayerConfig) => {
    /** sync layer config from map component. */
    setLayerConfig(layers);
  }, []);

  const handleStay = useCallback(() => {
    /** cancel navigation and stay on page. */
    setShowUnsavedDialog(false);
    setPendingNav(null);
  }, []);

  const handleDiscard = useCallback(() => {
    /** discard changes and proceed with navigation. */
    setShowUnsavedDialog(false);
    clearAll();
    if (pendingNav) {
      navigate(pendingNav);
      setPendingNav(null);
    }
  }, [clearAll, pendingNav, navigate]);

  const handleZoomTo = useCallback((percent: number) => {
    /** set zoom level from toolbar dropdown. */
    setZoomPercent(percent);
  }, []);

  const surfaces = useMemo(() => airport?.surfaces ?? [], [airport]);
  const { surfaces: orderedSurfaces, pairPosition: surfacePairPosition } = useMemo(
    () => pairAwareSurfaceOrder(surfaces),
    [surfaces],
  );
  const obstacles = useMemo(() => airport?.obstacles ?? [], [airport]);
  const safetyZones = useMemo(() => airport?.safety_zones ?? [], [airport]);
  const boundaryZone = useMemo(
    () => safetyZones.find((z) => z.type === "AIRPORT_BOUNDARY"),
    [safetyZones],
  );
  const regularSafetyZones = useMemo(
    () => safetyZones.filter((z) => z.type !== "AIRPORT_BOUNDARY"),
    [safetyZones],
  );

  const leftPanelChildren = useMemo(
    () => (
      <AirportInfraPanels
        t={t}
        surfaces={surfaces}
        orderedSurfaces={orderedSurfaces}
        surfacePairPosition={surfacePairPosition}
        obstacles={obstacles}
        boundaryZone={boundaryZone}
        regularSafetyZones={regularSafetyZones}
        onFeatureClick={handleFeatureClick}
        onFeatureLocate={handleFeatureLocate}
        onDeleteSurface={crud.handleDeleteSurface}
        onDeleteObstacle={crud.handleDeleteObstacle}
        onDeleteSafetyZone={crud.handleDeleteSafetyZone}
        onDeleteAgl={crud.handleDeleteAgl}
        onDeleteLha={crud.handleDeleteLha}
        onSetActiveTool={setActiveTool}
        onAddBoundary={() => {
          creation.setBoundaryEntityOverride("safety_zone_airport_boundary");
          handleToolChange("drawPolygon");
        }}
      />
    ),
    [
      t,
      surfaces,
      orderedSurfaces,
      surfacePairPosition,
      obstacles,
      boundaryZone,
      regularSafetyZones,
      handleFeatureClick,
      handleFeatureLocate,
      crud.handleDeleteSurface,
      crud.handleDeleteObstacle,
      crud.handleDeleteSafetyZone,
      crud.handleDeleteAgl,
      crud.handleDeleteLha,
      setActiveTool,
      creation.setBoundaryEntityOverride,
      handleToolChange,
    ],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-tv-bg">
        <Loader2 className="h-6 w-6 animate-spin text-tv-accent" />
      </div>
    );
  }

  if (error || !airport) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-tv-bg gap-3">
        <p className="text-sm text-tv-error">{t("common.error")}</p>
        <button
          type="button"
          onClick={fetchAirport}
          className="px-4 py-2 rounded-full text-sm font-semibold bg-tv-accent text-tv-accent-text hover:bg-tv-accent-hover transition-colors"
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full" data-testid="airport-edit-page">
      {/* map */}
      <div className={`w-full h-full px-4 py-3 ${picking.anyPicking ? "cursor-crosshair" : ""}`}>
        <AirportMap
          ref={mapHandleRef}
          airport={airport}
          interactive={true}
          showLayerPanel={true}
          showLegend={false}
          showPoiInfo={false}
          showWaypointList={false}
          showHelpPanel={false}
          showZoomControls={false}
          showCompass={false}
          terrainMode={terrainMode}
          onTerrainChange={setTerrainMode}
          onFeatureClick={handleFeatureClick}
          onInfraPointDrag={handleInfraPointDrag}
          onLayerChange={handleLayerChange}
          focusFeature={selectedFeature}
          pendingGeometry={creation.pendingGeometry}
          pendingPointPosition={creation.pendingPointPosition}
          is3D={is3D}
          onToggle3D={setIs3D}
          activeTool={mapTool}
          vertexEditTool={MapTool.MOVE_FEATURE}
          onMapClick={mapTool === MapTool.MEASURE || mapTool === MapTool.HEADING || picking.anyPicking ? handleMapClick : undefined}
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
          zoomPercent={zoomPercent}
          onZoomChange={setZoomPercent}
          onBearingChange={setBearing}
          bearingResetKey={bearingResetKey}
          leftPanelChildren={leftPanelChildren}
        >
          {/* top-center: drawing toolbar */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
            <MapDrawingToolbar
              activeTool={activeTool}
              onToolChange={handleToolChange}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onGeoJsonEditor={() => setShowGeoJsonEditor(true)}
              onExtractFromImage={() => setShowExtractor(true)}
              zoomPercent={zoomPercent}
              onZoomTo={handleZoomTo}
              onZoomReset={() => setActiveTool("zoomReset")}
              isDirty={isDirty}
              saving={crud.saving}
              onSave={crud.handleSave}
              saveLabel={crud.saving ? t("coordinator.detail.saving") : t("coordinator.detail.save")}
              bearing={bearing}
              onBearingReset={() => setBearingResetKey((k) => k + 1)}
            />
          </div>

          {/* right side: legend + feature info */}
          <div
            className="absolute top-3 right-3 bottom-[60px] z-10 w-56 flex flex-col gap-2 overflow-y-auto pr-1"
            style={{ scrollbarGutter: "stable" }}
          >
            <LegendPanel
              layers={layerConfig}
              className="w-full rounded-2xl border border-tv-border bg-tv-bg flex-shrink-0"
            />
            <AirportInfoPanel
              airport={airport}
              onUpdate={handleAirportUpdate}
              onDelete={() => setShowDeleteAirportDialog(true)}
            />
            <TerrainSettingsCard
              airport={airport}
              onUpdate={async () => {
                await fetchAirport();
              }}
            />
            {/* creation form or feature editor */}
            <FeatureEditorPanel
              t={t}
              airportId={id}
              airportElevation={airport?.elevation}
              surfaces={surfaces}
              obstacles={obstacles}
              safetyZones={safetyZones}
              selectedFeature={selectedFeature}
              setSelectedFeature={setSelectedFeature}
              creation={creation}
              picking={picking}
              measure={measure}
              heading={heading}
              elevationResolver={elevationResolver}
              onFeatureUpdate={handleFeatureUpdate}
              onFeatureDelete={crud.handleFeatureDelete}
              getPendingChange={getPendingChange}
              fetchAirport={fetchAirport}
            />
          </div>

          {/* bottom-left: coordinator help panel */}
          <div className="absolute bottom-3 left-3 z-10">
            <CoordinatorMapHelpPanel />
          </div>

          {/* bottom-right: view toggles + error messages */}
          <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2">
            {(crud.saveError || crud.deleteError) && (
              <p className="text-xs text-tv-error">
                {crud.saveError ? t("coordinator.detail.saveError") : t("coordinator.detail.deleteError")}
              </p>
            )}

            <MapViewToggles
              t={t}
              is3D={is3D}
              onSet3D={setIs3D}
              terrainMode={terrainMode}
              onSetTerrainMode={setTerrainMode}
            />
          </div>
        </AirportMap>
      </div>

      <UnsavedChangesDialog
        isOpen={showUnsavedDialog}
        onStay={handleStay}
        onDiscard={handleDiscard}
      />

      <GeoJsonEditorModal
        isOpen={showGeoJsonEditor}
        onClose={() => setShowGeoJsonEditor(false)}
        onApply={handleGeoJsonApply}
      />

      {id && (
        <ImageMetadataExtractorModal
          isOpen={showExtractor}
          onClose={() => setShowExtractor(false)}
          airportId={id}
          onHandoff={(h) => {
            setShowExtractor(false);
            creation.beginExtractorHandoff(h);
          }}
        />
      )}

      {airport && (
        <ConfirmDeleteDialog
          isOpen={showDeleteAirportDialog}
          name={airport.name}
          warnings={[
            ...(airport.surfaces.length > 0
              ? [t("coordinator.detail.deleteAirportWarnSurfaces", { count: airport.surfaces.length })]
              : []),
            ...(airport.obstacles.length > 0
              ? [t("coordinator.detail.deleteAirportWarnObstacles", { count: airport.obstacles.length })]
              : []),
            ...(airport.safety_zones.length > 0
              ? [t("coordinator.detail.deleteAirportWarnZones", { count: airport.safety_zones.length })]
              : []),
            t("coordinator.detail.deleteAirportWarnMissions"),
          ]}
          error={crud.deleteAirportError}
          onConfirm={crud.handleDeleteAirport}
          onCancel={() => {
            setShowDeleteAirportDialog(false);
            crud.setDeleteAirportError(null);
          }}
        />
      )}
    </div>
  );
}
