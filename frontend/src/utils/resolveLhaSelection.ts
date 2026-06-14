import { METRES_PER_DEGREE } from "@/constants/geo";
import type { AGLResponse, SurfaceResponse } from "@/types/airport";
import type { LhaSelectionRule } from "@/types/mission";

function alongTrackDistanceM(
  lhaLon: number,
  lhaLat: number,
  thresholdLon: number,
  thresholdLat: number,
  endLon: number,
  endLat: number,
  anchor: "START" | "END",
): number {
  const anchorLon = anchor === "START" ? thresholdLon : endLon;
  const anchorLat = anchor === "START" ? thresholdLat : endLat;
  const otherLon = anchor === "START" ? endLon : thresholdLon;
  const otherLat = anchor === "START" ? endLat : thresholdLat;

  const cosLat = Math.cos((anchorLat * Math.PI) / 180);
  const vx = (otherLon - anchorLon) * cosLat * METRES_PER_DEGREE;
  const vy = (otherLat - anchorLat) * METRES_PER_DEGREE;
  const px = (lhaLon - anchorLon) * cosLat * METRES_PER_DEGREE;
  const py = (lhaLat - anchorLat) * METRES_PER_DEGREE;

  const vLen = Math.hypot(vx, vy);
  if (vLen === 0) return 0;
  return (px * vx + py * vy) / vLen;
}

/** true when the surface has both threshold and end positions, so a
 * FROM_THRESHOLD rule can be resolved against it.
 */
export function surfaceSupportsFromThreshold(
  surface: SurfaceResponse | null | undefined,
): boolean {
  return Boolean(
    surface &&
      surface.threshold_position &&
      surface.end_position &&
      surface.threshold_position.coordinates.length >= 2 &&
      surface.end_position.coordinates.length >= 2,
  );
}

/**
 * mirror of `app.services.lha_selection.resolve_rule`. given a per-AGL rule,
 * the AGL (lhas sorted by sequence_number), and the parent surface, returns
 * the resolved set of LHA ids. CUSTOM mode returns null - the canonical
 * custom selection lives on the form's working `selectedLhaIds` set, so
 * callers should not touch the selection when this returns null.
 */
export function resolveLhaSelection(
  rule: LhaSelectionRule,
  agl: AGLResponse,
  surface: SurfaceResponse | null | undefined,
): Set<string> | null {
  if (!agl) return new Set();
  const lhas = agl.lhas ?? [];

  if (rule.mode === "ALL") {
    return new Set(lhas.map((l) => l.id));
  }

  if (rule.mode === "CUSTOM") {
    return null;
  }

  if (rule.mode === "RANGE") {
    const fromRaw = rule.params.from;
    const toRaw = rule.params.to;
    if (fromRaw != null && fromRaw < 1) return new Set();
    if (toRaw != null && toRaw < 1) return new Set();
    if (fromRaw != null && toRaw != null && fromRaw > toRaw) return new Set();

    const maxSeq = lhas.reduce(
      (m, l) => (l.sequence_number > m ? l.sequence_number : m),
      0,
    );
    const lo = fromRaw ?? 1;
    const hi = toRaw ?? maxSeq;
    return new Set(
      lhas.flatMap((l) =>
        l.sequence_number >= lo && l.sequence_number <= hi ? [l.id] : [],
      ),
    );
  }

  if (rule.mode === "FROM_THRESHOLD") {
    if (!surfaceSupportsFromThreshold(surface)) return new Set();
    const distance = rule.params.distance_m;
    if (!(distance >= 0)) return new Set();
    const t = surface!.threshold_position!.coordinates;
    const e = surface!.end_position!.coordinates;
    const picked = new Set<string>();
    for (const lha of lhas) {
      const c = lha.position.coordinates;
      if (c.length < 2) continue;
      const d = alongTrackDistanceM(
        c[0],
        c[1],
        t[0],
        t[1],
        e[0],
        e[1],
        rule.params.threshold,
      );
      if (d >= 0 && d <= distance) picked.add(lha.id);
    }
    return picked;
  }

  return new Set();
}
