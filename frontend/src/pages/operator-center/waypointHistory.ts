import type { PointZ } from "@/types/common";

export interface WaypointMoveAction {
  waypointId: string;
  oldPosition: PointZ;
  newPosition: PointZ;
  oldCameraTarget?: PointZ | null;
  newCameraTarget?: PointZ | null;
  // false when this push created the first dirty entry for the waypoint -
  // undoing it removes the entry entirely so the dirty flag returns to clean.
  hadDirtyBefore: boolean;
}

export type DirtyWaypoints = Record<
  string,
  { position: PointZ; camera_target?: PointZ | null }
>;

/** roll back a waypoint move; drop the entry when this was the first edit. */
export function applyWaypointUndo(
  prev: DirtyWaypoints,
  action: WaypointMoveAction,
): DirtyWaypoints {
  if (!action.hadDirtyBefore) {
    const next = { ...prev };
    delete next[action.waypointId];
    return next;
  }
  return {
    ...prev,
    [action.waypointId]: {
      position: action.oldPosition,
      camera_target: action.oldCameraTarget,
    },
  };
}

/** replay a previously undone waypoint move into the dirty set. */
export function applyWaypointRedo(
  prev: DirtyWaypoints,
  action: WaypointMoveAction,
): DirtyWaypoints {
  return {
    ...prev,
    [action.waypointId]: {
      position: action.newPosition,
      camera_target: action.newCameraTarget,
    },
  };
}
