import { describe, it, expect, vi } from "vitest";
import {
  applyDeclutter,
  collapseWaypointStacks,
  estimateLabelRect,
  rectsIntersect,
  type DeclutterItem,
  type LabelRect,
} from "./labelDeclutter";

/** small builder so tests stay readable. */
function makeItem(
  id: string,
  rect: LabelRect,
  priority: number,
): DeclutterItem & { visible: boolean } {
  const state: { visible: boolean } = { visible: true };
  return {
    id,
    rect,
    priority,
    setVisible: (show: boolean) => {
      state.visible = show;
    },
    get visible() {
      return state.visible;
    },
  };
}

describe("rectsIntersect", () => {
  it("returns true for overlapping rects", () => {
    expect(
      rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }),
    ).toBe(true);
  });

  it("returns false for separated rects", () => {
    expect(
      rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 10, height: 10 }),
    ).toBe(false);
  });

  it("treats touching edges as non-intersecting (strict <)", () => {
    expect(
      rectsIntersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }),
    ).toBe(false);
  });

  it("padding widens the collision footprint", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 12, y: 0, width: 10, height: 10 };
    expect(rectsIntersect(a, b, 0)).toBe(false);
    expect(rectsIntersect(a, b, 3)).toBe(true);
  });
});

describe("applyDeclutter", () => {
  it("hides the lower-priority of two intersecting items", () => {
    const high = makeItem("a", { x: 0, y: 0, width: 100, height: 20 }, 80);
    const low = makeItem("b", { x: 10, y: 5, width: 100, height: 20 }, 40);
    applyDeclutter([high, low], 0);
    expect(high.visible).toBe(true);
    expect(low.visible).toBe(false);
  });

  it("keeps non-intersecting items visible regardless of priority", () => {
    const a = makeItem("a", { x: 0, y: 0, width: 50, height: 20 }, 30);
    const b = makeItem("b", { x: 200, y: 0, width: 50, height: 20 }, 80);
    const c = makeItem("c", { x: 0, y: 100, width: 50, height: 20 }, 10);
    applyDeclutter([a, b, c], 0);
    expect(a.visible).toBe(true);
    expect(b.visible).toBe(true);
    expect(c.visible).toBe(true);
  });

  it("breaks ties on equal priority deterministically by id (lex order wins)", () => {
    const z = makeItem("z", { x: 0, y: 0, width: 100, height: 20 }, 50);
    const a = makeItem("a", { x: 10, y: 5, width: 100, height: 20 }, 50);
    applyDeclutter([z, a], 0);
    expect(a.visible).toBe(true);
    expect(z.visible).toBe(false);
  });

  it("padding widens collisions and forces additional hides", () => {
    const a = makeItem("a", { x: 0, y: 0, width: 50, height: 20 }, 80);
    const b = makeItem("b", { x: 52, y: 0, width: 50, height: 20 }, 40);
    applyDeclutter([a, b], 0);
    expect(a.visible).toBe(true);
    expect(b.visible).toBe(true);

    const a2 = makeItem("a", { x: 0, y: 0, width: 50, height: 20 }, 80);
    const b2 = makeItem("b", { x: 52, y: 0, width: 50, height: 20 }, 40);
    applyDeclutter([a2, b2], 5);
    expect(a2.visible).toBe(true);
    expect(b2.visible).toBe(false);
  });

  it("calls setVisible exactly once per item (true or false, never both)", () => {
    const setA = vi.fn();
    const setB = vi.fn();
    const items: DeclutterItem[] = [
      { id: "a", rect: { x: 0, y: 0, width: 100, height: 20 }, priority: 80, setVisible: setA },
      { id: "b", rect: { x: 10, y: 5, width: 100, height: 20 }, priority: 40, setVisible: setB },
    ];
    applyDeclutter(items, 0);
    expect(setA).toHaveBeenCalledTimes(1);
    expect(setA).toHaveBeenCalledWith(true);
    expect(setB).toHaveBeenCalledTimes(1);
    expect(setB).toHaveBeenCalledWith(false);
  });

  it("does not mutate the input array order", () => {
    const a = makeItem("a", { x: 0, y: 0, width: 10, height: 10 }, 10);
    const b = makeItem("b", { x: 0, y: 0, width: 10, height: 10 }, 90);
    const input = [a, b];
    applyDeclutter(input, 0);
    expect(input[0]).toBe(a);
    expect(input[1]).toBe(b);
  });
});

describe("collapseWaypointStacks", () => {
  it("returns count=1 and show=true for unstacked waypoints", () => {
    const result = collapseWaypointStacks([
      { id: "w1", lng: 10, lat: 20, alt: 100 },
      { id: "w2", lng: 11, lat: 21, alt: 100 },
    ]);
    expect(result.get("w1")).toEqual({ show: true, count: 1 });
    expect(result.get("w2")).toEqual({ show: true, count: 1 });
  });

  it("collapses a column of three waypoints to the lowest-altitude with count=3", () => {
    const result = collapseWaypointStacks([
      { id: "w5", lng: 10, lat: 20, alt: 300 },
      { id: "w6", lng: 10, lat: 20, alt: 200 },
      { id: "w7", lng: 10, lat: 20, alt: 100 },
    ]);
    expect(result.get("w7")).toEqual({ show: true, count: 3 });
    expect(result.get("w6")).toEqual({ show: false, count: 0 });
    expect(result.get("w5")).toEqual({ show: false, count: 0 });
  });

  it("breaks altitude ties by id deterministically", () => {
    const result = collapseWaypointStacks([
      { id: "wb", lng: 0, lat: 0, alt: 50 },
      { id: "wa", lng: 0, lat: 0, alt: 50 },
    ]);
    expect(result.get("wa")).toEqual({ show: true, count: 2 });
    expect(result.get("wb")).toEqual({ show: false, count: 0 });
  });

  it("rounds (lng, lat) by digits param so near-identical floats group together", () => {
    const result = collapseWaypointStacks(
      [
        { id: "x", lng: 10.1234567, lat: 20.0, alt: 100 },
        { id: "y", lng: 10.1234568, lat: 20.0, alt: 200 },
      ],
      6,
    );
    expect(result.get("x")?.show).toBe(true);
    expect(result.get("x")?.count).toBe(2);
    expect(result.get("y")?.show).toBe(false);
  });

  it("keeps groups separate when the rounded keys differ", () => {
    const result = collapseWaypointStacks(
      [
        { id: "x", lng: 10.1234, lat: 20.0, alt: 100 },
        { id: "y", lng: 10.5678, lat: 20.0, alt: 200 },
      ],
      6,
    );
    expect(result.get("x")).toEqual({ show: true, count: 1 });
    expect(result.get("y")).toEqual({ show: true, count: 1 });
  });
});

describe("estimateLabelRect", () => {
  it("scales width by character count", () => {
    const a = estimateLabelRect("ABC", 12, 0, 0);
    const b = estimateLabelRect("ABCDEFGHIJ", 12, 0, 0);
    expect(b.width).toBeGreaterThan(a.width);
  });

  it("respects fontPx for height", () => {
    const r = estimateLabelRect("X", 18, 0, 0);
    expect(r.height).toBe(18);
  });

  it("centres horizontally around the anchor and offsets vertically by pixelOffsetY", () => {
    const r = estimateLabelRect("AB", 10, 100, 50, 0, -12);
    // width = max(10 * 0.6 * 2, 10) = 12
    expect(r.x).toBeCloseTo(100 - 6);
    // y = anchorY + pixelOffsetY - height = 50 - 12 - 10 = 28
    expect(r.y).toBe(28);
  });
});
