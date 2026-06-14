import { useMemo } from "react";

import { fetchElevationAt } from "@/api/airports";
import type { ElevationResolver } from "@/utils/takeoffLandingPlacement";

/**
 * Build an ElevationResolver bound to a specific airport, suitable for passing
 * into `computePlacementUpdates`. Returns `undefined` when no airport id is
 * available so the caller can short-circuit; the resolver itself returns
 * `null` on any network failure so the placement falls through to the
 * existing-marker / airport-elevation chain inside `computePlacementUpdates`.
 */
export function useElevationResolver(
  airportId: string | null | undefined,
): ElevationResolver | undefined {
  /** memoize a per-airport elevation resolver for placement / drag handlers. */
  return useMemo(() => {
    if (!airportId) return undefined;
    return async (lat: number, lon: number) => {
      try {
        const r = await fetchElevationAt(airportId, lat, lon);
        return r.elevation;
      } catch {
        return null;
      }
    };
  }, [airportId]);
}
