import { useState, useCallback, useMemo } from "react";

import {
  getMission,
  updateMission,
  batchUpdateWaypoints,
  insertTransitWaypoint,
  deleteTransitWaypoint,
} from "@/api/missions";
import type { ElevationResolver } from "@/utils/takeoffLandingPlacement";
import type { MissionDetailResponse, MissionResponse } from "@/types/mission";
import type {
  FlightPlanResponse,
  WaypointResponse,
  WaypointPositionUpdate,
} from "@/types/flightPlan";
import type { PointZ } from "@/types/common";
import useUndoRedo from "@/hooks/useUndoRedo";
import {
  applyWaypointUndo,
  applyWaypointRedo,
  type WaypointMoveAction,
} from "@/pages/operator-center/waypointHistory";

interface UseWaypointEditingParams {
  id: string | undefined;
  flightPlan: FlightPlanResponse | null;
  setFlightPlan: React.Dispatch<React.SetStateAction<FlightPlanResponse | null>>;
  setMission: React.Dispatch<React.SetStateAction<MissionDetailResponse | null>>;
  setLastSaved: React.Dispatch<React.SetStateAction<Date | null>>;
  resolveElevation: ElevationResolver | undefined;
  useTakeoffAsLanding: boolean;
  refreshMissions: () => Promise<void>;
  updateMissionFromPage: (m: MissionResponse) => void;
  showNotification: (msg: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

interface WaypointEditingReturn {
  dirtyWaypoints: Record<string, { position: PointZ; camera_target?: PointZ | null }>;
  setDirtyWaypoints: React.Dispatch<
    React.SetStateAction<Record<string, { position: PointZ; camera_target?: PointZ | null }>>
  >;
  effectiveWaypoints: WaypointResponse[];
  isDirty: boolean;
  saving: boolean;
  handleSave: () => Promise<void>;
  handleWaypointDrag: (wpId: string, newPos: [number, number, number]) => Promise<void>;
  handleTransitInsert: (
    position: [number, number, number],
    afterSequence: number,
  ) => Promise<void>;
  handleTransitDelete: (waypointId: string) => Promise<void>;
  handleUndo: () => void;
  handleRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  clearHistory: () => void;
}

/** owns dirty waypoint edits, undo/redo, and the save/drag/transit handlers. */
export default function useWaypointEditing({
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
}: UseWaypointEditingParams): WaypointEditingReturn {
  const [saving, setSaving] = useState(false);

  const {
    push: pushUndo,
    undo: undoFn,
    redo: redoFn,
    clear: clearHistory,
    canUndo,
    canRedo,
  } = useUndoRedo<WaypointMoveAction>(10);

  // dirty waypoint modifications
  const [dirtyWaypoints, setDirtyWaypoints] = useState<
    Record<string, { position: PointZ; camera_target?: PointZ | null }>
  >({});

  const isDirty = Object.keys(dirtyWaypoints).length > 0;

  // waypoints with dirty overrides applied
  const effectiveWaypoints = useMemo((): WaypointResponse[] => {
    if (!flightPlan) return [];
    return flightPlan.waypoints.map((wp) => {
      const dirty = dirtyWaypoints[wp.id];
      if (!dirty) return wp;
      return {
        ...wp,
        position: dirty.position,
        camera_target: dirty.camera_target !== undefined ? dirty.camera_target : wp.camera_target,
      };
    });
  }, [flightPlan, dirtyWaypoints]);

  // handle save - batch update waypoints
  const handleSave = useCallback(async () => {
    if (!id || !isDirty) return;
    setSaving(true);
    try {
      // for dragged TAKEOFF/LANDING waypoints, snap alt to ground via the same
      // elevation resolver used by PLACE_TAKEOFF/PLACE_LANDING clicks - the
      // server is pass-through for this path, so the client owns the ground snap.
      const wpTypeById = new Map<string, string>();
      if (flightPlan) {
        for (const wp of flightPlan.waypoints) wpTypeById.set(wp.id, wp.waypoint_type);
      }
      const resolved: WaypointPositionUpdate[] = await Promise.all(
        Object.entries(dirtyWaypoints).map(async ([waypointId, data]) => {
          const wpType = wpTypeById.get(waypointId);
          let position = data.position;
          if (
            resolveElevation &&
            (wpType === "TAKEOFF" || wpType === "LANDING") &&
            position.coordinates.length >= 2
          ) {
            const [lon, lat] = position.coordinates;
            const ground = await resolveElevation(lat, lon);
            if (ground !== null && ground !== undefined) {
              position = {
                ...position,
                coordinates: [lon, lat, ground],
              };
            }
          }
          return {
            waypoint_id: waypointId,
            position,
            ...(data.camera_target !== undefined
              ? { camera_target: data.camera_target }
              : {}),
          };
        }),
      );
      const updates: WaypointPositionUpdate[] = resolved;
      const updatedFp = await batchUpdateWaypoints(id, updates);
      setFlightPlan(updatedFp);
      setDirtyWaypoints({});
      clearHistory();

      // re-read mission status
      const fresh = await getMission(id);
      setMission(fresh);
      updateMissionFromPage(fresh);
      refreshMissions();
      setLastSaved(new Date());
      showNotification(t("map.changesSaved"));
    } catch (err) {
      console.error("map save error:", err instanceof Error ? err.message : String(err));
      showNotification(t("map.saveError"));
    } finally {
      setSaving(false);
    }
  }, [
    id,
    isDirty,
    dirtyWaypoints,
    flightPlan,
    resolveElevation,
    clearHistory,
    t,
    refreshMissions,
    updateMissionFromPage,
  ]);

  // handle undo
  const handleUndo = useCallback(() => {
    const action = undoFn();
    if (!action) return;
    setDirtyWaypoints((prev) => applyWaypointUndo(prev, action));
  }, [undoFn]);

  // handle redo
  const handleRedo = useCallback(() => {
    const action = redoFn();
    if (!action) return;
    setDirtyWaypoints((prev) => applyWaypointRedo(prev, action));
  }, [redoFn]);

  // handle waypoint drag from map
  const handleWaypointDrag = useCallback(
    async (wpId: string, newPos: [number, number, number]) => {
      // standalone T/L markers - persist directly as mission coordinate update.
      // resolve ground via the same elevation API used by PLACE_TAKEOFF /
      // PLACE_LANDING click placement, so a drag does not stash the old alt
      // verbatim (server is pass-through for this path, client owns the snap).
      if (wpId === "takeoff" || wpId === "landing") {
        if (!id) return;
        let resolvedPos: [number, number, number] = [...newPos] as [number, number, number];
        if (resolveElevation) {
          const ground = await resolveElevation(resolvedPos[1], resolvedPos[0]);
          if (ground !== null && ground !== undefined) {
            resolvedPos = [resolvedPos[0], resolvedPos[1], ground];
          }
        }
        const newCoord: PointZ = { type: "Point", coordinates: resolvedPos };
        const updates: Record<string, PointZ> =
          wpId === "takeoff"
            ? { takeoff_coordinate: newCoord }
            : { landing_coordinate: newCoord };

        // mirror takeoff to landing for round-trip missions
        if (wpId === "takeoff" && useTakeoffAsLanding) {
          updates.landing_coordinate = {
            type: "Point",
            coordinates: [...resolvedPos] as [number, number, number],
          };
        }

        try {
          await updateMission(id, updates);
          const fresh = await getMission(id);
          setMission(fresh);
          refreshMissions();
        } catch (err) {
          console.error("T/L drag save error:", err instanceof Error ? err.message : String(err));
          showNotification(t("map.saveError"));
        }
        return;
      }

      const wp = effectiveWaypoints.find((w) => w.id === wpId);
      if (!wp) return;
      const newPosition: PointZ = { type: "Point", coordinates: newPos };
      pushUndo({
        waypointId: wpId,
        oldPosition: wp.position,
        newPosition,
        hadDirtyBefore: wpId in dirtyWaypoints,
      });
      setDirtyWaypoints((prev) => ({
        ...prev,
        [wpId]: { position: newPosition },
      }));
    },
    [
      effectiveWaypoints,
      pushUndo,
      id,
      useTakeoffAsLanding,
      refreshMissions,
      t,
      dirtyWaypoints,
      resolveElevation,
    ],
  );

  // handle transit waypoint insertion from map click on transit path
  const handleTransitInsert = useCallback(
    async (position: [number, number, number], afterSequence: number) => {
      if (!id) return;
      try {
        const updatedFp = await insertTransitWaypoint(
          id,
          { type: "Point", coordinates: position },
          afterSequence,
        );
        setFlightPlan(updatedFp);
        setDirtyWaypoints({});
        clearHistory();
        const fresh = await getMission(id);
        setMission(fresh);
        updateMissionFromPage(fresh);
        refreshMissions();
        showNotification(t("map.insertTransit"));
      } catch (err) {
        console.error("transit insert error:", err instanceof Error ? err.message : String(err));
        showNotification(t("map.saveError"));
      }
    },
    [id, clearHistory, t, refreshMissions, updateMissionFromPage],
  );

  // handle transit waypoint deletion from double-click
  const handleTransitDelete = useCallback(
    async (waypointId: string) => {
      if (!id) return;
      try {
        const updatedFp = await deleteTransitWaypoint(id, waypointId);
        setFlightPlan(updatedFp);
        setDirtyWaypoints({});
        clearHistory();
        const fresh = await getMission(id);
        setMission(fresh);
        updateMissionFromPage(fresh);
        refreshMissions();
        showNotification(t("map.deleteTransit"));
      } catch (err) {
        console.error("transit delete error:", err instanceof Error ? err.message : String(err));
        showNotification(t("map.saveError"));
      }
    },
    [id, clearHistory, t, refreshMissions, updateMissionFromPage],
  );

  return {
    dirtyWaypoints,
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
  };
}
