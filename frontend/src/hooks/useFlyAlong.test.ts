import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useFlyAlong from "./useFlyAlong";

describe("useFlyAlong", () => {
  it("starts with idle state", () => {
    const { result } = renderHook(() => useFlyAlong(5));
    expect(result.current.state.status).toBe("idle");
    expect(result.current.state.speed).toBe(2);
    expect(result.current.state.progress).toBe(0);
  });

  it("does nothing when play is called with fewer than two waypoints", () => {
    const { result } = renderHook(() => useFlyAlong(1));
    act(() => result.current.play());
    expect(result.current.state.status).toBe("idle");
  });

  it("transitions to playing on play from idle and resets progress", () => {
    const { result } = renderHook(() => useFlyAlong(5));
    act(() => result.current.setProgress(42));
    act(() => result.current.play());
    expect(result.current.state.status).toBe("playing");
    expect(result.current.state.progress).toBe(0);
  });

  it("pauses only when playing", () => {
    const { result } = renderHook(() => useFlyAlong(5));
    act(() => result.current.pause());
    expect(result.current.state.status).toBe("idle");
    act(() => result.current.play());
    act(() => result.current.pause());
    expect(result.current.state.status).toBe("paused");
  });

  it("resumes from paused without resetting progress", () => {
    const { result } = renderHook(() => useFlyAlong(5));
    act(() => result.current.play());
    act(() => result.current.setProgress(37));
    act(() => result.current.pause());
    expect(result.current.state.progress).toBe(37);
    act(() => result.current.play());
    expect(result.current.state.status).toBe("playing");
    expect(result.current.state.progress).toBe(37);
  });

  it("stop resets status and progress, preserves speed", () => {
    const { result } = renderHook(() => useFlyAlong(5));
    act(() => result.current.setSpeed(10));
    act(() => result.current.play());
    act(() => result.current.setProgress(50));
    act(() => result.current.stop());
    expect(result.current.state.status).toBe("idle");
    expect(result.current.state.progress).toBe(0);
    expect(result.current.state.speed).toBe(10);
  });

  it("setSpeed updates speed without changing status or progress", () => {
    const { result } = renderHook(() => useFlyAlong(5));
    act(() => result.current.play());
    act(() => result.current.setProgress(20));
    act(() => result.current.setSpeed(5));
    expect(result.current.state.speed).toBe(5);
    expect(result.current.state.status).toBe("playing");
    expect(result.current.state.progress).toBe(20);
  });

  it("setProgress clamps below 0 to 0", () => {
    const { result } = renderHook(() => useFlyAlong(5));
    act(() => result.current.setProgress(-15));
    expect(result.current.state.progress).toBe(0);
  });

  it("setProgress clamps above 100 to 100", () => {
    const { result } = renderHook(() => useFlyAlong(5));
    act(() => result.current.setProgress(150));
    expect(result.current.state.progress).toBe(100);
  });

  it("setProgress in range updates progress", () => {
    const { result } = renderHook(() => useFlyAlong(5));
    act(() => result.current.setProgress(63.5));
    expect(result.current.state.progress).toBe(63.5);
  });

  it("stops automatically when waypointCount drops below 2", () => {
    const { result, rerender } = renderHook(({ count }) => useFlyAlong(count), {
      initialProps: { count: 5 },
    });
    act(() => result.current.play());
    expect(result.current.state.status).toBe("playing");
    rerender({ count: 1 });
    expect(result.current.state.status).toBe("idle");
  });
});
