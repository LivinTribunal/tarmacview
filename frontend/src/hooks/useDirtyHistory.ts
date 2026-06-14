import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

export interface PendingChange {
  entityType: string;
  entityId: string;
  action: "create" | "update" | "delete";
  data?: Record<string, unknown>;
}

export interface DirtyHistoryStep {
  entityType: string;
  entityId: string;
  // resulting state for this entity after the step. null when the entity has
  // no pending change anymore (i.e. undo rolled back the first edit).
  current: PendingChange | null;
}

interface HistoryEntry {
  key: string;
  prevEntry: PendingChange | null;
  nextEntry: PendingChange;
}

interface InternalState {
  changes: Map<string, PendingChange>;
  past: HistoryEntry[];
  future: HistoryEntry[];
}

interface DirtyHistoryReturn {
  isDirty: boolean;
  markDirty: (
    entityType: string,
    entityId: string,
    action: PendingChange["action"],
    data?: Record<string, unknown>,
  ) => void;
  clearAll: () => void;
  getPendingChanges: () => PendingChange[];
  getPendingChange: (entityType: string, entityId: string) => PendingChange | null;
  undo: () => DirtyHistoryStep | null;
  redo: () => DirtyHistoryStep | null;
  canUndo: boolean;
  canRedo: boolean;
}

const MAX_HISTORY = 20;

/** track pending edits with undo/redo support across entity types. */
export default function useDirtyHistory(): DirtyHistoryReturn {
  const [state, setState] = useState<InternalState>({
    changes: new Map(),
    past: [],
    future: [],
  });
  const stateRef = useRef(state);

  // sync the ref outside the setState updater so strictmode's double-invoke
  // doesn't run a side effect twice; updaters must stay pure.
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  const updateState = useCallback(
    (updater: (prev: InternalState) => InternalState) => {
      /** update internal state via a pure updater. */
      setState(updater);
    },
    [],
  );

  const markDirty = useCallback(
    (
      entityType: string,
      entityId: string,
      action: PendingChange["action"],
      data?: Record<string, unknown>,
    ) => {
      /** record a pending change, capturing prior entry for undo. */
      const key = `${entityType}:${entityId}`;
      updateState((prev) => {
        const prevEntry = prev.changes.get(key) ?? null;
        const nextEntry: PendingChange = {
          entityType,
          entityId,
          action,
          data: { ...prevEntry?.data, ...data },
        };
        const nextChanges = new Map(prev.changes);
        nextChanges.set(key, nextEntry);
        return {
          changes: nextChanges,
          past: [...prev.past, { key, prevEntry, nextEntry }].slice(-MAX_HISTORY),
          future: [],
        };
      });
    },
    [updateState],
  );

  const clearAll = useCallback(() => {
    /** clear all pending changes and history (e.g. after successful save). */
    updateState(() => ({ changes: new Map(), past: [], future: [] }));
  }, [updateState]);

  const getPendingChanges = useCallback(() => {
    /** return array of all pending changes via ref to avoid stale closures. */
    return Array.from(stateRef.current.changes.values());
  }, []);

  const getPendingChange = useCallback(
    (entityType: string, entityId: string): PendingChange | null => {
      /** look up the pending change for one entity. tracks live state so it
       * is safe to call during render - identity is not stable across renders. */
      return state.changes.get(`${entityType}:${entityId}`) ?? null;
    },
    [state.changes],
  );

  const undo = useCallback((): DirtyHistoryStep | null => {
    /** restore prior entry from top of past stack, or remove if none existed. */
    const cur = stateRef.current;
    if (cur.past.length === 0) return null;
    const top = cur.past[cur.past.length - 1];
    const step: DirtyHistoryStep = {
      entityType: top.nextEntry.entityType,
      entityId: top.nextEntry.entityId,
      current: top.prevEntry,
    };
    updateState((prev) => {
      if (prev.past.length === 0) return prev;
      const t = prev.past[prev.past.length - 1];
      const nextChanges = new Map(prev.changes);
      if (t.prevEntry) {
        nextChanges.set(t.key, t.prevEntry);
      } else {
        nextChanges.delete(t.key);
      }
      return {
        changes: nextChanges,
        past: prev.past.slice(0, -1),
        future: [t, ...prev.future].slice(0, MAX_HISTORY),
      };
    });
    return step;
  }, [updateState]);

  const redo = useCallback((): DirtyHistoryStep | null => {
    /** re-apply the next entry from top of future stack. */
    const cur = stateRef.current;
    if (cur.future.length === 0) return null;
    const top = cur.future[0];
    const step: DirtyHistoryStep = {
      entityType: top.nextEntry.entityType,
      entityId: top.nextEntry.entityId,
      current: top.nextEntry,
    };
    updateState((prev) => {
      if (prev.future.length === 0) return prev;
      const t = prev.future[0];
      const nextChanges = new Map(prev.changes);
      nextChanges.set(t.key, t.nextEntry);
      return {
        changes: nextChanges,
        past: [...prev.past, t].slice(-MAX_HISTORY),
        future: prev.future.slice(1),
      };
    });
    return step;
  }, [updateState]);

  const isDirty = useMemo(() => state.changes.size > 0, [state.changes]);

  return {
    isDirty,
    markDirty,
    clearAll,
    getPendingChanges,
    getPendingChange,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
