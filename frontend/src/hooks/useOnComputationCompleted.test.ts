import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useOnComputationCompleted } from "./useOnComputationCompleted";
import type { FlightPlanResponse } from "@/types/flightPlan";

// mutable computation snapshot read by the mocked context hook
const computation = vi.hoisted(() => ({
  state: {
    status: "IDLE",
    lastResult: null as FlightPlanResponse | null,
  },
}));

vi.mock("@/contexts/ComputationContext", () => ({
  useComputation: () => computation.state,
}));

const FLIGHT_PLAN = { id: "fp-1" } as unknown as FlightPlanResponse;

function renderAt(status: string, lastResult: FlightPlanResponse | null = null) {
  /** mount the hook with the computation context in the given state. */
  computation.state = { status, lastResult };
  const onCompleted = vi.fn();
  const view = renderHook(() => useOnComputationCompleted(onCompleted));
  return { view, onCompleted };
}

function setComputation(
  view: { rerender: () => void },
  status: string,
  lastResult: FlightPlanResponse | null,
) {
  /** swap the context snapshot and re-render so the effect sees it. */
  computation.state = { status, lastResult };
  view.rerender();
}

describe("useOnComputationCompleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fires exactly once with the result on COMPUTING -> COMPLETED", () => {
    const { view, onCompleted } = renderAt("COMPUTING");
    expect(onCompleted).not.toHaveBeenCalled();

    setComputation(view, "COMPLETED", FLIGHT_PLAN);
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(onCompleted).toHaveBeenCalledWith(FLIGHT_PLAN);
  });

  it("does not re-fire on repeated COMPLETED updates", () => {
    const { view, onCompleted } = renderAt("COMPUTING");
    setComputation(view, "COMPLETED", FLIGHT_PLAN);
    expect(onCompleted).toHaveBeenCalledTimes(1);

    // a fresh lastResult identity re-runs the effect but must not re-fire
    setComputation(view, "COMPLETED", { ...FLIGHT_PLAN });
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it("does not fire when mounted while already COMPLETED", () => {
    const { onCompleted } = renderAt("COMPLETED", FLIGHT_PLAN);
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it("does not fire on COMPUTING -> FAILED", () => {
    const { view, onCompleted } = renderAt("COMPUTING");
    setComputation(view, "FAILED", null);
    expect(onCompleted).not.toHaveBeenCalled();
  });
});
