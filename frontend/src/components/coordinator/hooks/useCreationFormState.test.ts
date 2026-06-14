import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { TFunction } from "i18next";
import type { SurfaceResponse } from "@/types/airport";
import { useCreationFormState } from "./useCreationFormState";

const t = ((key: string) => key) as unknown as TFunction;

const runwaySurface: SurfaceResponse = {
  id: "s1",
  airport_id: "a1",
  identifier: "06/24",
  surface_type: "RUNWAY",
  heading: 90,
  length: 3000,
  width: 45,
  geometry: {
    type: "LineString",
    coordinates: [
      [17.213, 48.17, 130],
      [17.265, 48.19, 130],
    ],
  },
  boundary: null,
  buffer_distance: 5.0,
  threshold_position: { type: "Point", coordinates: [17.213, 48.17, 130] },
  end_position: { type: "Point", coordinates: [17.265, 48.19, 130] },
  touchpoint_latitude: null,
  touchpoint_longitude: null,
  touchpoint_altitude: null,
  paired_surface_id: null,
  agls: [],
};

const taxiwaySurface: SurfaceResponse = {
  ...runwaySurface,
  id: "s2",
  identifier: "A",
  surface_type: "TAXIWAY",
};

describe("useCreationFormState - autofill removal", () => {
  it("surface runway autofill is a plain counter, no RWY literal", () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCreationFormState(
        {
          geometryType: "polygon",
          surfaces: [],
          onCancel: vi.fn(),
          onCreate,
        },
        t,
      ),
    );
    act(() => result.current.handleCategoryChange("surface"));
    act(() => result.current.setEntityType("runway"));
    expect(result.current.name).not.toMatch(/^RWY\s/);
    expect(result.current.name).not.toMatch(/^TWY\s/);
  });

  it("surface taxiway autofill is a plain counter, no TWY literal", () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCreationFormState(
        {
          geometryType: "polygon",
          surfaces: [],
          onCancel: vi.fn(),
          onCreate,
        },
        t,
      ),
    );
    act(() => result.current.handleCategoryChange("surface"));
    act(() => result.current.setEntityType("taxiway"));
    expect(result.current.name).not.toMatch(/^RWY\s/);
    expect(result.current.name).not.toMatch(/^TWY\s/);
  });

  it("AGL autofill on a runway surface includes the RWY token", () => {
    const { result } = renderHook(() =>
      useCreationFormState(
        {
          geometryType: "point",
          surfaces: [runwaySurface],
          pointPosition: [17.221, 48.173],
          onCancel: vi.fn(),
          onCreate: vi.fn().mockResolvedValue(undefined),
        },
        t,
      ),
    );
    act(() => result.current.handleCategoryChange("agl"));
    expect(result.current.name).toContain("06/24");
    expect(result.current.name).toMatch(/\bRWY\b/);
  });

  it("AGL autofill on a taxiway surface includes the TWY token", () => {
    const { result } = renderHook(() =>
      useCreationFormState(
        {
          geometryType: "point",
          surfaces: [taxiwaySurface],
          pointPosition: [17.221, 48.173],
          onCancel: vi.fn(),
          onCreate: vi.fn().mockResolvedValue(undefined),
        },
        t,
      ),
    );
    act(() => result.current.handleCategoryChange("agl"));
    expect(result.current.name).toContain("A");
    expect(result.current.name).toMatch(/\bTWY\b/);
  });
});

describe("useCreationFormState - runway threshold/end submit payload", () => {
  it("emits POINT Z threshold_position / end_position on runway submit", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCreationFormState(
        {
          geometryType: "polygon",
          surfaces: [],
          onCancel: vi.fn(),
          onCreate,
          centerlineEndpoints: [
            [17.213, 48.17],
            [17.265, 48.19],
          ],
          airportElevation: 130,
        },
        t,
      ),
    );
    act(() => result.current.handleCategoryChange("surface"));
    act(() => result.current.setEntityType("runway"));
    act(() => result.current.setName("06/24"));

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(onCreate).toHaveBeenCalled();
    const data = onCreate.mock.calls[0][1] as Record<string, unknown>;
    expect(data.threshold_position).toBe("POINT Z (17.213 48.17 130)");
    expect(data.end_position).toBe("POINT Z (17.265 48.19 130)");
  });

  it("swap toggle reverses which centerline endpoint goes to threshold_position", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCreationFormState(
        {
          geometryType: "polygon",
          surfaces: [],
          onCancel: vi.fn(),
          onCreate,
          centerlineEndpoints: [
            [17.213, 48.17],
            [17.265, 48.19],
          ],
          airportElevation: 130,
        },
        t,
      ),
    );
    act(() => result.current.handleCategoryChange("surface"));
    act(() => result.current.setEntityType("runway"));
    act(() => result.current.setName("06/24"));
    act(() => result.current.swapThresholdEnd());

    await act(async () => {
      await result.current.handleSubmit();
    });

    const data = onCreate.mock.calls[0][1] as Record<string, unknown>;
    expect(data.threshold_position).toBe("POINT Z (17.265 48.19 130)");
    expect(data.end_position).toBe("POINT Z (17.213 48.17 130)");
  });

  it("manual edits to threshold/end inputs flow into the submitted WKT", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCreationFormState(
        {
          geometryType: "polygon",
          surfaces: [],
          onCancel: vi.fn(),
          onCreate,
          centerlineEndpoints: [
            [17.213, 48.17],
            [17.265, 48.19],
          ],
          airportElevation: 130,
        },
        t,
      ),
    );
    act(() => result.current.handleCategoryChange("surface"));
    act(() => result.current.setEntityType("runway"));
    act(() => result.current.setName("06/24"));
    act(() => result.current.setThresholdLat("48.171"));
    act(() => result.current.setThresholdLon("17.214"));
    act(() => result.current.setEndLat("48.191"));
    act(() => result.current.setEndLon("17.266"));

    await act(async () => {
      await result.current.handleSubmit();
    });

    const data = onCreate.mock.calls[0][1] as Record<string, unknown>;
    expect(data.threshold_position).toBe("POINT Z (17.214 48.171 130)");
    expect(data.end_position).toBe("POINT Z (17.266 48.191 130)");
  });

  it("swap also swaps altitudes", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCreationFormState(
        {
          geometryType: "polygon",
          surfaces: [],
          onCancel: vi.fn(),
          onCreate,
          centerlineEndpoints: [
            [17.213, 48.17],
            [17.265, 48.19],
          ],
          airportElevation: 130,
        },
        t,
      ),
    );
    act(() => result.current.handleCategoryChange("surface"));
    act(() => result.current.setEntityType("runway"));
    act(() => result.current.setName("06/24"));
    act(() => result.current.setThresholdAlt("140"));
    act(() => result.current.setEndAlt("150"));
    act(() => result.current.swapThresholdEnd());
    expect(result.current.thresholdAlt).toBe("150");
    expect(result.current.endAlt).toBe("140");

    await act(async () => {
      await result.current.handleSubmit();
    });

    const data = onCreate.mock.calls[0][1] as Record<string, unknown>;
    expect(data.threshold_position).toBe("POINT Z (17.265 48.19 150)");
    expect(data.end_position).toBe("POINT Z (17.213 48.17 140)");
  });

  it("picked threshold coord populates lat/lon/alt and is consumed", () => {
    const onPickedThresholdConsumed = vi.fn();
    const { rerender, result } = renderHook(
      ({ pick }: { pick: { lat: number; lon: number; alt: number } | null }) =>
        useCreationFormState(
          {
            geometryType: "polygon",
            surfaces: [],
            onCancel: vi.fn(),
            onCreate: vi.fn().mockResolvedValue(undefined),
            centerlineEndpoints: [
              [17.213, 48.17],
              [17.265, 48.19],
            ],
            airportElevation: 130,
            pickedThresholdCoord: pick,
            onPickedThresholdConsumed,
          },
          t,
        ),
      { initialProps: { pick: null as { lat: number; lon: number; alt: number } | null } },
    );
    rerender({ pick: { lat: 48.18, lon: 17.22, alt: 145 } });
    expect(result.current.thresholdLat).toBe("48.18");
    expect(result.current.thresholdLon).toBe("17.22");
    expect(result.current.thresholdAlt).toBe("145");
    expect(onPickedThresholdConsumed).toHaveBeenCalled();
  });

  it("picked end coord populates lat/lon/alt and is consumed", () => {
    const onPickedEndConsumed = vi.fn();
    const { rerender, result } = renderHook(
      ({ pick }: { pick: { lat: number; lon: number; alt: number } | null }) =>
        useCreationFormState(
          {
            geometryType: "polygon",
            surfaces: [],
            onCancel: vi.fn(),
            onCreate: vi.fn().mockResolvedValue(undefined),
            centerlineEndpoints: [
              [17.213, 48.17],
              [17.265, 48.19],
            ],
            airportElevation: 130,
            pickedEndCoord: pick,
            onPickedEndConsumed,
          },
          t,
        ),
      { initialProps: { pick: null as { lat: number; lon: number; alt: number } | null } },
    );
    rerender({ pick: { lat: 48.2, lon: 17.27, alt: 155 } });
    expect(result.current.endLat).toBe("48.2");
    expect(result.current.endLon).toBe("17.27");
    expect(result.current.endAlt).toBe("155");
    expect(onPickedEndConsumed).toHaveBeenCalled();
  });

  it("taxiway submit does not include threshold_position / end_position", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useCreationFormState(
        {
          geometryType: "polygon",
          surfaces: [],
          onCancel: vi.fn(),
          onCreate,
          centerlineEndpoints: [
            [17.213, 48.17],
            [17.265, 48.19],
          ],
          airportElevation: 130,
        },
        t,
      ),
    );
    act(() => result.current.handleCategoryChange("surface"));
    act(() => result.current.setEntityType("taxiway"));
    act(() => result.current.setName("A"));

    await act(async () => {
      await result.current.handleSubmit();
    });

    const data = onCreate.mock.calls[0][1] as Record<string, unknown>;
    expect(data.threshold_position).toBeUndefined();
    expect(data.end_position).toBeUndefined();
  });
});

describe("useCreationFormState - live AGL distance prefill", () => {
  it("prefills distFromThreshold from threshold/end and lat/lon", async () => {
    const { result } = renderHook(() =>
      useCreationFormState(
        {
          geometryType: "point",
          surfaces: [runwaySurface],
          pointPosition: [17.221, 48.173],
          onCancel: vi.fn(),
          onCreate: vi.fn().mockResolvedValue(undefined),
        },
        t,
      ),
    );
    act(() => result.current.handleCategoryChange("agl"));

    await waitFor(() => {
      expect(result.current.distFromThreshold).not.toBe("");
    });
    const v = parseFloat(result.current.distFromThreshold);
    expect(v).toBeGreaterThan(500);
    expect(v).toBeLessThan(900);
  });

  it("operator edit freezes distFromThreshold against later lat/lon changes", async () => {
    const { result } = renderHook(() =>
      useCreationFormState(
        {
          geometryType: "point",
          surfaces: [runwaySurface],
          pointPosition: [17.221, 48.173],
          onCancel: vi.fn(),
          onCreate: vi.fn().mockResolvedValue(undefined),
        },
        t,
      ),
    );
    act(() => result.current.handleCategoryChange("agl"));

    await waitFor(() => {
      expect(result.current.distFromThreshold).not.toBe("");
    });

    act(() => result.current.handleDistFromThresholdChange("123.4"));
    expect(result.current.distFromThreshold).toBe("123.4");

    // change lat/lon - frozen field stays put
    act(() => result.current.setManualLat("48.180"));
    act(() => result.current.setManualLon("17.240"));
    expect(result.current.distFromThreshold).toBe("123.4");
  });
});
