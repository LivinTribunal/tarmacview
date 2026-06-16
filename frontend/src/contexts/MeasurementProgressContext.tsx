import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getMeasurementStatus } from "@/api/measurements";
import { MEASUREMENT_POLL_INTERVAL_MS } from "@/constants/ui";
import type { MeasurementStatus } from "@/types/measurement";

const SESSION_KEY = "tarmacview_measurement_progress";

// phases where the worker is still running - a run leaving these (DONE / ERROR /
// AWAITING_CONFIRM) drops out of the in-flight count
const ACTIVE_STATUSES: MeasurementStatus[] = ["QUEUED", "FIRST_FRAME", "PROCESSING"];

function loadSessionState(): string[] {
  /** rehydrate the tracked ids from session storage, tolerating bad payloads. */
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveSessionState(ids: string[]): void {
  /** persist the tracked ids, clearing the key once nothing is in flight. */
  try {
    if (ids.length === 0) sessionStorage.removeItem(SESSION_KEY);
    else sessionStorage.setItem(SESSION_KEY, JSON.stringify(ids));
  } catch {
    // storage unavailable
  }
}

interface MeasurementProgressContextValue {
  activeCount: number;
  track: (ids: string[]) => void;
  sync: (ids: string[]) => void;
}

const MeasurementProgressContext = createContext<MeasurementProgressContextValue | null>(null);

/** provider for the in-flight measurement count behind the corner progress toast. */
export function MeasurementProgressProvider({ children }: { children: ReactNode }) {
  const [activeIds, setActiveIds] = useState<string[]>(loadSessionState);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    saveSessionState(activeIds);
  }, [activeIds]);

  // add ids without dropping anything already tracked
  const addIds = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setActiveIds((prev) => {
      const next = new Set(prev);
      const before = next.size;
      ids.forEach((id) => next.add(id));
      return next.size === before ? prev : Array.from(next);
    });
  }, []);

  // register freshly-started runs (upload-dialog kickoff)
  const track = useCallback((ids: string[]) => addIds(ids), [addIds]);

  // seed any active runs the list discovered that we're not already tracking;
  // the per-id poll below is the source of truth for dropping finished ones
  const sync = useCallback((ids: string[]) => addIds(ids), [addIds]);

  // poll each tracked run; drop the ones that have left the active phases
  useEffect(() => {
    if (activeIds.length === 0) return;
    let cancelled = false;
    const handle = setInterval(async () => {
      const results = await Promise.allSettled(activeIds.map((id) => getMeasurementStatus(id)));
      if (cancelled || !mountedRef.current) return;
      const settled = results.flatMap((r, i) =>
        r.status === "fulfilled" && !ACTIVE_STATUSES.includes(r.value.status)
          ? [activeIds[i]]
          : [],
      );
      if (settled.length > 0) {
        setActiveIds((prev) => prev.filter((id) => !settled.includes(id)));
      }
    }, MEASUREMENT_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [activeIds]);

  const value = useMemo<MeasurementProgressContextValue>(
    () => ({ activeCount: activeIds.length, track, sync }),
    [activeIds, track, sync],
  );

  return (
    <MeasurementProgressContext.Provider value={value}>
      {children}
    </MeasurementProgressContext.Provider>
  );
}

/** read the measurement-progress context - must be used within its provider. */
export function useMeasurementProgress(): MeasurementProgressContextValue {
  const ctx = useContext(MeasurementProgressContext);
  if (!ctx) {
    throw new Error("useMeasurementProgress must be used within MeasurementProgressProvider");
  }
  return ctx;
}
