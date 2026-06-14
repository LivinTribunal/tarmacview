import { describe, it, expect } from "vitest";
import type { PointZ } from "@/types/common";
import {
  applyWaypointUndo,
  applyWaypointRedo,
  type DirtyWaypoints,
  type WaypointMoveAction,
} from "./waypointHistory";

const oldPos: PointZ = { type: "Point", coordinates: [17.0, 48.0, 130] };
const newPos: PointZ = { type: "Point", coordinates: [17.1, 48.1, 130] };

describe("applyWaypointUndo", () => {
  it("drops the dirty entry when undoing the first edit on a clean waypoint", () => {
    // moving a clean waypoint pushes hadDirtyBefore: false
    const action: WaypointMoveAction = {
      waypointId: "wp-1",
      oldPosition: oldPos,
      newPosition: newPos,
      hadDirtyBefore: false,
    };
    const prev: DirtyWaypoints = {
      "wp-1": { position: newPos },
    };

    const next = applyWaypointUndo(prev, action);

    expect(next).not.toHaveProperty("wp-1");
    // isDirty derives from Object.keys(...).length === 0
    expect(Object.keys(next)).toHaveLength(0);
  });

  it("restores the prior position when undoing a follow-up edit", () => {
    const intermediatePos: PointZ = { type: "Point", coordinates: [17.05, 48.05, 130] };
    const action: WaypointMoveAction = {
      waypointId: "wp-1",
      oldPosition: intermediatePos,
      newPosition: newPos,
      hadDirtyBefore: true,
    };
    const prev: DirtyWaypoints = {
      "wp-1": { position: newPos },
    };

    const next = applyWaypointUndo(prev, action);

    expect(next["wp-1"]).toEqual({
      position: intermediatePos,
      camera_target: undefined,
    });
  });

  it("preserves camera_target when restoring", () => {
    const oldCam: PointZ = { type: "Point", coordinates: [17.0, 48.0, 0] };
    const action: WaypointMoveAction = {
      waypointId: "wp-1",
      oldPosition: oldPos,
      newPosition: newPos,
      oldCameraTarget: oldCam,
      newCameraTarget: null,
      hadDirtyBefore: true,
    };
    const prev: DirtyWaypoints = {
      "wp-1": { position: newPos, camera_target: null },
    };

    const next = applyWaypointUndo(prev, action);

    expect(next["wp-1"]).toEqual({ position: oldPos, camera_target: oldCam });
  });

  it("leaves other waypoints untouched", () => {
    const action: WaypointMoveAction = {
      waypointId: "wp-1",
      oldPosition: oldPos,
      newPosition: newPos,
      hadDirtyBefore: false,
    };
    const otherPos: PointZ = { type: "Point", coordinates: [18.0, 49.0, 200] };
    const prev: DirtyWaypoints = {
      "wp-1": { position: newPos },
      "wp-2": { position: otherPos },
    };

    const next = applyWaypointUndo(prev, action);

    expect(next).not.toHaveProperty("wp-1");
    expect(next["wp-2"]).toEqual({ position: otherPos });
  });

  it("does not mutate the input record", () => {
    const action: WaypointMoveAction = {
      waypointId: "wp-1",
      oldPosition: oldPos,
      newPosition: newPos,
      hadDirtyBefore: false,
    };
    const prev: DirtyWaypoints = {
      "wp-1": { position: newPos },
    };

    applyWaypointUndo(prev, action);

    expect(prev).toEqual({ "wp-1": { position: newPos } });
  });
});

describe("applyWaypointRedo", () => {
  it("re-applies the new position to the dirty set", () => {
    const action: WaypointMoveAction = {
      waypointId: "wp-1",
      oldPosition: oldPos,
      newPosition: newPos,
      hadDirtyBefore: false,
    };
    const prev: DirtyWaypoints = {};

    const next = applyWaypointRedo(prev, action);

    expect(next["wp-1"]).toEqual({ position: newPos, camera_target: undefined });
  });

  it("overwrites a stale entry with the redone position", () => {
    const stalePos: PointZ = { type: "Point", coordinates: [16.0, 47.0, 100] };
    const action: WaypointMoveAction = {
      waypointId: "wp-1",
      oldPosition: oldPos,
      newPosition: newPos,
      hadDirtyBefore: true,
    };
    const prev: DirtyWaypoints = {
      "wp-1": { position: stalePos },
    };

    const next = applyWaypointRedo(prev, action);

    expect(next["wp-1"].position).toEqual(newPos);
  });
});

describe("undo/redo round-trip on clean waypoint", () => {
  it("move + undo + redo restores the moved position with isDirty true", () => {
    const action: WaypointMoveAction = {
      waypointId: "wp-1",
      oldPosition: oldPos,
      newPosition: newPos,
      hadDirtyBefore: false,
    };
    // simulating: move pushed an action and set dirtyWaypoints[wp-1] = newPos
    let dirty: DirtyWaypoints = { "wp-1": { position: newPos } };

    dirty = applyWaypointUndo(dirty, action);
    expect(Object.keys(dirty)).toHaveLength(0);

    dirty = applyWaypointRedo(dirty, action);
    expect(dirty["wp-1"].position).toEqual(newPos);
    expect(Object.keys(dirty)).toHaveLength(1);
  });
});
