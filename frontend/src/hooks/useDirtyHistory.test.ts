import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useDirtyHistory from "./useDirtyHistory";

describe("useDirtyHistory", () => {
  it("starts clean with no history", () => {
    const { result } = renderHook(() => useDirtyHistory());
    expect(result.current.isDirty).toBe(false);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.getPendingChanges()).toEqual([]);
  });

  it("marks dirty after markDirty call and enables undo", () => {
    const { result } = renderHook(() => useDirtyHistory());
    act(() => result.current.markDirty("surface", "s1", "update", { name: "RWY 09" }));
    expect(result.current.isDirty).toBe(true);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.getPendingChanges()).toHaveLength(1);
    expect(result.current.getPendingChanges()[0]).toEqual({
      entityType: "surface",
      entityId: "s1",
      action: "update",
      data: { name: "RWY 09" },
    });
  });

  it("undo of first edit clears the entry entirely", () => {
    const { result } = renderHook(() => useDirtyHistory());
    act(() => result.current.markDirty("agl", "a1", "update", { position: "A" }));
    act(() => result.current.undo());
    expect(result.current.isDirty).toBe(false);
    expect(result.current.getPendingChanges()).toEqual([]);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it("undo restores the prior entry value (multi-step regression)", () => {
    const { result } = renderHook(() => useDirtyHistory());
    act(() => result.current.markDirty("agl", "a1", "update", { position: "A" }));
    act(() => result.current.markDirty("agl", "a1", "update", { position: "B" }));
    expect(result.current.getPendingChanges()[0].data).toEqual({ position: "B" });

    act(() => result.current.undo());
    expect(result.current.getPendingChanges()[0].data).toEqual({ position: "A" });

    act(() => result.current.undo());
    expect(result.current.isDirty).toBe(false);
    expect(result.current.getPendingChanges()).toEqual([]);
  });

  it("redo replays the most recent undo", () => {
    const { result } = renderHook(() => useDirtyHistory());
    act(() => result.current.markDirty("agl", "a1", "update", { position: "A" }));
    act(() => result.current.undo());
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.redo());
    expect(result.current.isDirty).toBe(true);
    expect(result.current.getPendingChanges()[0].data).toEqual({ position: "A" });
    expect(result.current.canRedo).toBe(false);
  });

  it("a new edit clears the redo stack", () => {
    const { result } = renderHook(() => useDirtyHistory());
    act(() => result.current.markDirty("agl", "a1", "update", { position: "A" }));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.markDirty("agl", "a1", "update", { position: "B" }));
    expect(result.current.canRedo).toBe(false);
  });

  it("merges field changes for same entity", () => {
    const { result } = renderHook(() => useDirtyHistory());
    act(() => result.current.markDirty("surface", "s1", "update", { name: "RWY 09" }));
    act(() => result.current.markDirty("surface", "s1", "update", { length: 3000 }));
    expect(result.current.getPendingChanges()[0].data).toEqual({ name: "RWY 09", length: 3000 });
  });

  it("undo restores intermediate field values", () => {
    const { result } = renderHook(() => useDirtyHistory());
    act(() => result.current.markDirty("surface", "s1", "update", { name: "RWY 09" }));
    act(() => result.current.markDirty("surface", "s1", "update", { length: 3000 }));

    act(() => result.current.undo());
    expect(result.current.getPendingChanges()[0].data).toEqual({ name: "RWY 09" });

    act(() => result.current.undo());
    expect(result.current.isDirty).toBe(false);
  });

  it("tracks multiple entities independently in history", () => {
    const { result } = renderHook(() => useDirtyHistory());
    act(() => result.current.markDirty("surface", "s1", "update", { name: "A" }));
    act(() => result.current.markDirty("obstacle", "o1", "update", { height: 10 }));

    act(() => result.current.undo());
    expect(result.current.getPendingChanges()).toHaveLength(1);
    expect(result.current.getPendingChanges()[0].entityType).toBe("surface");

    act(() => result.current.undo());
    expect(result.current.isDirty).toBe(false);
  });

  it("clearAll resets dirty state and history", () => {
    const { result } = renderHook(() => useDirtyHistory());
    act(() => result.current.markDirty("surface", "s1", "update", { name: "A" }));
    act(() => result.current.markDirty("surface", "s1", "update", { name: "B" }));

    act(() => result.current.clearAll());
    expect(result.current.isDirty).toBe(false);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.getPendingChanges()).toEqual([]);
  });

  it("undo and redo are no-ops when stacks are empty", () => {
    const { result } = renderHook(() => useDirtyHistory());
    let undoResult: ReturnType<typeof result.current.undo> = null;
    let redoResult: ReturnType<typeof result.current.redo> = null;
    act(() => { undoResult = result.current.undo(); });
    act(() => { redoResult = result.current.redo(); });
    expect(undoResult).toBeNull();
    expect(redoResult).toBeNull();
    expect(result.current.isDirty).toBe(false);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("undo returns the step describing which entity changed and its resulting state", () => {
    const { result } = renderHook(() => useDirtyHistory());
    act(() => result.current.markDirty("agl", "a1", "update", { position: "A" }));
    act(() => result.current.markDirty("agl", "a1", "update", { position: "B" }));

    let step: ReturnType<typeof result.current.undo> = null;
    act(() => { step = result.current.undo(); });
    expect(step).toEqual({
      entityType: "agl",
      entityId: "a1",
      current: {
        entityType: "agl",
        entityId: "a1",
        action: "update",
        data: { position: "A" },
      },
    });

    act(() => { step = result.current.undo(); });
    expect(step).toEqual({
      entityType: "agl",
      entityId: "a1",
      current: null,
    });
  });

  it("redo returns the step describing the re-applied state", () => {
    const { result } = renderHook(() => useDirtyHistory());
    act(() => result.current.markDirty("surface", "s1", "update", { name: "RWY 09" }));
    act(() => result.current.undo());

    let step: ReturnType<typeof result.current.redo> = null;
    act(() => { step = result.current.redo(); });
    expect(step).toEqual({
      entityType: "surface",
      entityId: "s1",
      current: {
        entityType: "surface",
        entityId: "s1",
        action: "update",
        data: { name: "RWY 09" },
      },
    });
  });

  it("getPendingChange returns null for an unknown entity", () => {
    const { result } = renderHook(() => useDirtyHistory());
    expect(result.current.getPendingChange("lha", "missing")).toBeNull();
  });

  it("getPendingChange returns the merged data after markDirty", () => {
    const { result } = renderHook(() => useDirtyHistory());
    act(() => result.current.markDirty("lha", "lha-1", "update", { setting_angle: 4.2 }));
    const pending = result.current.getPendingChange("lha", "lha-1");
    expect(pending).toEqual({
      entityType: "lha",
      entityId: "lha-1",
      action: "update",
      data: { setting_angle: 4.2 },
    });
  });

  it("getPendingChange merges across multiple markDirty calls (last write wins per field)", () => {
    const { result } = renderHook(() => useDirtyHistory());
    act(() => result.current.markDirty("surface", "s1", "update", { name: "RWY 09" }));
    act(() => result.current.markDirty("surface", "s1", "update", { length: 3000 }));
    act(() => result.current.markDirty("surface", "s1", "update", { name: "RWY 27" }));
    expect(result.current.getPendingChange("surface", "s1")?.data).toEqual({
      name: "RWY 27",
      length: 3000,
    });
  });

  it("getPendingChange isolates entities by type+id", () => {
    const { result } = renderHook(() => useDirtyHistory());
    act(() => result.current.markDirty("surface", "s1", "update", { name: "A" }));
    act(() => result.current.markDirty("obstacle", "s1", "update", { name: "B" }));
    expect(result.current.getPendingChange("surface", "s1")?.data).toEqual({ name: "A" });
    expect(result.current.getPendingChange("obstacle", "s1")?.data).toEqual({ name: "B" });
  });

  it("getPendingChange returns null after clearAll", () => {
    const { result } = renderHook(() => useDirtyHistory());
    act(() => result.current.markDirty("lha", "lha-1", "update", { setting_angle: 4.2 }));
    act(() => result.current.clearAll());
    expect(result.current.getPendingChange("lha", "lha-1")).toBeNull();
  });

  it("getPendingChange returns the live state synchronously so render-time consumers see the latest patch", () => {
    const { result } = renderHook(() => useDirtyHistory());
    act(() => result.current.markDirty("lha", "lha-1", "update", { setting_angle: 4.2 }));
    // accessor returned from the latest render reflects the latest state
    expect(result.current.getPendingChange("lha", "lha-1")?.data).toEqual({ setting_angle: 4.2 });
    act(() => result.current.markDirty("lha", "lha-1", "update", { setting_angle: 4.5 }));
    expect(result.current.getPendingChange("lha", "lha-1")?.data).toEqual({ setting_angle: 4.5 });
  });

  it("caps history depth and drops the oldest entries", () => {
    const { result } = renderHook(() => useDirtyHistory());
    for (let i = 0; i < 25; i++) {
      act(() => result.current.markDirty("surface", "s1", "update", { tick: i }));
    }
    // 25 edits, capacity is 20 - we can only undo 20 times back to tick 4
    for (let i = 0; i < 20; i++) {
      act(() => result.current.undo());
    }
    expect(result.current.canUndo).toBe(false);
    // the oldest reachable state retains tick 4 (the value just before the 5th edit)
    expect(result.current.getPendingChanges()[0].data).toEqual({ tick: 4 });
  });
});
