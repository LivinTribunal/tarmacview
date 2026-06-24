import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEASUREMENT_POLL_INTERVAL_MS } from "@/constants/ui";
import type { MeasurementStatus } from "@/types/measurement";
import {
  MeasurementProgressProvider,
  useMeasurementProgress,
} from "./MeasurementProgressContext";
import { getMeasurementStatus } from "@/api/measurements";

vi.mock("@/api/measurements", () => ({ getMeasurementStatus: vi.fn() }));
const statusMock = vi.mocked(getMeasurementStatus);

const SESSION_KEY = "tarmacview_measurement_progress";

/** test consumer exposing the count and the track/sync actions. */
function Harness() {
  const { activeCount, track, sync } = useMeasurementProgress();
  return (
    <div>
      <span data-testid="count">{activeCount}</span>
      <button data-testid="track" onClick={() => track(["m1", "m2"])} />
      <button data-testid="sync" onClick={() => sync(["m1", "m3"])} />
    </div>
  );
}

function renderProvider() {
  return render(
    <MeasurementProgressProvider>
      <Harness />
    </MeasurementProgressProvider>,
  );
}

/** advance one poll interval, flushing the chained async status fetches. */
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(MEASUREMENT_POLL_INTERVAL_MS);
  });
}

function count(): string {
  return screen.getByTestId("count").textContent ?? "";
}

describe("MeasurementProgressContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.useFakeTimers();
    statusMock.mockResolvedValue({ id: "x", status: "PROCESSING", error_message: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reflects the count of tracked runs", () => {
    renderProvider();
    expect(count()).toBe("0");

    act(() => {
      fireEvent.click(screen.getByTestId("track"));
    });
    expect(count()).toBe("2");
  });

  it("seeds new ids on sync without dropping tracked ones", () => {
    renderProvider();
    act(() => {
      fireEvent.click(screen.getByTestId("track")); // m1, m2
    });
    act(() => {
      fireEvent.click(screen.getByTestId("sync")); // m1 (dup), m3
    });
    // m1, m2, m3 - the duplicate m1 is not double-counted
    expect(count()).toBe("3");
  });

  it("decrements as each run leaves the active phases, clearing at zero", async () => {
    const statuses: Record<string, MeasurementStatus> = {
      m1: "PROCESSING",
      m2: "PROCESSING",
    };
    statusMock.mockImplementation((id) =>
      Promise.resolve({ id, status: statuses[id], error_message: null }),
    );

    renderProvider();
    act(() => {
      fireEvent.click(screen.getByTestId("track"));
    });
    expect(count()).toBe("2");

    // m1 finishes -> dropped, m2 still processing -> kept
    statuses.m1 = "DONE";
    await tick();
    expect(count()).toBe("1");

    // m2 pauses for confirmation -> also leaves the active count
    statuses.m2 = "AWAITING_CONFIRM";
    await tick();
    expect(count()).toBe("0");

    // nothing in flight -> the persisted key is cleared
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("drops a tracked id whose status poll 404s (deleted while active)", async () => {
    const notFound = Object.assign(new Error("not found"), {
      isAxiosError: true,
      response: { status: 404 },
    });
    statusMock.mockImplementation((id) =>
      id === "m1"
        ? Promise.reject(notFound)
        : Promise.resolve({ id, status: "PROCESSING", error_message: null }),
    );

    renderProvider();
    act(() => {
      fireEvent.click(screen.getByTestId("track")); // m1, m2
    });
    expect(count()).toBe("2");

    // m1 was deleted -> 404 -> dropped; m2 still processing -> kept
    await tick();
    expect(count()).toBe("1");
  });

  it("retains a tracked id whose poll fails with a non-404 (network) error", async () => {
    // a network blip must NOT drop a still-running run
    statusMock.mockImplementation((id) =>
      id === "m1"
        ? Promise.reject(new Error("network down"))
        : Promise.resolve({ id, status: "PROCESSING", error_message: null }),
    );

    renderProvider();
    act(() => {
      fireEvent.click(screen.getByTestId("track")); // m1, m2
    });
    expect(count()).toBe("2");

    await tick();
    expect(count()).toBe("2");
  });

  it("retains a tracked id whose poll fails with an axios 5xx", async () => {
    const serverError = Object.assign(new Error("boom"), {
      isAxiosError: true,
      response: { status: 500 },
    });
    statusMock.mockImplementation((id) =>
      id === "m1"
        ? Promise.reject(serverError)
        : Promise.resolve({ id, status: "PROCESSING", error_message: null }),
    );

    renderProvider();
    act(() => {
      fireEvent.click(screen.getByTestId("track")); // m1, m2
    });
    expect(count()).toBe("2");

    await tick();
    expect(count()).toBe("2");
  });

  it("rehydrates the active count from sessionStorage", () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(["a", "b"]));
    renderProvider();
    expect(count()).toBe("2");
  });
});
