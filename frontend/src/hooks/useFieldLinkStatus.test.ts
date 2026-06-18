import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useFieldLinkStatus } from "./useFieldLinkStatus";
import { getFieldLinkStatus } from "@/api/fieldLink";
import type { FieldLinkStatusResponse } from "@/types/fieldLink";

vi.mock("@/api/fieldLink", () => ({
  getFieldLinkStatus: vi.fn(),
}));

const mockedGet = vi.mocked(getFieldLinkStatus);

const ONLINE: FieldLinkStatusResponse = {
  hub_online: true,
  rc_connected: true,
  broker_connected: true,
  devices: [],
  connect_url: null,
  public_host: null,
};

beforeEach(() => {
  mockedGet.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useFieldLinkStatus", () => {
  it("is null until the first response, then carries the status", async () => {
    mockedGet.mockResolvedValue(ONLINE);
    const { result } = renderHook(() => useFieldLinkStatus());

    expect(result.current.status).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toEqual(ONLINE);
  });

  it("refresh triggers an immediate re-check and stamps lastChecked", async () => {
    mockedGet.mockResolvedValue(ONLINE);
    const { result } = renderHook(() => useFieldLinkStatus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockedGet).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });
    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(result.current.lastChecked).not.toBeNull();
  });

  it("degrades a failed poll to the no-hub shape", async () => {
    mockedGet.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useFieldLinkStatus());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toEqual({
      hub_online: false,
      rc_connected: false,
      broker_connected: false,
      devices: [],
      connect_url: null,
      public_host: null,
    });
  });

  it("refetches the status every poll interval", async () => {
    mockedGet.mockResolvedValue(ONLINE);
    renderHook(() => useFieldLinkStatus());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockedGet).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mockedGet).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mockedGet).toHaveBeenCalledTimes(3);
  });

  it("flips checking only for manual refreshes, not background polls", async () => {
    mockedGet.mockResolvedValue(ONLINE);
    const { result } = renderHook(() => useFieldLinkStatus());

    // initial poll + an interval tick must never set checking
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.checking).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current.checking).toBe(false);

    // a manual refresh flips checking true while in flight, false once resolved
    let release!: (v: FieldLinkStatusResponse) => void;
    mockedGet.mockReturnValueOnce(
      new Promise<FieldLinkStatusResponse>((resolve) => {
        release = resolve;
      }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.refresh();
    });
    expect(result.current.checking).toBe(true);

    await act(async () => {
      release(ONLINE);
      await pending;
    });
    expect(result.current.checking).toBe(false);
  });

  it("stops polling on unmount", async () => {
    mockedGet.mockResolvedValue(ONLINE);
    const { unmount } = renderHook(() => useFieldLinkStatus());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });
});
