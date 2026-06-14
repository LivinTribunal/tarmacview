import { useState, useCallback, useEffect, useRef } from "react";

import { getMission, updateMission } from "@/api/missions";
import type { ElevationResolver } from "@/utils/takeoffLandingPlacement";
import type { AirportDetailResponse } from "@/types/airport";
import type { MissionDetailResponse } from "@/types/mission";
import useMapTools, { MapTool } from "@/hooks/useMapTools";
import useMeasureDistance from "@/hooks/useMeasureDistance";
import useHeadingTool from "@/hooks/useHeadingTool";
import {
  computePlacementUpdates,
  placementKeysFromUpdates,
} from "@/utils/takeoffLandingPlacement";
import { matchUndoRedoShortcut } from "@/utils/keyboardShortcuts";

type MeasureTool = ReturnType<typeof useMeasureDistance>;
type HeadingTool = ReturnType<typeof useHeadingTool>;

interface UseMapInteractionToolsParams {
  id: string | undefined;
  mission: MissionDetailResponse | null;
  setMission: React.Dispatch<React.SetStateAction<MissionDetailResponse | null>>;
  airportDetail: AirportDetailResponse | null;
  useTakeoffAsLanding: boolean;
  resolveElevation: ElevationResolver | undefined;
  refreshMissions: () => Promise<void>;
  showNotification: (msg: string) => void;
  handleUndo: () => void;
  handleRedo: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

interface MapInteractionToolsReturn {
  activeTool: MapTool;
  is3D: boolean;
  setTool: (tool: MapTool) => void;
  resetTool: () => void;
  setIs3D: (val: boolean) => void;
  measure: MeasureTool;
  heading: HeadingTool;
  pendingPlacement: Set<"takeoff" | "landing">;
  handleMapClick: (lngLat: { lng: number; lat: number }) => Promise<void>;
  handleToolChange: (tool: MapTool) => void;
}

/** owns the map tools, measure/heading, placement, click/tool/keyboard handlers. */
export default function useMapInteractionTools({
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
}: UseMapInteractionToolsParams): MapInteractionToolsReturn {
  // tools
  const { activeTool, is3D, setTool, resetTool, setIs3D } = useMapTools();
  const measure = useMeasureDistance();
  const heading = useHeadingTool();

  // pending (optimistic) save state for takeoff/landing placement
  const [pendingPlacement, setPendingPlacement] = useState<Set<"takeoff" | "landing">>(new Set());

  // handle map click based on active tool
  const handleMapClick = useCallback(
    async (lngLat: { lng: number; lat: number }) => {
      if (activeTool === MapTool.PLACE_TAKEOFF || activeTool === MapTool.PLACE_LANDING) {
        if (!id || !mission) return;
        const updates = await computePlacementUpdates(
          activeTool,
          lngLat,
          mission,
          airportDetail?.elevation,
          useTakeoffAsLanding,
          resolveElevation,
        );
        if (!updates) return;

        const pendingKeys = new Set<"takeoff" | "landing">(
          placementKeysFromUpdates(updates),
        );
        setPendingPlacement((prev) => new Set([...prev, ...pendingKeys]));

        resetTool();
        try {
          await updateMission(id, updates);
          const fresh = await getMission(id);
          setMission(fresh);
          refreshMissions();
        } catch (err) {
          console.error("map save error:", err instanceof Error ? err.message : String(err));
          showNotification(t("map.saveError"));
        } finally {
          setPendingPlacement((prev) => {
            const next = new Set(prev);
            for (const k of pendingKeys) next.delete(k);
            return next;
          });
        }
        return;
      }

      if (activeTool === MapTool.MEASURE && (measure.isDrawing || !measure.hasPoints)) {
        measure.addPoint(lngLat.lng, lngLat.lat);
        return;
      }

      if (activeTool === MapTool.HEADING) {
        heading.addPoint(lngLat.lng, lngLat.lat);
        return;
      }

      if (activeTool === MapTool.ZOOM) {
        // zoom click handled by map natively, this is a fallback
        return;
      }
    },
    [activeTool, id, mission, measure, heading, refreshMissions, resetTool, t, airportDetail, useTakeoffAsLanding, resolveElevation, setMission, showNotification],
  );

  // handle tool change
  const handleToolChange = useCallback(
    (tool: MapTool) => {
      if (tool === MapTool.ZOOM_RESET) {
        // handled by zoom reset callback
        return;
      }
      // dismiss measure when switching away
      if (activeTool === MapTool.MEASURE && tool !== MapTool.MEASURE) {
        measure.dismiss();
      }
      // dismiss heading when switching away
      if (activeTool === MapTool.HEADING && tool !== MapTool.HEADING) {
        heading.dismiss();
      }
      setTool(tool);
    },
    [activeTool, measure, heading, setTool],
  );

  // keep latest undo/redo refs so the window listener never sees a stale closure
  const handleUndoRef = useRef(handleUndo);
  const handleRedoRef = useRef(handleRedo);
  useEffect(() => {
    handleUndoRef.current = handleUndo;
    handleRedoRef.current = handleRedo;
  });

  // ESC key handler - clear measure, reset tool
  // Ctrl+Z / Ctrl+Shift+Z for undo/redo
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "Escape") {
        if (measure.isComplete) {
          measure.dismiss();
          return;
        }
        if (heading.isComplete) {
          heading.dismiss();
          return;
        }
        if (activeTool === MapTool.MEASURE) {
          measure.clear();
        }
        if (activeTool === MapTool.HEADING) {
          heading.clear();
        }
        resetTool();
        return;
      }

      const undoRedo = matchUndoRedoShortcut(e);
      if (undoRedo === "undo") {
        e.preventDefault();
        handleUndoRef.current();
        return;
      }
      if (undoRedo === "redo") {
        e.preventDefault();
        handleRedoRef.current();
        return;
      }

    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeTool, measure, heading, resetTool]);

  return {
    activeTool,
    is3D,
    setTool,
    resetTool,
    setIs3D,
    measure,
    heading,
    pendingPlacement,
    handleMapClick,
    handleToolChange,
  };
}
