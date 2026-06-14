/** screen-space label declutter helpers for the cesium 3d viewer. cesium has no
 * built-in symbol collision (unlike maplibre's text-allow-overlap=false default),
 * so we implement a greedy first-fit pass over projected label rects keyed by
 * priority, and a separate ground-stack collapser for trajectory waypoints that
 * share a (lng, lat) but differ in altitude. */

/** screen-space axis-aligned bounding box for a label. */
export interface LabelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** declutter input - one per labeled entity. */
export interface DeclutterItem {
  id: string;
  rect: LabelRect;
  priority: number;
  setVisible: (show: boolean) => void;
}

/** baseline priority constants - higher value wins. selection boost is layered
 * on top by the viewer glue. */
export const DECLUTTER_PRIORITY = {
  selectedBoost: 1000,
  surface: 100,
  takeoffLanding: 90,
  safetyZone: 80,
  agl: 60,
  lha: 50,
  obstacle: 40,
  waypoint: 30,
  arrow: 10,
} as const;

/** axis-aligned bounding box intersection with optional padding. */
export function rectsIntersect(a: LabelRect, b: LabelRect, padding = 0): boolean {
  return (
    a.x - padding < b.x + b.width &&
    a.x + a.width + padding > b.x &&
    a.y - padding < b.y + b.height &&
    a.y + a.height + padding > b.y
  );
}

/** sort key for deterministic tie-breaking when two items have equal priority. */
function compareItems(a: DeclutterItem, b: DeclutterItem): number {
  if (b.priority !== a.priority) return b.priority - a.priority;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** greedy first-fit declutter: highest-priority items keep their slot, lower-
 * priority items intersecting any already-accepted rect are hidden. mutates
 * each item's visibility via setVisible(). returns the visible items (accepted). */
export function applyDeclutter(items: DeclutterItem[], padding = 2): DeclutterItem[] {
  const sorted = items.slice().sort(compareItems);
  const accepted: DeclutterItem[] = [];
  for (const item of sorted) {
    let collide = false;
    for (const a of accepted) {
      if (rectsIntersect(item.rect, a.rect, padding)) {
        collide = true;
        break;
      }
    }
    if (collide) {
      item.setVisible(false);
    } else {
      item.setVisible(true);
      accepted.push(item);
    }
  }
  return accepted;
}

/** ground-position waypoint candidate for stack collapse. */
export interface WaypointStackCandidate {
  id: string;
  lng: number;
  lat: number;
  alt: number;
}

/** result of a stack collapse decision per waypoint. */
export interface StackedLabel {
  show: boolean;
  /** total stacked count at this ground position. only meaningful when show=true. */
  count: number;
}

/** group waypoints by ground (lng, lat) and pick the lowest-altitude one as the
 * visible label; others are hidden. ties on altitude are broken deterministically
 * by id. returns a map keyed by waypoint id; absent ids are unstacked (show=true,
 * count=1 implied). digits controls floating-point rounding for the group key. */
export function collapseWaypointStacks(
  candidates: WaypointStackCandidate[],
  digits = 6,
): Map<string, StackedLabel> {
  const groups = new Map<string, WaypointStackCandidate[]>();
  for (const c of candidates) {
    const key = `${c.lng.toFixed(digits)},${c.lat.toFixed(digits)}`;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  const result = new Map<string, StackedLabel>();
  for (const group of groups.values()) {
    if (group.length === 1) {
      result.set(group[0].id, { show: true, count: 1 });
      continue;
    }
    const sorted = group.slice().sort((a, b) => {
      if (a.alt !== b.alt) return a.alt - b.alt;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });
    result.set(sorted[0].id, { show: true, count: group.length });
    for (let i = 1; i < sorted.length; i++) {
      result.set(sorted[i].id, { show: false, count: 0 });
    }
  }
  return result;
}

/** estimate a label rect from text + font px height + screen-space anchor.
 * approximates char width as 0.6 * fontPx; good enough for declutter padding. */
export function estimateLabelRect(
  text: string,
  fontPx: number,
  anchorX: number,
  anchorY: number,
  pixelOffsetX = 0,
  pixelOffsetY = 0,
): LabelRect {
  const charWidth = fontPx * 0.6;
  const width = Math.max(charWidth * text.length, fontPx);
  const height = fontPx;
  // labels in this codebase use VerticalOrigin.BOTTOM or CENTER; pixelOffset.y
  // is typically negative (label sits above the anchor). we centre horizontally
  // around the anchor and treat pixelOffsetY as the bottom of the label.
  return {
    x: anchorX + pixelOffsetX - width / 2,
    y: anchorY + pixelOffsetY - height,
    width,
    height,
  };
}
