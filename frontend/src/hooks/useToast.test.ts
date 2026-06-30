import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import useToast from "./useToast";

describe("useToast", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sets the message on show and clears it after the timeout", () => {
    const { result } = renderHook(() => useToast(1000));
    expect(result.current.message).toBeNull();

    act(() => result.current.show("hi"));
    expect(result.current.message).toBe("hi");

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.message).toBeNull();
  });

  it("resets the timer on a second show", () => {
    const { result } = renderHook(() => useToast(1000));
    act(() => result.current.show("a"));
    act(() => vi.advanceTimersByTime(800));
    act(() => result.current.show("b"));
    act(() => vi.advanceTimersByTime(800));
    expect(result.current.message).toBe("b");
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.message).toBeNull();
  });

  it("clears the pending timer on unmount", () => {
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const { result, unmount } = renderHook(() => useToast(1000));
    act(() => result.current.show("a"));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
