import type { SurfaceResponse } from "@/types/airport";

export interface PairAwareOrder {
  surfaces: SurfaceResponse[];
  /** "first" = upper row of a coupled pair (chain visual anchors here);
   *  "second" = lower row; absent for unpaired surfaces.
   */
  pairPosition: Map<string, "first" | "second">;
}

/** reorders surfaces so paired RUNWAY rows sit adjacent (lower identifier first)
 *  and returns a per-row pair-position map. unpaired surfaces keep their input
 *  order; pairs are anchored at the position of whichever direction appeared first
 *  in the input.
 */
export function pairAwareSurfaceOrder(
  surfaces: SurfaceResponse[],
): PairAwareOrder {
  const byId = new Map(surfaces.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const out: SurfaceResponse[] = [];
  const pairPosition = new Map<string, "first" | "second">();
  for (const s of surfaces) {
    if (seen.has(s.id)) continue;
    if (s.paired_surface_id) {
      const partner = byId.get(s.paired_surface_id);
      if (partner && !seen.has(partner.id)) {
        const [first, second] = [s, partner].sort((a, b) =>
          a.identifier.localeCompare(b.identifier),
        );
        out.push(first, second);
        seen.add(first.id);
        seen.add(second.id);
        pairPosition.set(first.id, "first");
        pairPosition.set(second.id, "second");
        continue;
      }
    }
    out.push(s);
    seen.add(s.id);
  }
  return { surfaces: out, pairPosition };
}
