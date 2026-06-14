import type { PointZ } from "@/types/common";
import { MapTool } from "@/hooks/useMapTools";

export interface PlacementMissionState {
  takeoff_coordinate: PointZ | null;
  landing_coordinate: PointZ | null;
}

export interface PlacementUpdates {
  takeoff_coordinate?: PointZ;
  landing_coordinate?: PointZ;
}

export type ElevationResolver = (
  lat: number,
  lon: number,
) => Promise<number | null>;

/**
 * Build the mission update payload for a PLACE_TAKEOFF / PLACE_LANDING map click.
 *
 * Returns null when the active tool is not a placement tool, so the caller can
 * short-circuit. Async: queries the optional `resolveElevation` for the
 * ground-truthed altitude at the click, and falls back to the existing marker's
 * altitude (preserved if present) or `airportElevation` (or 0).
 */
export async function computePlacementUpdates(
  activeTool: MapTool,
  lngLat: { lng: number; lat: number },
  mission: PlacementMissionState,
  airportElevation: number | null | undefined,
  useTakeoffAsLanding: boolean,
  resolveElevation?: ElevationResolver,
): Promise<PlacementUpdates | null> {
  const isTakeoff = activeTool === MapTool.PLACE_TAKEOFF;
  const isLanding = activeTool === MapTool.PLACE_LANDING;
  if (!isTakeoff && !isLanding) return null;

  let alt: number | null = null;
  if (resolveElevation) {
    try {
      alt = await resolveElevation(lngLat.lat, lngLat.lng);
    } catch {
      alt = null;
    }
  }
  if (alt === null || alt === undefined) {
    const existing = isTakeoff
      ? mission.takeoff_coordinate
      : mission.landing_coordinate;
    alt = existing ? existing.coordinates[2] : (airportElevation ?? 0);
  }
  const newCoord: PointZ = {
    type: "Point",
    coordinates: [lngLat.lng, lngLat.lat, alt],
  };

  const updates: PlacementUpdates = isTakeoff
    ? { takeoff_coordinate: newCoord }
    : { landing_coordinate: newCoord };
  // round-trip mission: mirror the takeoff placement into landing in a single request.
  // clone the coord so each key owns an independent value - callers assume immutable coords.
  if (isTakeoff && useTakeoffAsLanding) {
    updates.landing_coordinate = {
      ...newCoord,
      coordinates: [...newCoord.coordinates] as [number, number, number],
    };
  }
  return updates;
}

/**
 * Build the landing mirror update used when the user toggles
 * "use takeoff as landing" on. Returns null when no takeoff exists, so the
 * caller can skip the backend call.
 */
export function computeMirrorLandingUpdate(
  takeoffCoordinate: PointZ | null | undefined,
): { landing_coordinate: PointZ } | null {
  if (!takeoffCoordinate) return null;
  return {
    landing_coordinate: {
      type: "Point",
      coordinates: [...takeoffCoordinate.coordinates] as [number, number, number],
    },
  };
}

/**
 * Derive which placement keys were written by a placement update - used to
 * mark the corresponding pending-placement indicator entries.
 */
export function placementKeysFromUpdates(
  updates: PlacementUpdates,
): ("takeoff" | "landing")[] {
  const keys: ("takeoff" | "landing")[] = [];
  if (updates.takeoff_coordinate) keys.push("takeoff");
  if (updates.landing_coordinate) keys.push("landing");
  return keys;
}
