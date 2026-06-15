import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DronePathPoint, ReferencePoint } from "@/types/measurement";
import DronePathMap from "./DronePathMap";

// capture the layers/jump the component adds inside the maplibre "load" callback.
// the global setup mock stubs map.on as a no-op (the load callback never fires),
// so this file installs a richer mock that invokes load and records the calls.
const rec = vi.hoisted(() => ({
  layerIds: [] as string[],
  jumpToCalls: 0,
  fitBoundsCalls: 0,
}));

vi.mock("maplibre-gl", () => {
  class LngLatBounds {
    private lngs: number[] = [];
    private lats: number[] = [];
    constructor(a?: [number, number], b?: [number, number]) {
      if (a) this.extend(a);
      if (b) this.extend(b);
    }
    extend(c: [number, number]) {
      this.lngs.push(c[0]);
      this.lats.push(c[1]);
      return this;
    }
    getSouthWest() {
      return { lng: Math.min(...this.lngs), lat: Math.min(...this.lats) };
    }
    getNorthEast() {
      return { lng: Math.max(...this.lngs), lat: Math.max(...this.lats) };
    }
    getCenter() {
      return {
        lng: (Math.min(...this.lngs) + Math.max(...this.lngs)) / 2,
        lat: (Math.min(...this.lats) + Math.max(...this.lats)) / 2,
      };
    }
  }
  const MockMap = vi.fn().mockImplementation(function () {
    return {
      on: (event: string, cb: () => void) => {
        if (event === "load") cb();
      },
      remove: vi.fn(),
      addControl: vi.fn(),
      addSource: vi.fn(),
      addLayer: (layer: { id: string }) => rec.layerIds.push(layer.id),
      jumpTo: () => {
        rec.jumpToCalls += 1;
      },
      fitBounds: () => {
        rec.fitBoundsCalls += 1;
      },
    };
  });
  const MockNavigationControl = vi.fn();
  return {
    default: {
      Map: MockMap,
      NavigationControl: MockNavigationControl,
      LngLatBounds,
    },
    Map: MockMap,
    NavigationControl: MockNavigationControl,
    LngLatBounds,
  };
});

vi.mock("@/components/map/mapStyles", () => ({
  makeSatelliteStyle: () => ({ name: "satellite" }),
}));

function pathPoint(over: Partial<DronePathPoint>): DronePathPoint {
  return {
    frame_number: 0,
    timestamp: 0,
    latitude: 48.1,
    longitude: 17.2,
    elevation: 150,
    ...over,
  };
}

const refPoints: ReferencePoint[] = [
  {
    light_name: "PAPI_A",
    latitude: 48.1001,
    longitude: 17.2001,
    elevation: 130,
    lha_id: null,
    unit_designator: "A",
    setting_angle: 3,
    tolerance: 0.5,
  },
];

describe("DronePathMap", () => {
  beforeEach(() => {
    rec.layerIds = [];
    rec.jumpToCalls = 0;
    rec.fitBoundsCalls = 0;
  });

  it("renders a per-position marker layer for a single-point path", () => {
    render(
      <DronePathMap
        dronePath={[pathPoint({})]}
        referencePoints={refPoints}
      />,
    );
    expect(rec.layerIds).toContain("drone-path-point");
    // a single point collapses fitBounds - the component centers via jumpTo
    expect(rec.jumpToCalls).toBe(1);
    expect(rec.fitBoundsCalls).toBe(0);
    expect(screen.queryByText("results.map.noPath")).toBeNull();
  });

  it("fits bounds for a path that spans a real area", () => {
    render(
      <DronePathMap
        dronePath={[
          pathPoint({ frame_number: 0, latitude: 48.1, longitude: 17.2 }),
          pathPoint({ frame_number: 1, latitude: 48.2, longitude: 17.3 }),
        ]}
        referencePoints={refPoints}
      />,
    );
    expect(rec.fitBoundsCalls).toBe(1);
    expect(rec.jumpToCalls).toBe(0);
  });

  it("shows the noPath empty state only when the path is empty", () => {
    render(<DronePathMap dronePath={[]} referencePoints={refPoints} />);
    expect(screen.getByText("results.map.noPath")).toBeInTheDocument();
  });
});
