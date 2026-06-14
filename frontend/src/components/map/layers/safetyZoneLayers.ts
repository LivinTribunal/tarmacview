import type { Map as MaplibreMap } from "maplibre-gl";
import type { SafetyZoneResponse } from "@/types/airport";
import type { SafetyZoneType } from "@/types/enums";
import { NEUTRAL, ZONE_COLORS } from "@/constants/palette";
import { createHatchPattern } from "./mapImages";

export const SAFETY_ZONE_SOURCE = "safety-zones";
export const SAFETY_ZONE_FILL_LAYER = "safety-zones-fill";
export const SAFETY_ZONE_HATCH_LAYER = "safety-zones-hatch";
export const SAFETY_ZONE_BORDER_LAYER = "safety-zones-border";
export const SAFETY_ZONE_LABEL_LAYER = "safety-zones-label";

// airport boundary rendered as a dashed outline only
export const AIRPORT_BOUNDARY_SOURCE = "airport-boundary";
export const AIRPORT_BOUNDARY_LINE_LAYER = "airport-boundary-line";

const zoneBorderColors: Record<Exclude<SafetyZoneType, "AIRPORT_BOUNDARY">, string> = {
  CTR: ZONE_COLORS.CTR,
  RESTRICTED: ZONE_COLORS.RESTRICTED,
  PROHIBITED: ZONE_COLORS.PROHIBITED,
  TEMPORARY_NO_FLY: ZONE_COLORS.TEMPORARY_NO_FLY,
};

/** adds safety zone layers with hatch pattern fills and labels. */
export function addSafetyZoneLayers(
  map: MaplibreMap,
  zones: SafetyZoneResponse[],
): string[] {
  // split boundary zones from regular zones - include inactive for visibility
  const regularZones = zones.filter(
    (z) => z.type !== "AIRPORT_BOUNDARY",
  );
  const boundaryZone = zones.find(
    (z) => z.type === "AIRPORT_BOUNDARY",
  );

  // register hatch patterns per zone type
  for (const [type, color] of Object.entries(zoneBorderColors)) {
    const imgName = `hatch-${type.toLowerCase()}`;
    try {
      if (map.hasImage(imgName)) map.removeImage(imgName);
    } catch (e) {
      console.warn(`failed to remove hatch image ${imgName}`, e);
    }
    map.addImage(imgName, createHatchPattern(color));
  }

  map.addSource(SAFETY_ZONE_SOURCE, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: regularZones.map((z) => ({
        type: "Feature" as const,
        properties: {
          id: z.id,
          name: z.name,
          zoneType: z.type,
          borderColor: zoneBorderColors[z.type as keyof typeof zoneBorderColors] ?? NEUTRAL.BORDER,
          hatchImage: `hatch-${z.type.toLowerCase()}`,
          entityType: "safety_zone",
          isActive: z.is_active,
        },
        geometry: z.geometry,
      })),
    },
  });

  // solid color fill - reduced opacity for inactive zones
  map.addLayer({
    id: SAFETY_ZONE_FILL_LAYER,
    type: "fill",
    source: SAFETY_ZONE_SOURCE,
    paint: {
      "fill-color": ["get", "borderColor"],
      "fill-opacity": ["case", ["get", "isActive"], 0.12, 0.08],
    },
  });

  // hatch pattern overlay - hidden for inactive zones
  map.addLayer({
    id: SAFETY_ZONE_HATCH_LAYER,
    type: "fill",
    source: SAFETY_ZONE_SOURCE,
    filter: ["==", ["get", "isActive"], true],
    paint: {
      "fill-pattern": ["get", "hatchImage"],
      "fill-opacity": 0.5,
    },
  });

  // dashed border - dotted for inactive zones
  map.addLayer({
    id: SAFETY_ZONE_BORDER_LAYER,
    type: "line",
    source: SAFETY_ZONE_SOURCE,
    paint: {
      "line-color": ["get", "borderColor"],
      "line-width": ["case", ["get", "isActive"], 2, 1],
      "line-dasharray": ["case", ["get", "isActive"],
        ["literal", [2, 2]],
        ["literal", [1, 3]],
      ],
      "line-opacity": ["case", ["get", "isActive"], 1, 0.6],
    },
  });

  // zone type label - muted for inactive zones
  map.addLayer({
    id: SAFETY_ZONE_LABEL_LAYER,
    type: "symbol",
    source: SAFETY_ZONE_SOURCE,
    layout: {
      "text-field": ["get", "zoneType"],
      "text-size": 11,
      "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
      "text-allow-overlap": false,
      "text-transform": "uppercase",
    },
    paint: {
      "text-color": ["get", "borderColor"],
      "text-halo-color": NEUTRAL.BLACK,
      "text-halo-width": 1,
      "text-opacity": ["case", ["get", "isActive"], 1, 0.55],
    },
  });

  const layerIds = [
    SAFETY_ZONE_FILL_LAYER,
    SAFETY_ZONE_HATCH_LAYER,
    SAFETY_ZONE_BORDER_LAYER,
    SAFETY_ZONE_LABEL_LAYER,
  ];

  // airport boundary: dashed outline only (no fill/mask)
  if (boundaryZone && boundaryZone.geometry) {
    const outlineFeature = {
      type: "Feature" as const,
      properties: {
        id: boundaryZone.id,
        name: boundaryZone.name,
        entityType: "airport_boundary",
        role: "outline",
      },
      geometry: boundaryZone.geometry,
    };

    map.addSource(AIRPORT_BOUNDARY_SOURCE, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [outlineFeature],
      },
    });

    map.addLayer({
      id: AIRPORT_BOUNDARY_LINE_LAYER,
      type: "line",
      source: AIRPORT_BOUNDARY_SOURCE,
      filter: ["==", ["get", "role"], "outline"],
      paint: {
        "line-color": NEUTRAL.WHITE,
        "line-width": 2,
        "line-dasharray": [4, 4],
      },
    });

    layerIds.push(AIRPORT_BOUNDARY_LINE_LAYER);
  }

  return layerIds;
}
