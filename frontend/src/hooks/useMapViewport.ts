import type { MapLayerConfig } from "@/types/map";
import { DEFAULT_LAYER_CONFIG } from "@/types/map";

const VIEWPORT_PREFIX = "tarmacview_mapViewport_";
const LAYERS_PREFIX = "tarmacview_mapLayers_";

export interface MapViewportState {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

/** build the per-airport localStorage key for a given prefix. */
function storageKey(prefix: string, airportId: string): string {
  return `${prefix}${airportId}`;
}

/** read the persisted viewport for an airport, or null if absent/invalid. */
export function getSavedViewport(
  airportId: string,
): MapViewportState | null {
  try {
    const raw = localStorage.getItem(storageKey(VIEWPORT_PREFIX, airportId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed.center) &&
      parsed.center.length === 2 &&
      typeof parsed.center[0] === "number" &&
      typeof parsed.center[1] === "number" &&
      typeof parsed.zoom === "number"
    ) {
      return {
        center: parsed.center,
        zoom: parsed.zoom,
        bearing: typeof parsed.bearing === "number" ? parsed.bearing : 0,
        pitch: typeof parsed.pitch === "number" ? parsed.pitch : 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** persist the viewport for an airport, swallowing storage failures. */
export function saveViewport(
  airportId: string,
  state: MapViewportState,
): void {
  try {
    localStorage.setItem(
      storageKey(VIEWPORT_PREFIX, airportId),
      JSON.stringify(state),
    );
  } catch {
    // storage full or unavailable
  }
}

const KNOWN_LAYER_KEYS: ReadonlyArray<keyof MapLayerConfig> = [
  "runways",
  "taxiways",
  "obstacles",
  "safetyZones",
  "airportBoundary",
  "aglSystems",
  "bufferZones",
  "simplifiedTrajectory",
  "trajectory",
  "transitWaypoints",
  "measurementWaypoints",
  "path",
  "takeoffLanding",
  "cameraHeading",
  "pathHeading",
];

/** read the persisted layer toggles for an airport, validating known keys. */
export function getSavedLayers(
  airportId: string,
): Partial<MapLayerConfig> | null {
  try {
    const raw = localStorage.getItem(storageKey(LAYERS_PREFIX, airportId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      KNOWN_LAYER_KEYS.some((k) => typeof parsed[k] === "boolean")
    ) {
      const result: Partial<MapLayerConfig> = {};
      for (const key of KNOWN_LAYER_KEYS) {
        if (typeof parsed[key] === "boolean") {
          result[key] = parsed[key];
        }
      }
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

/** persist the layer toggles for an airport, swallowing storage failures. */
export function saveLayers(
  airportId: string,
  layers: MapLayerConfig,
): void {
  try {
    localStorage.setItem(
      storageKey(LAYERS_PREFIX, airportId),
      JSON.stringify(layers),
    );
  } catch {
    // storage full or unavailable
  }
}

// trajectory family - kept in sync with TRAJECTORY_CHILDREN in AirportMap.tsx
const TRAJECTORY_FAMILY_KEYS: (keyof MapLayerConfig)[] = [
  "trajectory",
  "transitWaypoints",
  "measurementWaypoints",
  "path",
  "takeoffLanding",
  "cameraHeading",
  "pathHeading",
];

/** merge defaults, persisted layers, and prop overrides for the operator mission map. */
export function buildInitialLayerConfig(
  saved: Partial<MapLayerConfig> | null,
  layersProp: Partial<MapLayerConfig> | undefined,
  simplifiedTrajectoryProp: boolean,
): MapLayerConfig {
  // saved simplifiedTrajectory must not survive a reload - always defer to
  // explicit prop or default. callers can still flip it in-session via the
  // LayerPanel; the next saveLayers call persists the explicit choice.
  const finalSimplified =
    layersProp?.simplifiedTrajectory ?? simplifiedTrajectoryProp;

  // when saved had simplifiedTrajectory:true (now being forced off), the saved
  // trajectory + children values are stale side-effects of mutual exclusion -
  // they were all forced false by the toggle handler. drop them so defaults
  // fill the gaps; layersProp can still pin individual keys explicitly.
  let savedClean = saved;
  if (saved?.simplifiedTrajectory && !finalSimplified) {
    savedClean = { ...saved };
    for (const k of TRAJECTORY_FAMILY_KEYS) delete savedClean[k];
  }

  return {
    ...DEFAULT_LAYER_CONFIG,
    ...(savedClean ?? {}),
    ...(layersProp ?? {}),
    simplifiedTrajectory: finalSimplified,
  };
}

