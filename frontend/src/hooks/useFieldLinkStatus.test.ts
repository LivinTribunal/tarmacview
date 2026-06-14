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
  broker_connected: true,
  devices: [],
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

    expect(result.current).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toEqual(ONLINE);
  });

  it("degrades a failed poll to the no-hub shape", async () => {
    mockedGet.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useFieldLinkStatus());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toEqual({
      hub_online: false,
      broker_connected: false,
      devices: [],
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
