import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useAngleLock from "./useAngleLock";

describe("useAngleLock", () => {
  it("reflects the parent-owned angleLocked prop across rerenders", () => {
    const onChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ angleLocked }) =>
        useAngleLock({
          angleLocked,
          configOverride: {},
          onChange,
          distanceFromLha: 10,
          cameraGimbalAngle: -45,
        }),
      { initialProps: { angleLocked: false } },
    );
    act(() => result.current.onDistanceChange("10"));
    expect(onChange.mock.calls[0][0]).not.toHaveProperty("height_above_lha");

    rerender({ angleLocked: true });
    act(() => result.current.onDistanceChange("10"));
    const arg = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(arg.height_above_lha).toBeCloseTo(10, 5);
  });

  it("lock off: editing distance does not recompute height", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useAngleLock({
        angleLocked: false,
        configOverride: {},
        onChange,
        distanceFromLha: "",
        cameraGimbalAngle: -45,
      }),
    );
    act(() => result.current.onDistanceChange("5"));
    expect(onChange).toHaveBeenCalledWith({ distance_from_lha: 5 });
    expect(onChange.mock.calls[0][0]).not.toHaveProperty("height_above_lha");
  });

  it("lock on: editing distance recomputes height from the gimbal angle", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useAngleLock({
        angleLocked: true,
        configOverride: {},
        onChange,
        distanceFromLha: "",
        cameraGimbalAngle: -45,
      }),
    );
    act(() => result.current.onDistanceChange("10"));
    const arg = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(arg.distance_from_lha).toBe(10);
    expect(arg.height_above_lha).toBeCloseTo(10, 5);
  });

  it("lock on: editing height recomputes the gimbal angle from the distance", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useAngleLock({
        angleLocked: true,
        configOverride: {},
        onChange,
        distanceFromLha: 10,
        cameraGimbalAngle: "",
      }),
    );
    act(() => result.current.onHeightChange("10"));
    const arg = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(arg.height_above_lha).toBe(10);
    expect(arg.camera_gimbal_angle).toBeCloseTo(-45, 5);
  });

  it("lock on: editing angle recomputes height from the distance", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useAngleLock({
        angleLocked: true,
        configOverride: {},
        onChange,
        distanceFromLha: 10,
        cameraGimbalAngle: "",
      }),
    );
    act(() => result.current.onAngleChange("-45"));
    const arg = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(arg.camera_gimbal_angle).toBe(-45);
    expect(arg.height_above_lha).toBeCloseTo(10, 5);
  });

  it("lock on: empty input clears the field and skips recompute", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useAngleLock({
        angleLocked: true,
        configOverride: {},
        onChange,
        distanceFromLha: 10,
        cameraGimbalAngle: -45,
      }),
    );
    act(() => result.current.onDistanceChange(""));
    const arg = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(arg.distance_from_lha).toBeNull();
    expect(arg).not.toHaveProperty("height_above_lha");
  });

  it("preserves existing configOverride keys", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useAngleLock({
        angleLocked: false,
        configOverride: { altitude_offset: 3 },
        onChange,
        distanceFromLha: "",
        cameraGimbalAngle: "",
      }),
    );
    act(() => result.current.onHeightChange("7"));
    expect(onChange).toHaveBeenCalledWith({
      altitude_offset: 3,
      height_above_lha: 7,
    });
  });
});
