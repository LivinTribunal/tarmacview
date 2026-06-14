import { describe, it, expect } from "vitest";
import { layerGroupMap } from "./mapLayerGroups";
import {
  SAFETY_ZONE_FILL_LAYER,
  SAFETY_ZONE_HATCH_LAYER,
  SAFETY_ZONE_BORDER_LAYER,
  SAFETY_ZONE_LABEL_LAYER,
  AIRPORT_BOUNDARY_LINE_LAYER,
} from "./layers/safetyZoneLayers";

describe("layerGroupMap safety-zone / airport-boundary split", () => {
  it("safetyZones contains only the four SAFETY_ZONE_* layers", () => {
    expect(layerGroupMap.safetyZones).toEqual([
      SAFETY_ZONE_FILL_LAYER,
      SAFETY_ZONE_HATCH_LAYER,
      SAFETY_ZONE_BORDER_LAYER,
      SAFETY_ZONE_LABEL_LAYER,
    ]);
    expect(layerGroupMap.safetyZones).not.toContain(AIRPORT_BOUNDARY_LINE_LAYER);
  });

  it("airportBoundary contains only the boundary line layer", () => {
    expect(layerGroupMap.airportBoundary).toEqual([AIRPORT_BOUNDARY_LINE_LAYER]);
  });
});
