import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useResolvedAltitude } from "./useResolvedAltitude";
import type { ElevationResolver } from "@/utils/takeoffLandingPlacement";

function deferred() {
  /** promise with an externally controlled resolve, for racing resolver calls. */
  let resolve!: (v: number | null) => void;
  const promise = new Promise<number | null>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Args {
  effectiveEntityType: string;
  showAltInput: boolean;
  altResolveLat: number | null;
  altResolveLon: number | null;
  resolver?: ElevationResolver;
  airportElevation: number;
}

function baseArgs(over: Partial<Args> = {}): Args {
  /** default args - LHA entity at a fixed position over a 133.456m airport. */
  return {
    effectiveEntityType: "LHA",
    showAltInput: true,
    altResolveLat: 48.17,
    altResolveLon: 17.21,
    resolver: undefined,
    airportElevation: 133.456,
    ...over,
  };
}

describe("useResolvedAltitude request-id race guard", () => {
  it("discards a stale resolver result that lands after a newer request", async () => {
    const d1 = deferred();
    const d2 = deferred();
    const resolver = vi
      .fn()
      .mockReturnValueOnce(d1.promise)
      .mockReturnValueOnce(d2.promise);
    const { result, rerender } = renderHook((p: Args) => useResolvedAltitude(p), {
      initialProps: baseArgs({ resolver }),
    });
    expect(result.current.altLoading).toBe(true);

    // position change fires request 2 while request 1 is still in flight
    rerender(baseArgs({ resolver, altResolveLat: 48.18 }));
    expect(resolver).toHaveBeenCalledTimes(2);

    await act(async () => {
      d2.resolve(200);
    });
    expect(result.current.manualAlt).toBe("200");
    expect(result.current.altLoading).toBe(false);

    // request 1 resolves last but must not overwrite the newer value
    await act(async () => {
      d1.resolve(100);
    });
    expect(result.current.manualAlt).toBe("200");
    expect(result.current.altFallback).toBe(false);
  });
});

describe("useResolvedAltitude user-edit freeze", () => {
  it("keeps a manual edit and stops resolving on later position changes", async () => {
    const d1 = deferred();
    const resolver = vi.fn().mockReturnValue(d1.promise);
    const { result, rerender } = renderHook((p: Args) => useResolvedAltitude(p), {
      initialProps: baseArgs({ resolver }),
    });
    await act(async () => {
      d1.resolve(100);
    });
    expect(result.current.manualAlt).toBe("100");

    act(() => {
      result.current.handleAltChange("55");
    });
    expect(result.current.manualAlt).toBe("55");
    expect(result.current.altFallback).toBe(false);
    expect(result.current.altLoading).toBe(false);

    // marker drag after the edit must not re-resolve or overwrite
    rerender(baseArgs({ resolver, altResolveLat: 48.99 }));
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(result.current.manualAlt).toBe("55");
    expect(result.current.altLoading).toBe(false);
  });
});

describe("useResolvedAltitude fallback", () => {
  it("falls back to rounded airport elevation with the flag on a null result", async () => {
    const d1 = deferred();
    const resolver = vi.fn().mockReturnValue(d1.promise);
    const { result } = renderHook(() => useResolvedAltitude(baseArgs({ resolver })));
    expect(result.current.altLoading).toBe(true);
    expect(result.current.altFallback).toBe(false);

    await act(async () => {
      d1.resolve(null);
    });
    expect(result.current.manualAlt).toBe("133.46");
    expect(result.current.altFallback).toBe(true);
    expect(result.current.altLoading).toBe(false);
  });

  it("falls back immediately when no resolver is provided", () => {
    const { result } = renderHook(() => useResolvedAltitude(baseArgs()));
    expect(result.current.manualAlt).toBe("133.46");
    expect(result.current.altFallback).toBe(true);
    expect(result.current.altLoading).toBe(false);
  });
});

describe("useResolvedAltitude entity-type reset", () => {
  it("clears the resolved state when the entity type changes", () => {
    const { result, rerender } = renderHook((p: Args) => useResolvedAltitude(p), {
      initialProps: baseArgs(),
    });
    expect(result.current.manualAlt).toBe("133.46");
    expect(result.current.altFallback).toBe(true);

    rerender(baseArgs({ effectiveEntityType: "OBSTACLE" }));
    expect(result.current.manualAlt).toBe("");
    expect(result.current.altFallback).toBe(false);
    expect(result.current.altLoading).toBe(false);
  });

  it("unfreezes a user edit so the new entity gets a fresh lookup", async () => {
    const d1 = deferred();
    const d2 = deferred();
    const resolver = vi
      .fn()
      .mockReturnValueOnce(d1.promise)
      .mockReturnValueOnce(d2.promise);
    const { result, rerender } = renderHook((p: Args) => useResolvedAltitude(p), {
      initialProps: baseArgs({ resolver }),
    });
    await act(async () => {
      d1.resolve(100);
    });
    act(() => {
      result.current.handleAltChange("55");
    });
    expect(result.current.manualAlt).toBe("55");

    // entity switch resets the freeze and re-resolves at the same position
    rerender(baseArgs({ resolver, effectiveEntityType: "OBSTACLE" }));
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(result.current.altLoading).toBe(true);

    await act(async () => {
      d2.resolve(200);
    });
    expect(result.current.manualAlt).toBe("200");
  });
});
