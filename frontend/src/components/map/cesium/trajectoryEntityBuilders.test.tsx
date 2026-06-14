import { describe, it, expect, vi } from "vitest";

// minimal cesium mock - jsdom lacks WebGL, and we only need shape/constants
// for the pure scene-builders under test.
vi.mock("cesium", () => {
  class Color {
    constructor(public r = 1, public g = 1, public b = 1, public a = 1) {}
    withAlpha(a: number) {
      return new Color(this.r, this.g, this.b, a);
    }
    static fromCssColorString(s: string) {
      void s;
      return new Color();
    }
    static WHITE = new Color();
    static BLACK = new Color();
    static CYAN = new Color();
    static TRANSPARENT = new Color(0, 0, 0, 0);
  }
  class PolylineDashMaterialProperty {
    constructor(public options?: { color?: Color; dashLength?: number }) {}
  }
  const Cartesian3 = class {
    constructor(public x = 0, public y = 0, public z = 0) {}
    static fromDegrees(lng: number, lat: number, alt: number) {
      return { lng, lat, alt };
    }
    static lerp(
      a: { lng?: number; lat?: number; alt?: number },
      b: { lng?: number; lat?: number; alt?: number },
      t: number,
      result: Record<string, number>,
    ) {
      result.lng = (a.lng ?? 0) + ((b.lng ?? 0) - (a.lng ?? 0)) * t;
      result.lat = (a.lat ?? 0) + ((b.lat ?? 0) - (a.lat ?? 0)) * t;
      result.alt = (a.alt ?? 0) + ((b.alt ?? 0) - (a.alt ?? 0)) * t;
      return result;
    }
    static subtract(
      a: { lng?: number; lat?: number; alt?: number },
      b: { lng?: number; lat?: number; alt?: number },
      result: Record<string, number>,
    ) {
      result.lng = (a?.lng ?? 0) - (b?.lng ?? 0);
      result.lat = (a?.lat ?? 0) - (b?.lat ?? 0);
      result.alt = (a?.alt ?? 0) - (b?.alt ?? 0);
      return result;
    }
    static normalize(
      value: { lng?: number; lat?: number; alt?: number },
      result: Record<string, number>,
    ) {
      const len = Math.sqrt(
        (value?.lng ?? 0) ** 2 + (value?.lat ?? 0) ** 2 + (value?.alt ?? 0) ** 2,
      );
      if (len === 0) return result;
      result.lng = (value?.lng ?? 0) / len;
      result.lat = (value?.lat ?? 0) / len;
      result.alt = (value?.alt ?? 0) / len;
      return result;
    }
  };
  const Cartographic = {
    fromDegrees: (lng: number, lat: number) => ({ lng, lat }),
  };
  const sampleTerrainMostDetailed = vi.fn(async () => []);
  const Cartesian2 = class {
    constructor(public x = 0, public y = 0) {}
  };
  const NearFarScalar = class {
    constructor(public n = 0, public nv = 0, public f = 0, public fv = 0) {}
  };
  const PropertyBag = class {
    bag: Record<string, unknown> = {};
    addProperty(key: string, value: unknown) {
      this.bag[key] = value;
    }
  };
  const CustomDataSource = class {
    added: unknown[] = [];
    entities = {
      add: (item: unknown) => {
        this.added.push(item);
      },
      removeAll: () => {
        this.added.length = 0;
      },
    };
    constructor(public name?: string) {}
  };
  return {
    ArcType: { NONE: 0, GEODESIC: 1, RHUMB: 2 },
    HeightReference: { NONE: 0, CLAMP_TO_GROUND: 1, RELATIVE_TO_GROUND: 2 },
    Cartesian3,
    Cartographic,
    Cartesian2,
    Color,
    LabelStyle: { FILL: 0, FILL_AND_OUTLINE: 1 },
    VerticalOrigin: { CENTER: 0, BOTTOM: 1 },
    NearFarScalar,
    CustomDataSource,
    PropertyBag,
    PolylineDashMaterialProperty,
    sampleTerrainMostDetailed,
  };
});

import {
  ArcType,
  Cartesian3,
  Color,
  CustomDataSource,
  PolylineDashMaterialProperty,
} from "cesium";
import {
  addCameraHeadingLines,
  addCornerDots,
  addPathArrows,
  addPathSegments,
  addStackedMeasurementDots,
  addTakeoffLanding,
  addWaypointDots,
  buildPolylineOptions,
  isRecordingBookend,
  scopeIncludesTakeoffLanding,
} from "./trajectoryEntityBuilders";
import { DECLUTTER_PRIORITY, collapseWaypointStacks, type StackedLabel } from "./labelDeclutter";
import { terrainKey } from "./terrainSampling";
import type { PointZ } from "@/types/common";
import type { FlightPlanScope } from "@/types/enums";

/** narrow shape we read off the cesium mock - the real PropertyBag exposes a
 * getValue API but the mock stores values directly on .bag for inspection. */
interface MockEntityOptions {
  name?: string;
  label?: { text?: string; show?: boolean };
  point?: { pixelSize?: number; color?: unknown };
  polyline?: { width?: number; material?: unknown; positions?: unknown };
  properties?: { bag: Record<string, unknown> };
}

describe("buildPolylineOptions", () => {
  it("always sets clampToGround to false", () => {
    const positions = [
      Cartesian3.fromDegrees(0, 0, 100),
      Cartesian3.fromDegrees(1, 1, 200),
    ];
    const color = new Color();
    const opts = buildPolylineOptions(positions, 3, color, color);
    expect(opts.polyline).toBeDefined();
    // deliberately loose type cast - polyline options in cesium accept
    // a plain object with these fields at runtime
    const polyline = opts.polyline as { clampToGround: boolean; arcType: unknown };
    expect(polyline.clampToGround).toBe(false);
  });

  it("uses ArcType.NONE so lines do not follow the earth curvature onto terrain", () => {
    const positions = [
      Cartesian3.fromDegrees(10, 20, 500),
      Cartesian3.fromDegrees(10.5, 20.5, 600),
    ];
    const color = new Color();
    const opts = buildPolylineOptions(positions, 2, color, color);
    const polyline = opts.polyline as { arcType: number };
    expect(polyline.arcType).toBe(ArcType.NONE);
    expect(polyline.arcType).not.toBe(ArcType.GEODESIC);
  });

  it("preserves positions, width, material, and depthFailMaterial", () => {
    const positions = [
      Cartesian3.fromDegrees(0, 0, 0),
      Cartesian3.fromDegrees(1, 1, 1),
    ];
    const material = new Color();
    const depthFailMaterial = new PolylineDashMaterialProperty({
      color: material,
      dashLength: 8,
    });
    const opts = buildPolylineOptions(positions, 5, material, depthFailMaterial);
    const polyline = opts.polyline as {
      positions: unknown;
      width: number;
      material: unknown;
      depthFailMaterial: unknown;
    };
    expect(polyline.positions).toBe(positions);
    expect(polyline.width).toBe(5);
    expect(polyline.material).toBe(material);
    expect(polyline.depthFailMaterial).toBe(depthFailMaterial);
  });

  it("does not flatten altitude - Cartesian3 positions retain their z component", () => {
    // simulate a waypoint 50m above terrain
    const airportElevation = 381;
    const waypointMsl = airportElevation + 50;
    const positions = [
      Cartesian3.fromDegrees(-0.4543, 51.47, airportElevation),
      Cartesian3.fromDegrees(-0.4543, 51.47, waypointMsl),
    ] as unknown as Array<{ alt: number }>;
    const color = new Color();
    const opts = buildPolylineOptions(
      positions as unknown as Cartesian3[],
      2,
      color,
      color,
    );
    const polyline = opts.polyline as unknown as { positions: Array<{ alt: number }> };
    expect(polyline.positions[0].alt).toBe(airportElevation);
    expect(polyline.positions[1].alt).toBe(waypointMsl);
    expect(polyline.positions[1].alt).toBeGreaterThan(polyline.positions[0].alt);
  });
});

describe("addWaypointDots declutter tagging", () => {
  // minimal waypoint stub that satisfies addWaypointDots' field reads.
  function wp(
    id: string,
    seq: number,
    lng: number,
    lat: number,
    alt: number,
    opts: {
      type?: "MEASUREMENT" | "TRANSIT";
      inspectionId?: string | null;
      cameraAction?: "RECORDING_START" | "RECORDING_STOP" | "PHOTO_CAPTURE" | null;
    } = {},
  ) {
    return {
      id,
      sequence_order: seq,
      waypoint_type: (opts.type ?? "MEASUREMENT") as "MEASUREMENT" | "TRANSIT",
      position: { coordinates: [lng, lat, alt] as [number, number, number] },
      heading: null,
      speed: null,
      camera_action: opts.cameraAction ?? null,
      camera_target: null,
      gimbal_pitch: null,
      inspection_id: opts.inspectionId ?? null,
      // per-WP agl shipped by the backend; equal to alt in these fixtures
      // because the synthetic airport elevation is 0.
      agl: alt,
      camera_target_agl: null,
    };
  }

  it("tags every visible labeled waypoint with declutterPriority and declutterGroup", () => {
    const ds = new CustomDataSource("trajectory-dots") as unknown as CustomDataSource & {
      added: MockEntityOptions[];
    };
    const heights = new Map([
      [terrainKey(0, 0), 0],
      [terrainKey(0.001, 0.001), 0],
    ]);
    const waypoints = [
      wp("a", 1, 0, 0, 100, { inspectionId: "insp-1" }),
      wp("b", 2, 0.001, 0.001, 200, { inspectionId: "insp-1" }),
    ];
    const stackMap: Map<string, StackedLabel> = new Map([
      ["a", { show: true, count: 1 }],
      ["b", { show: true, count: 1 }],
    ]);
    addWaypointDots(
      ds as unknown as Parameters<typeof addWaypointDots>[0],
      waypoints as unknown as Parameters<typeof addWaypointDots>[1],
      null,
      heights,
      stackMap,
      { "insp-1": 1 },
      null,
    );
    expect(ds.added).toHaveLength(2);
    for (const e of ds.added) {
      expect(e.label?.text).toBe("1");
      expect(e.properties?.bag.declutterPriority).toBe(DECLUTTER_PRIORITY.waypoint);
      expect(typeof e.properties?.bag.declutterGroup).toBe("string");
    }
  });

  it("labels by inspection index, no +N suffix, and hides stacked-upper labels", () => {
    const ds = new CustomDataSource("trajectory-dots") as unknown as CustomDataSource & {
      added: MockEntityOptions[];
    };
    const heights = new Map([[terrainKey(10, 20), 0]]);
    const waypoints = [
      wp("w5", 5, 10, 20, 100, { inspectionId: "insp-2" }), // lowest alt - the visible one
      wp("w6", 6, 10, 20, 200, { inspectionId: "insp-2" }),
      wp("w7", 7, 10, 20, 300, { inspectionId: "insp-2" }),
    ];
    const stackMap = collapseWaypointStacks(
      waypoints.map((w) => {
        const [lng, lat, alt] = w.position.coordinates;
        return { id: w.id, lng, lat, alt };
      }),
    );
    addWaypointDots(
      ds as unknown as Parameters<typeof addWaypointDots>[0],
      waypoints as unknown as Parameters<typeof addWaypointDots>[1],
      null,
      heights,
      stackMap,
      { "insp-2": 2 },
      null,
    );

    const labelsById = new Map<string, MockEntityOptions>();
    for (const e of ds.added) labelsById.set(e.name ?? "", e);

    const visible = labelsById.get("WP 5");
    expect(visible?.label?.show).toBe(true);
    // matches 2d resolveLabel: inspection index, no +N suffix
    expect(visible?.label?.text).toBe("2");
    expect(visible?.properties?.bag.declutterPriority).toBe(DECLUTTER_PRIORITY.waypoint);

    const hidden6 = labelsById.get("WP 6");
    expect(hidden6?.label?.show).toBe(false);
    // stack-hidden labels skip declutter so they stay hidden across frames
    expect(hidden6?.properties?.bag.declutterPriority).toBeUndefined();

    const hidden7 = labelsById.get("WP 7");
    expect(hidden7?.label?.show).toBe(false);
    expect(hidden7?.properties?.bag.declutterPriority).toBeUndefined();
  });

  it("hides labels on transit waypoints and on measurements without an inspection index", () => {
    const ds = new CustomDataSource("trajectory-dots") as unknown as CustomDataSource & {
      added: MockEntityOptions[];
    };
    const heights = new Map([
      [terrainKey(0, 0), 0],
      [terrainKey(0.001, 0.001), 0],
    ]);
    const waypoints = [
      // a transit at the same ground as a measurement - the transit inherits
      // the measurement's inspection-index label so the visible stack entry
      // reads "1" regardless of which one sits lowest
      wp("t1", 1, 0, 0, 100, { type: "TRANSIT" }),
      wp("m1", 2, 0, 0, 50, { inspectionId: "insp-1" }),
      // a measurement whose inspection is missing from the indexMap renders unlabeled
      wp("m2", 3, 0.001, 0.001, 100, { inspectionId: "insp-missing" }),
    ];
    const stackMap = collapseWaypointStacks(
      waypoints.map((w) => {
        const [lng, lat, alt] = w.position.coordinates;
        return { id: w.id, lng, lat, alt };
      }),
    );
    addWaypointDots(
      ds as unknown as Parameters<typeof addWaypointDots>[0],
      waypoints as unknown as Parameters<typeof addWaypointDots>[1],
      null,
      heights,
      stackMap,
      { "insp-1": 1 },
      null,
    );

    const labelsById = new Map<string, MockEntityOptions>();
    for (const e of ds.added) labelsById.set(e.name ?? "", e);

    // m1 (lowest alt at (0,0)) is the visible stack entry - inherits "1"
    const visibleM1 = labelsById.get("WP 2");
    expect(visibleM1?.label?.show).toBe(true);
    expect(visibleM1?.label?.text).toBe("1");

    // the transit at the same ground also carries the label, but it's stack-hidden
    const stackedTransit = labelsById.get("WP 1");
    expect(stackedTransit?.label?.show).toBe(false);

    // unmapped measurement renders the dot but no label
    const unmapped = labelsById.get("WP 3");
    expect(unmapped?.label?.show).toBe(false);
    expect(unmapped?.label?.text).toBe("");
  });
});

describe("isRecordingBookend", () => {
  it("flags MEASUREMENTs whose camera_action is RECORDING_START or RECORDING_STOP", () => {
    const start = { waypoint_type: "MEASUREMENT", camera_action: "RECORDING_START" };
    const stop = { waypoint_type: "MEASUREMENT", camera_action: "RECORDING_STOP" };
    expect(isRecordingBookend(start as never)).toBe(true);
    expect(isRecordingBookend(stop as never)).toBe(true);
  });

  it("returns false for plain measurements and non-measurement bookends", () => {
    expect(isRecordingBookend({ waypoint_type: "MEASUREMENT", camera_action: null } as never)).toBe(false);
    expect(isRecordingBookend({ waypoint_type: "MEASUREMENT", camera_action: "PHOTO_CAPTURE" } as never)).toBe(false);
    expect(isRecordingBookend({ waypoint_type: "HOVER", camera_action: "RECORDING_START" } as never)).toBe(false);
    expect(isRecordingBookend({ waypoint_type: "TRANSIT", camera_action: null } as never)).toBe(false);
  });
});

describe("addWaypointDots recording-bookend rendering", () => {
  function wp(
    id: string,
    seq: number,
    lng: number,
    lat: number,
    alt: number,
    opts: {
      type?: "MEASUREMENT" | "TRANSIT";
      inspectionId?: string | null;
      cameraAction?: "RECORDING_START" | "RECORDING_STOP" | "PHOTO_CAPTURE" | null;
    } = {},
  ) {
    return {
      id,
      sequence_order: seq,
      waypoint_type: (opts.type ?? "MEASUREMENT") as "MEASUREMENT" | "TRANSIT",
      position: { coordinates: [lng, lat, alt] as [number, number, number] },
      heading: null,
      speed: null,
      camera_action: opts.cameraAction ?? null,
      camera_target: null,
      gimbal_pitch: null,
      inspection_id: opts.inspectionId ?? null,
      agl: alt,
      camera_target_agl: null,
    };
  }

  it("paints a bookend MEASUREMENT with the HOVER orange, leaves a plain MEASUREMENT untouched", () => {
    const ds = new CustomDataSource("trajectory-dots") as unknown as CustomDataSource & {
      added: MockEntityOptions[];
    };
    const heights = new Map([
      [terrainKey(0, 0), 0],
      [terrainKey(0.001, 0.001), 0],
    ]);
    const waypoints = [
      wp("a", 1, 0, 0, 100, { cameraAction: "RECORDING_START", inspectionId: "insp-1" }),
      wp("b", 2, 0.001, 0.001, 100, { inspectionId: "insp-1" }),
    ];
    const stackMap: Map<string, StackedLabel> = new Map([
      ["a", { show: true, count: 1 }],
      ["b", { show: true, count: 1 }],
    ]);
    addWaypointDots(
      ds as unknown as Parameters<typeof addWaypointDots>[0],
      waypoints as unknown as Parameters<typeof addWaypointDots>[1],
      null,
      heights,
      stackMap,
      { "insp-1": 1 },
      null,
    );

    const byName = new Map<string, MockEntityOptions>();
    for (const e of ds.added) byName.set(e.name ?? "", e);

    const bookend = byName.get("WP 1");
    const plain = byName.get("WP 2");
    // Color.fromCssColorString("#e5a545") and MEASUREMENT_COLOR are different
    // instances in the cesium mock; the bookend should not share identity
    // with the plain measurement color.
    expect(bookend?.point?.color).not.toBe(plain?.point?.color);
    expect(bookend?.point?.color).toBeDefined();
  });
});

describe("addPathArrows", () => {
  function wp(seq: number, lng: number, lat: number) {
    return {
      id: `wp${seq}`,
      sequence_order: seq,
      waypoint_type: "MEASUREMENT" as const,
      position: { coordinates: [lng, lat, 100] as [number, number, number] },
      agl: 100,
    };
  }

  interface MockBillboardEntity {
    billboard?: {
      image?: unknown;
      alignedAxis?: { lng?: number; lat?: number; alt?: number };
    };
    label?: { text?: string };
    polyline?: unknown;
    properties?: { bag: Record<string, unknown> };
  }

  function makeDs() {
    return new CustomDataSource("trajectory-lines") as unknown as CustomDataSource & {
      added: MockBillboardEntity[];
    };
  }

  it("places billboards along each segment with no static ▶ labels or arrow polylines", () => {
    const ds = makeDs();
    const heights = new Map([
      [terrainKey(0, 0), 0],
      [terrainKey(0.001, 0.001), 0],
      [terrainKey(0.002, 0.002), 0],
    ]);
    addPathArrows(
      ds as unknown as Parameters<typeof addPathArrows>[0],
      [wp(1, 0, 0), wp(2, 0.001, 0.001), wp(3, 0.002, 0.002)] as unknown as Parameters<typeof addPathArrows>[1],
      heights,
    );

    // at least one arrow per segment (two segments)
    expect(ds.added.length).toBeGreaterThanOrEqual(2);
    for (const e of ds.added) {
      expect(e.billboard).toBeDefined();
      expect(e.billboard?.alignedAxis).toBeDefined();
      // direction arrows must not regress to static glyphs or arrow polylines
      expect(e.label?.text).not.toBe("▶");
      expect(e.polyline).toBeUndefined();
      // declutter tagging is preserved so arrows participate in the screen-space pass
      expect(e.properties?.bag.declutterPriority).toBe(DECLUTTER_PRIORITY.arrow);
    }
  });

  it("flips alignedAxis when waypoint order is reversed", () => {
    const heights = new Map([
      [terrainKey(0, 0), 0],
      [terrainKey(0.001, 0.001), 0],
    ]);

    const fwd = makeDs();
    addPathArrows(
      fwd as unknown as Parameters<typeof addPathArrows>[0],
      [wp(1, 0, 0), wp(2, 0.001, 0.001)] as unknown as Parameters<typeof addPathArrows>[1],
      heights,
    );

    // reversed travel order: same points, swapped sequence_order so sort flips travel
    const rev = makeDs();
    addPathArrows(
      rev as unknown as Parameters<typeof addPathArrows>[0],
      [wp(2, 0, 0), wp(1, 0.001, 0.001)] as unknown as Parameters<typeof addPathArrows>[1],
      heights,
    );

    const fAxis = fwd.added[0].billboard!.alignedAxis!;
    const rAxis = rev.added[0].billboard!.alignedAxis!;
    // unit direction along the segment - reversing sequence_order negates it
    expect(Math.sign(fAxis.lng ?? 0)).toBe(-Math.sign(rAxis.lng ?? 0));
    expect(Math.sign(fAxis.lat ?? 0)).toBe(-Math.sign(rAxis.lat ?? 0));
    expect(Math.sign(fAxis.lng ?? 0)).not.toBe(0);
  });
});

describe("scopeIncludesTakeoffLanding", () => {
  it("excludes T/L for every remaining scope", () => {
    expect(scopeIncludesTakeoffLanding("FULL")).toBe(false);
    expect(scopeIncludesTakeoffLanding("MEASUREMENTS_ONLY")).toBe(false);
  });

  it("excludes T/L for undefined/null scope", () => {
    expect(scopeIncludesTakeoffLanding(undefined)).toBe(false);
    expect(scopeIncludesTakeoffLanding(null)).toBe(false);
  });

  it("never emits synthetic T/L legs regardless of input", () => {
    // every remaining scope is airborne-start - the operator hand-launches and
    // triggers the wayline mid-air, so neither viewer renders ground bookends.
    const allScopes: Array<FlightPlanScope | null | undefined> = [
      "FULL",
      "MEASUREMENTS_ONLY",
      null,
      undefined,
    ];
    for (const s of allScopes) {
      expect(scopeIncludesTakeoffLanding(s)).toBe(false);
    }
  });
});

describe("addPathSegments flight_plan_scope gating", () => {
  const takeoff: PointZ = { type: "Point", coordinates: [5, 5, 0] };
  const landing: PointZ = { type: "Point", coordinates: [6, 6, 0] };

  // three measurement waypoints at distinct ground positions, so the only
  // legs touching (5,5)/(6,6) can be the synthetic takeoff/landing ones.
  function wps() {
    return [
      { id: "a", sequence_order: 1, waypoint_type: "MEASUREMENT",
        position: { coordinates: [0, 0, 100] }, camera_target: null,
        agl: 100, camera_target_agl: null },
      { id: "b", sequence_order: 2, waypoint_type: "MEASUREMENT",
        position: { coordinates: [1, 1, 100] }, camera_target: null,
        agl: 100, camera_target_agl: null },
      { id: "c", sequence_order: 3, waypoint_type: "MEASUREMENT",
        position: { coordinates: [2, 2, 100] }, camera_target: null,
        agl: 100, camera_target_agl: null },
    ];
  }

  function heights() {
    return new Map<string, number>([
      [terrainKey(0, 0), 0],
      [terrainKey(1, 1), 0],
      [terrainKey(2, 2), 0],
      [terrainKey(5, 5), 0],
      [terrainKey(6, 6), 0],
    ]);
  }

  type Leg = { polyline: { width: number; positions: Array<{ lng: number; lat: number }> } };

  function run(
    scope: FlightPlanScope | null | undefined,
    width = 3,
    showTakeoffLanding = true,
  ): Leg[] {
    const ds = new CustomDataSource("trajectory-lines") as unknown as CustomDataSource & {
      added: Leg[];
    };
    addPathSegments(
      ds as unknown as Parameters<typeof addPathSegments>[0],
      wps() as unknown as Parameters<typeof addPathSegments>[1],
      heights(),
      width,
      takeoff,
      landing,
      showTakeoffLanding,
      scope,
    );
    return ds.added;
  }

  function touches(legs: Leg[], lng: number, lat: number): boolean {
    return legs.some((l) =>
      l.polyline.positions.some((p) => p.lng === lng && p.lat === lat),
    );
  }

  it("skips both T/L legs for MEASUREMENTS_ONLY (only waypoint-to-waypoint segments)", () => {
    const legs = run("MEASUREMENTS_ONLY");
    expect(legs).toHaveLength(2);
    expect(touches(legs, 5, 5)).toBe(false);
    expect(touches(legs, 6, 6)).toBe(false);
  });

  it("skips both T/L legs for FULL", () => {
    const legs = run("FULL");
    expect(legs).toHaveLength(2);
    expect(touches(legs, 5, 5)).toBe(false);
    expect(touches(legs, 6, 6)).toBe(false);
  });

  it("skips T/L legs when scope is undefined (no synthetic T/L for any scope)", () => {
    const legs = run(undefined);
    expect(legs).toHaveLength(2);
    expect(touches(legs, 5, 5)).toBe(false);
    expect(touches(legs, 6, 6)).toBe(false);
  });

  it("skips T/L legs in the simplified branch (width 5)", () => {
    const legs = run("MEASUREMENTS_ONLY", 5);
    expect(legs).toHaveLength(2);
    expect(legs.every((l) => l.polyline.width === 5)).toBe(true);
    expect(touches(legs, 5, 5)).toBe(false);
    expect(touches(legs, 6, 6)).toBe(false);
  });

  it("honors showTakeoffLanding=false regardless of scope", () => {
    const legs = run("FULL", 3, false);
    expect(legs).toHaveLength(2);
    expect(touches(legs, 5, 5)).toBe(false);
    expect(touches(legs, 6, 6)).toBe(false);
  });
});

describe("addCameraHeadingLines", () => {
  function makeDs() {
    return new CustomDataSource("trajectory-lines") as unknown as CustomDataSource & {
      added: MockEntityOptions[];
    };
  }

  function measurementWp(
    id: string,
    lng: number,
    lat: number,
    target: [number, number] | null,
  ) {
    return {
      id,
      sequence_order: 1,
      waypoint_type: "MEASUREMENT" as const,
      position: { coordinates: [lng, lat, 100] as [number, number, number] },
      camera_target: target
        ? { type: "Point", coordinates: [target[0], target[1], 0] }
        : null,
      agl: 100,
      camera_target_agl: 0,
    };
  }

  it("emits a dashed polyline at width 1 for each measurement with a camera target", () => {
    const ds = makeDs();
    const heights = new Map([
      [terrainKey(0, 0), 0],
      [terrainKey(0.001, 0.001), 0],
    ]);
    addCameraHeadingLines(
      ds as unknown as Parameters<typeof addCameraHeadingLines>[0],
      [measurementWp("m1", 0, 0, [0.001, 0.001])] as unknown as Parameters<typeof addCameraHeadingLines>[1],
      heights,
    );
    expect(ds.added).toHaveLength(1);
    const polyline = ds.added[0].polyline!;
    expect(polyline.width).toBe(1);
    expect(polyline.material).toBeInstanceOf(PolylineDashMaterialProperty);
  });

  it("skips measurements without a camera target and non-measurement waypoints", () => {
    const ds = makeDs();
    const heights = new Map([[terrainKey(0, 0), 0]]);
    addCameraHeadingLines(
      ds as unknown as Parameters<typeof addCameraHeadingLines>[0],
      [
        measurementWp("m1", 0, 0, null),
        { id: "t1", sequence_order: 2, waypoint_type: "TRANSIT",
          position: { coordinates: [0, 0, 100] }, camera_target: null,
          agl: 100, camera_target_agl: null },
      ] as unknown as Parameters<typeof addCameraHeadingLines>[1],
      heights,
    );
    expect(ds.added).toHaveLength(0);
  });
});

describe("addTakeoffLanding", () => {
  function makeDs() {
    return new CustomDataSource("trajectory-dots") as unknown as CustomDataSource & {
      added: MockEntityOptions[];
    };
  }

  it("emits markers tagged with the waypoint:takeoff / waypoint:landing declutter groups", () => {
    const ds = makeDs();
    const takeoff: PointZ = { type: "Point", coordinates: [5, 5, 0] };
    const landing: PointZ = { type: "Point", coordinates: [6, 6, 0] };
    const heights = new Map([
      [terrainKey(5, 5), 0],
      [terrainKey(6, 6), 0],
    ]);
    addTakeoffLanding(
      ds as unknown as Parameters<typeof addTakeoffLanding>[0],
      takeoff,
      landing,
      heights,
      "Takeoff",
      "Landing",
    );
    const byGroup = new Map<string, MockEntityOptions>();
    for (const e of ds.added) {
      byGroup.set(String(e.properties?.bag.declutterGroup), e);
    }
    const t = byGroup.get("waypoint:takeoff");
    const l = byGroup.get("waypoint:landing");
    expect(t).toBeDefined();
    expect(l).toBeDefined();
    expect(t?.properties?.bag.declutterPriority).toBe(DECLUTTER_PRIORITY.takeoffLanding);
    expect(l?.properties?.bag.declutterPriority).toBe(DECLUTTER_PRIORITY.takeoffLanding);
    expect(t?.label?.text).toBe("Takeoff");
    expect(l?.label?.text).toBe("Landing");
  });

  it("skips a marker whose ground point has not been sampled yet", () => {
    const ds = makeDs();
    const takeoff: PointZ = { type: "Point", coordinates: [5, 5, 0] };
    addTakeoffLanding(
      ds as unknown as Parameters<typeof addTakeoffLanding>[0],
      takeoff,
      null,
      new Map<string, number>(),
      "Takeoff",
      "Landing",
    );
    expect(ds.added).toHaveLength(0);
  });
});

describe("addCornerDots", () => {
  function makeDs() {
    return new CustomDataSource("trajectory-dots") as unknown as CustomDataSource & {
      added: MockEntityOptions[];
    };
  }

  it("draws exactly one black dot per TRANSIT waypoint and skips other types", () => {
    const ds = makeDs();
    const heights = new Map([
      [terrainKey(0, 0), 0],
      [terrainKey(1, 1), 0],
      [terrainKey(2, 2), 0],
    ]);
    const waypoints = [
      { id: "t1", waypoint_type: "TRANSIT", position: { coordinates: [0, 0, 50] }, agl: 50 },
      { id: "m1", waypoint_type: "MEASUREMENT", position: { coordinates: [1, 1, 50] }, agl: 50 },
      { id: "t2", waypoint_type: "TRANSIT", position: { coordinates: [2, 2, 50] }, agl: 50 },
    ];
    addCornerDots(
      ds as unknown as Parameters<typeof addCornerDots>[0],
      waypoints as unknown as Parameters<typeof addCornerDots>[1],
      heights,
    );
    expect(ds.added).toHaveLength(2);
    for (const e of ds.added) {
      expect(e.point?.pixelSize).toBe(4);
      expect(e.point?.color).toBe(Color.BLACK);
    }
  });
});

describe("input array is never mutated (copy-then-sort, not in-place)", () => {
  function wp(seq: number, lng: number, lat: number) {
    return {
      id: `wp${seq}`,
      sequence_order: seq,
      waypoint_type: "MEASUREMENT" as const,
      position: { coordinates: [lng, lat, 100] as [number, number, number] },
      camera_target: null,
      agl: 100,
      camera_target_agl: null,
    };
  }

  function heights() {
    return new Map<string, number>([
      [terrainKey(0, 0), 0],
      [terrainKey(0.001, 0.001), 0],
      [terrainKey(0.002, 0.002), 0],
    ]);
  }

  it("addPathSegments leaves the caller's waypoint array order and identity untouched", () => {
    // deliberately out-of-order so an in-place sort would reorder it
    const input = [wp(3, 0.002, 0.002), wp(1, 0, 0), wp(2, 0.001, 0.001)];
    const before = [...input];
    const ds = new CustomDataSource("trajectory-lines") as unknown as Parameters<
      typeof addPathSegments
    >[0];
    addPathSegments(
      ds,
      input as unknown as Parameters<typeof addPathSegments>[1],
      heights(),
      3,
      null,
      null,
      false,
      "FULL",
    );
    // same element identities in the same slots - no reorder, no copy swap
    expect(input).toEqual(before);
    input.forEach((w, i) => expect(w).toBe(before[i]));
  });

  it("addPathArrows leaves the caller's waypoint array order and identity untouched", () => {
    const input = [wp(3, 0.002, 0.002), wp(1, 0, 0), wp(2, 0.001, 0.001)];
    const before = [...input];
    const ds = new CustomDataSource("trajectory-lines") as unknown as Parameters<
      typeof addPathArrows
    >[0];
    addPathArrows(
      ds,
      input as unknown as Parameters<typeof addPathArrows>[1],
      heights(),
    );
    expect(input).toEqual(before);
    input.forEach((w, i) => expect(w).toBe(before[i]));
  });

  it("addPathSegments still draws segments in sequence_order despite an out-of-order input", () => {
    // 3 waypoints out of order; expect 2 ww segments connecting 1->2->3 by sequence
    const input = [wp(3, 0.002, 0.002), wp(1, 0, 0), wp(2, 0.001, 0.001)];
    const ds = new CustomDataSource("trajectory-lines") as unknown as CustomDataSource & {
      added: Array<{ polyline: { positions: Array<{ lng: number; lat: number }> } }>;
    };
    addPathSegments(
      ds as unknown as Parameters<typeof addPathSegments>[0],
      input as unknown as Parameters<typeof addPathSegments>[1],
      heights(),
      3,
      null,
      null,
      false,
      "FULL",
    );
    const legs = ds.added;
    expect(legs).toHaveLength(2);
    // first leg starts at sequence 1's ground (0,0), last leg ends at sequence 3's (0.002,0.002)
    expect(legs[0].polyline.positions[0]).toMatchObject({ lng: 0, lat: 0 });
    const lastLeg = legs[legs.length - 1].polyline.positions;
    expect(lastLeg[lastLeg.length - 1]).toMatchObject({ lng: 0.002, lat: 0.002 });
  });
});

describe("addStackedMeasurementDots", () => {
  function makeDs() {
    return new CustomDataSource("trajectory-dots") as unknown as CustomDataSource & {
      added: MockEntityOptions[];
    };
  }

  it("emits one dot only for ground groups with more than one measurement/hover", () => {
    const ds = makeDs();
    const heights = new Map([
      [terrainKey(0, 0), 0],
      [terrainKey(1, 1), 0],
    ]);
    const waypoints = [
      // two measurements stacked at (0,0) -> one stacked dot
      { id: "a", waypoint_type: "MEASUREMENT", position: { coordinates: [0, 0, 100] }, agl: 100 },
      { id: "b", waypoint_type: "MEASUREMENT", position: { coordinates: [0, 0, 200] }, agl: 200 },
      // a lone measurement at (1,1) -> no stacked dot
      { id: "c", waypoint_type: "MEASUREMENT", position: { coordinates: [1, 1, 100] }, agl: 100 },
    ];
    addStackedMeasurementDots(
      ds as unknown as Parameters<typeof addStackedMeasurementDots>[0],
      waypoints as unknown as Parameters<typeof addStackedMeasurementDots>[1],
      heights,
    );
    expect(ds.added).toHaveLength(1);
    expect(ds.added[0].point?.pixelSize).toBe(6);
  });
});
