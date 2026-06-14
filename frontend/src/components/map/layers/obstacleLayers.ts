import type { Map as MaplibreMap } from "maplibre-gl";
import { EARTH_RADIUS_M } from "@/constants/geo";
import type { ObstacleResponse, SurfaceResponse } from "@/types/airport";
import type { ObstacleType } from "@/types/enums";

export const OBSTACLE_SOURCE = "obstacles";
export const OBSTACLE_BOUNDARY_SOURCE = "obstacles-boundary";
export const OBSTACLE_BUFFER_SOURCE = "obstacles-buffer";
export const OBSTACLE_ICON_LAYER = "obstacles-icon";
export const OBSTACLE_BOUNDARY_LAYER = "obstacles-boundary";
export const OBSTACLE_BOUNDARY_OUTLINE_LAYER = "obstacles-boundary-outline";
export const OBSTACLE_LABEL_LAYER = "obstacles-label";
export const OBSTACLE_BUFFER_FILL_LAYER = "obstacles-buffer-fill";
export const OBSTACLE_BUFFER_OUTLINE_LAYER = "obstacles-buffer-outline";
export const SURFACE_BUFFER_SOURCE = "surfaces-buffer";
export const SURFACE_BUFFER_FILL_LAYER = "surfaces-buffer-fill";
export const SURFACE_BUFFER_OUTLINE_LAYER = "surfaces-buffer-outline";

// backwards compat aliases
export const OBSTACLE_RADIUS_SOURCE = OBSTACLE_BOUNDARY_SOURCE;
export const OBSTACLE_RADIUS_LAYER = OBSTACLE_BOUNDARY_LAYER;
export const OBSTACLE_POINT_LAYER = OBSTACLE_ICON_LAYER;

const obstacleColors: Record<ObstacleType, string> = {
  BUILDING: "#e54545",
  TOWER: "#9b59b6",
  ANTENNA: "#e5a545",
  VEGETATION: "#3bbb3b",
  OTHER: "#6b6b6b",
};

export { obstacleColors as OBSTACLE_COLORS };

/** per-edge mitered offset of a polygon outward by bufferMeters.
 * works in local meters via an equirectangular projection at the polygon centroid,
 * then converts back to lon/lat. miter length is clamped at ~2x buffer so
 * near-collinear vertices on long thin shapes don't spike. assumes a CCW or CW
 * simple ring; orientation is detected from the signed area. */
export function bufferPolygon(
  coords: number[][],
  bufferMeters: number,
): number[][] {
  if (coords.length < 3 || bufferMeters <= 0) return coords;

  // strip closing duplicate so we work with N distinct vertices
  const open = coords.slice();
  const last = open[open.length - 1];
  if (open.length > 1 && open[0][0] === last[0] && open[0][1] === last[1]) {
    open.pop();
  }
  if (open.length < 3) return coords;

  const cx = open.reduce((s, c) => s + c[0], 0) / open.length;
  const cy = open.reduce((s, c) => s + c[1], 0) / open.length;
  const latRad = (cy * Math.PI) / 180;
  const mPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const mPerDegLon = mPerDegLat * Math.cos(latRad);

  const local = open.map(([lon, lat]) => [
    (lon - cx) * mPerDegLon,
    (lat - cy) * mPerDegLat,
  ] as [number, number]);

  // signed area determines orientation; outward normal flips with it
  let signedArea = 0;
  for (let i = 0; i < local.length; i++) {
    const [xi, yi] = local[i];
    const [xj, yj] = local[(i + 1) % local.length];
    signedArea += xi * yj - xj * yi;
  }
  const ccw = signedArea > 0;

  const miterLimit = bufferMeters * 2;
  const offset: [number, number][] = [];
  const n = local.length;

  for (let i = 0; i < n; i++) {
    const prev = local[(i - 1 + n) % n];
    const curr = local[i];
    const next = local[(i + 1) % n];

    const e1x = curr[0] - prev[0];
    const e1y = curr[1] - prev[1];
    const e2x = next[0] - curr[0];
    const e2y = next[1] - curr[1];

    const len1 = Math.sqrt(e1x * e1x + e1y * e1y);
    const len2 = Math.sqrt(e2x * e2x + e2y * e2y);
    if (len1 === 0 || len2 === 0) {
      offset.push([curr[0], curr[1]]);
      continue;
    }

    // outward normals (rotate edge by -90 for CCW, +90 for CW)
    const sign = ccw ? 1 : -1;
    const n1x = (e1y / len1) * sign;
    const n1y = (-e1x / len1) * sign;
    const n2x = (e2y / len2) * sign;
    const n2y = (-e2x / len2) * sign;

    const bx = n1x + n2x;
    const by = n1y + n2y;
    const denom = bx * n1x + by * n1y;
    if (Math.abs(denom) < 1e-12) {
      // degenerate (180-degree turn); offset along the average normal
      const nx = bx === 0 && by === 0 ? n1x : bx;
      const ny = bx === 0 && by === 0 ? n1y : by;
      offset.push([curr[0] + nx * bufferMeters, curr[1] + ny * bufferMeters]);
      continue;
    }
    const m = bufferMeters / denom;
    let dx = bx * m;
    let dy = by * m;
    const miterLen = Math.sqrt(dx * dx + dy * dy);
    if (miterLen > miterLimit) {
      const k = miterLimit / miterLen;
      dx *= k;
      dy *= k;
    }
    offset.push([curr[0] + dx, curr[1] + dy]);
  }

  return offset.map(([x, y]) => [cx + x / mPerDegLon, cy + y / mPerDegLat]);
}

/** adds obstacle layers with per-type colored triangle icons and boundary polygons. */
export function addObstacleLayers(
  map: MaplibreMap,
  obstacles: ObstacleResponse[],
): string[] {
  // point source for icons and labels - use boundary centroid
  map.addSource(OBSTACLE_SOURCE, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: obstacles.map((o) => {
        const ring = o.boundary.coordinates[0];
        const cx = ring.reduce((s, c) => s + c[0], 0) / ring.length;
        const cy = ring.reduce((s, c) => s + c[1], 0) / ring.length;
        return {
          type: "Feature" as const,
          properties: {
            id: o.id,
            name: o.name,
            obstacleType: o.type,
            height: o.height,
            buffer_distance: o.buffer_distance,
            color: obstacleColors[o.type] ?? "#6b6b6b",
            iconImage: `obstacle-${o.type.toLowerCase()}`,
            entityType: "obstacle",
          },
          geometry: { type: "Point" as const, coordinates: [cx, cy] },
        };
      }),
    },
  });

  // polygon source for obstacle boundaries
  map.addSource(OBSTACLE_BOUNDARY_SOURCE, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: obstacles.map((o) => ({
        type: "Feature" as const,
        properties: {
          id: o.id,
          color: obstacleColors[o.type] ?? "#6b6b6b",
          entityType: "obstacle",
        },
        geometry: o.boundary,
      })),
    },
  });

  // obstacle boundary fill
  map.addLayer({
    id: OBSTACLE_BOUNDARY_LAYER,
    type: "fill",
    source: OBSTACLE_BOUNDARY_SOURCE,
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.1,
    },
  });

  // obstacle boundary outline
  map.addLayer({
    id: OBSTACLE_BOUNDARY_OUTLINE_LAYER,
    type: "line",
    source: OBSTACLE_BOUNDARY_SOURCE,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 1,
    },
  });

  // per-type colored triangle icon
  map.addLayer({
    id: OBSTACLE_ICON_LAYER,
    type: "symbol",
    source: OBSTACLE_SOURCE,
    layout: {
      "icon-image": ["get", "iconImage"],
      "icon-size": 1.2,
      "icon-allow-overlap": true,
    },
  });

  // labels
  map.addLayer({
    id: OBSTACLE_LABEL_LAYER,
    type: "symbol",
    source: OBSTACLE_SOURCE,
    layout: {
      "text-field": [
        "concat",
        ["get", "name"],
        "  ",
        ["to-string", ["get", "height"]],
        "m",
      ],
      "text-size": 11,
      "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
      "text-offset": [0, 1.8],
      "text-anchor": "top",
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": ["get", "color"],
      "text-halo-color": "#000000",
      "text-halo-width": 1,
    },
  });

  return [
    OBSTACLE_BOUNDARY_LAYER,
    OBSTACLE_BOUNDARY_OUTLINE_LAYER,
    OBSTACLE_ICON_LAYER,
    OBSTACLE_LABEL_LAYER,
  ];
}

/** adds buffer zone visualization layers for obstacles and surfaces. */
export function addBufferZoneLayers(
  map: MaplibreMap,
  obstacles: ObstacleResponse[],
  surfaces: SurfaceResponse[],
): string[] {
  // obstacle buffer zones - expanded polygon
  map.addSource(OBSTACLE_BUFFER_SOURCE, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: obstacles.flatMap((o) => {
        if (o.buffer_distance <= 0) return [];
        const ring = o.boundary.coordinates[0];
        const buffered = bufferPolygon(ring, o.buffer_distance);
        // close the ring if not already closed
        const last = buffered[buffered.length - 1];
        if (
          buffered.length > 0 &&
          (buffered[0][0] !== last[0] || buffered[0][1] !== last[1])
        ) {
          buffered.push([...buffered[0]]);
        }
        return [
          {
            type: "Feature" as const,
            properties: {
              id: o.id,
              color: obstacleColors[o.type] ?? "#6b6b6b",
            },
            geometry: {
              type: "Polygon" as const,
              coordinates: [buffered],
            },
          },
        ];
      }),
    },
  });

  map.addLayer({
    id: OBSTACLE_BUFFER_FILL_LAYER,
    type: "fill",
    source: OBSTACLE_BUFFER_SOURCE,
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.06,
    },
  });

  map.addLayer({
    id: OBSTACLE_BUFFER_OUTLINE_LAYER,
    type: "line",
    source: OBSTACLE_BUFFER_SOURCE,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 1,
      "line-dasharray": [4, 2],
    },
  });

  // surface buffer zones
  const surfaceFeatures = surfaces.flatMap((s) => {
    if (!s.boundary || s.buffer_distance <= 0) return [];
    const ring = s.boundary.coordinates[0];
    const buffered = bufferPolygon(ring, s.buffer_distance);
    if (buffered.length > 0 && (buffered[0][0] !== buffered[buffered.length - 1][0] || buffered[0][1] !== buffered[buffered.length - 1][1])) {
      buffered.push([...buffered[0]]);
    }
    return [
      {
        type: "Feature" as const,
        properties: {
          id: s.id,
          color: s.surface_type === "RUNWAY" ? "#3b82f6" : "#8b5cf6",
        },
        geometry: {
          type: "Polygon" as const,
          coordinates: [buffered],
        },
      },
    ];
  });

  map.addSource(SURFACE_BUFFER_SOURCE, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: surfaceFeatures,
    },
  });

  map.addLayer({
    id: SURFACE_BUFFER_FILL_LAYER,
    type: "fill",
    source: SURFACE_BUFFER_SOURCE,
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.06,
    },
  });

  map.addLayer({
    id: SURFACE_BUFFER_OUTLINE_LAYER,
    type: "line",
    source: SURFACE_BUFFER_SOURCE,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 1,
      "line-dasharray": [4, 2],
    },
  });

  return [
    OBSTACLE_BUFFER_FILL_LAYER,
    OBSTACLE_BUFFER_OUTLINE_LAYER,
    SURFACE_BUFFER_FILL_LAYER,
    SURFACE_BUFFER_OUTLINE_LAYER,
  ];
}
