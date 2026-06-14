import type { Map as MaplibreMap } from "maplibre-gl";
import {
  createAglSquareIcon,
  createAntennaIcon,
  createEndPositionIcon,
  createHatchPattern,
  createHoverIcon,
  createPathArrowIcon,
  createRecordingStartIcon,
  createRecordingStopIcon,
  createRoundedSquareIcon,
  createThresholdIcon,
  createTowerIcon,
  createTreeIcon,
  createTriangleIcon,
} from "./icons/iconFactories";

export { createHatchPattern };

/** safely adds an image, skipping if it already exists. */
function safeAddImage(
  map: MaplibreMap,
  name: string,
  data: ImageData,
  opts?: { pixelRatio?: number },
): void {
  if (map.hasImage(name)) return;
  map.addImage(name, data, opts);
}

/** registers all custom map icons on the map instance. */
export function registerAllMapImages(map: MaplibreMap): void {
  const iconSize = 32;

  // per-type obstacle icons
  const obstacleIcons: Record<string, { color: string; create: (s: number, c: string) => ImageData }> = {
    building: { color: "#e54545", create: createTriangleIcon },
    tower: { color: "#9b59b6", create: createTowerIcon },
    antenna: { color: "#e5a545", create: createAntennaIcon },
    vegetation: { color: "#3bbb3b", create: createTreeIcon },
    other: { color: "#6b6b6b", create: createTriangleIcon },
  };
  for (const [type, { color, create }] of Object.entries(obstacleIcons)) {
    safeAddImage(map, `obstacle-${type}`, create(iconSize, color), { pixelRatio: 2 });
  }

  safeAddImage(map, "takeoff-square", createRoundedSquareIcon(iconSize, "#4595e5", "T"), { pixelRatio: 2 });
  safeAddImage(map, "landing-square", createRoundedSquareIcon(iconSize, "#e54545", "L"), { pixelRatio: 2 });
  safeAddImage(map, "hover-icon", createHoverIcon(iconSize, "#e5a545"), { pixelRatio: 2 });
  safeAddImage(map, "recording-start-icon", createRecordingStartIcon(iconSize, "#3bbb3b"), { pixelRatio: 2 });
  safeAddImage(map, "recording-stop-icon", createRecordingStopIcon(iconSize, "#e54545"), { pixelRatio: 2 });
  safeAddImage(map, "agl-square", createAglSquareIcon(iconSize, "#e91e90"), { pixelRatio: 2 });
  safeAddImage(map, "path-arrow", createPathArrowIcon(iconSize), { pixelRatio: 2 });
  safeAddImage(map, "threshold-marker", createThresholdIcon(iconSize, "#4595e5"), { pixelRatio: 2 });
  safeAddImage(map, "end-position-marker", createEndPositionIcon(iconSize, "#e54545"), { pixelRatio: 2 });
}
