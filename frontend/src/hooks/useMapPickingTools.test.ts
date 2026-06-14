import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { AirportDetailResponse } from "@/types/airport";
import type { MapFeature } from "@/types/map";
import useMapPickingTools from "./useMapPickingTools";

const airport = { elevation: 100 } as unknown as AirportDetailResponse;

const surfaceFeature = {
  type: "surface",
  data: { id: "s1", surface_type: "RUNWAY", touchpoint_altitude: 42, threshold_position: null, end_position: null },
} as unknown as MapFeature;

const aglFeature = {
  type: "agl",
  data: { id: "a1", position: { type: "Point", coordinates: [1, 2, 55] } },
} as unknown as MapFeature;

type Props = Parameters<typeof useMapPickingTools>[0];

function baseProps(overrides: Partial<Props> = {}): Props {
  /** default hook params - no map, identity translator. */
  return {
    selectedFeature: null,
    airport,
    pendingGeometry: null,
    pendingPointPosition: undefined,
    getMap: () => null,
    t: (k: string) => k,
    ...overrides,
  };
}

describe("useMapPickingTools touchpoint pick", () => {
  it("captures a rounded touchpoint coord and ends picking", () => {
    const { result } = renderHook((p: Props) => useMapPickingTools(p), {
      initialProps: baseProps({ selectedFeature: surfaceFeature }),
    });

    act(() => result.current.setPickingTouchpoint(true));
    expect(result.current.pickingTouchpoint).toBe(true);
    expect(result.current.anyPicking).toBe(true);

    let handled = false;
    act(() => {
      handled = result.current.handlePickingMapClick({ lng: 10.123456789, lat: 20.987654321 });
    });
    expect(handled).toBe(true);
    expect(result.current.pickingTouchpoint).toBe(false);
    expect(result.current.pickedTouchpointCoord).toEqual({
      lat: Math.round(20.987654321 * 1e6) / 1e6,
      lon: Math.round(10.123456789 * 1e6) / 1e6,
      alt: 42,
    });

    act(() => result.current.setPickedTouchpointCoord(null));
    expect(result.current.pickedTouchpointCoord).toBeNull();
  });

  it("returns false when no pick tool is active", () => {
    const { result } = renderHook((p: Props) => useMapPickingTools(p), {
      initialProps: baseProps({ selectedFeature: surfaceFeature }),
    });
    let handled = true;
    act(() => {
      handled = result.current.handlePickingMapClick({ lng: 1, lat: 2 });
    });
    expect(handled).toBe(false);
  });
});

describe("useMapPickingTools lha pick", () => {
  it("captures the lha coord at the parent agl altitude", () => {
    const { result } = renderHook((p: Props) => useMapPickingTools(p), {
      initialProps: baseProps({ selectedFeature: aglFeature }),
    });

    act(() => result.current.setPickingLha("first"));
    expect(result.current.pickingLha).toBe("first");

    act(() => {
      result.current.handlePickingMapClick({ lng: 9, lat: 8 });
    });
    expect(result.current.pickingLha).toBeNull();
    expect(result.current.pickedLhaCoord).toEqual({ which: "first", lat: 8, lon: 9, alt: 55 });
  });
});

describe("useMapPickingTools creation-mode threshold/end pick", () => {
  function pendingPoly(): GeoJSON.Polygon {
    /** minimal pending polygon stand-in to mark creation mode. */
    return {
      type: "Polygon",
      coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]],
    };
  }

  it("captures a threshold pick in creation mode at the airport elevation", () => {
    const { result } = renderHook((p: Props) => useMapPickingTools(p), {
      initialProps: baseProps({ selectedFeature: null, pendingGeometry: pendingPoly() }),
    });

    act(() => result.current.setPickingThreshold(true));
    expect(result.current.pickingThreshold).toBe(true);

    let handled = false;
    act(() => {
      handled = result.current.handlePickingMapClick({ lng: 17.22, lat: 48.18 });
    });
    expect(handled).toBe(true);
    expect(result.current.pickingThreshold).toBe(false);
    expect(result.current.pickedThresholdCoord).toEqual({ lat: 48.18, lon: 17.22, alt: 100 });
  });

  it("captures an end pick in creation mode at the airport elevation", () => {
    const { result } = renderHook((p: Props) => useMapPickingTools(p), {
      initialProps: baseProps({ selectedFeature: null, pendingGeometry: pendingPoly() }),
    });

    act(() => result.current.setPickingEnd(true));
    expect(result.current.pickingEnd).toBe(true);

    let handled = false;
    act(() => {
      handled = result.current.handlePickingMapClick({ lng: 17.27, lat: 48.2 });
    });
    expect(handled).toBe(true);
    expect(result.current.pickingEnd).toBe(false);
    expect(result.current.pickedEndCoord).toEqual({ lat: 48.2, lon: 17.27, alt: 100 });
  });
});

describe("useMapPickingTools cancellation effects", () => {
  it("cancels lha picking when the selection moves away from the agl", () => {
    const { result, rerender } = renderHook((p: Props) => useMapPickingTools(p), {
      initialProps: baseProps({ selectedFeature: aglFeature }),
    });
    act(() => result.current.setPickingLha("last"));
    expect(result.current.pickingLha).toBe("last");

    rerender(baseProps({ selectedFeature: null }));
    expect(result.current.pickingLha).toBeNull();
  });

  it("cancels touchpoint picking when the creation form closes", () => {
    const pendingGeometry: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]],
    };
    const { result, rerender } = renderHook((p: Props) => useMapPickingTools(p), {
      initialProps: baseProps({ selectedFeature: null, pendingGeometry }),
    });

    act(() => result.current.setPickingTouchpoint(true));
    expect(result.current.pickingTouchpoint).toBe(true);

    rerender(baseProps({ selectedFeature: null, pendingGeometry: null }));
    expect(result.current.pickingTouchpoint).toBe(false);
  });
});
