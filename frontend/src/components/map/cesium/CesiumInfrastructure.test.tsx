import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// shared mock state: captured Entity props + the viewer useCesium() returns.
// viewerRef.current is swapped per test to drive the terrain-readiness gate.
const { captured, viewerRef } = vi.hoisted(() => ({
  captured: [] as Array<Record<string, unknown>>,
  viewerRef: { current: null as unknown },
}));

vi.mock("resium", () => ({
  Entity: (props: Record<string, unknown>) => {
    captured.push(props);
    return null;
  },
  useCesium: () => ({ viewer: viewerRef.current }),
}));

// jsdom has no WebGL - stub the cesium primitives the agl/lha path touches.
vi.mock("cesium", () => {
  class Color {
    static WHITE = new Color();
    static BLACK = new Color();
    withAlpha() {
      return this;
    }
  }
  return {
    Cartesian3: { fromDegrees: (lng: number, lat: number, alt: number) => ({ lng, lat, alt }) },
    Cartesian2: class {
      constructor(public x = 0, public y = 0) {}
    },
    Color,
    PolygonHierarchy: class {},
    HeightReference: { NONE: 0, CLAMP_TO_GROUND: 1, RELATIVE_TO_GROUND: 2 },
    ClassificationType: { TERRAIN: 0, CESIUM_3D_TILE: 1, BOTH: 2 },
    LabelStyle: { FILL: 0, FILL_AND_OUTLINE: 1 },
    VerticalOrigin: { CENTER: 0, BOTTOM: 1 },
    NearFarScalar: class {
      constructor(public n = 0, public nv = 0, public f = 0, public fv = 0) {}
    },
    PolylineDashMaterialProperty: class {},
    EllipsoidTerrainProvider: class {},
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

vi.mock("./cesiumColors", () => ({
  RUNWAY_FILL: {},
  RUNWAY_OUTLINE: {},
  TAXIWAY_FILL: {},
  TAXIWAY_OUTLINE: {},
  SAFETY_ZONE_COLORS: { CTR: { fill: {}, outline: {} } },
  OBSTACLE_TYPE_COLORS: {},
  SURFACE_BUFFER_COLORS: {},
  RUNWAY_CENTERLINE: {},
  TAXIWAY_CENTERLINE: {},
  aglCesiumColor: () => ({}),
}));

vi.mock("./cesiumUtils", () => ({
  polygonToCartesian3: () => [],
  lineStringToCartesian3: () => [],
  bufferPolygon: () => [],
}));

vi.mock("./labelDeclutter", () => ({
  DECLUTTER_PRIORITY: { agl: 4, lha: 3, safetyZone: 5, obstacle: 2, surface: 7, waypoint: 1 },
}));

vi.mock("@/utils/agl", () => ({ formatAglDisplayName: () => "AGL" }));

import CesiumInfrastructure from "./CesiumInfrastructure";
import { EllipsoidTerrainProvider } from "cesium";
import type { AirportDetailResponse } from "@/types/airport";
import type { MapLayerConfig } from "@/types/map";

const LAYERS_AGL_ONLY: MapLayerConfig = {
  runways: false,
  taxiways: false,
  obstacles: false,
  safetyZones: false,
  airportBoundary: false,
  aglSystems: true,
  bufferZones: false,
  simplifiedTrajectory: false,
  trajectory: false,
  transitWaypoints: false,
  measurementWaypoints: false,
  path: false,
  takeoffLanding: false,
  cameraHeading: false,
  pathHeading: false,
};

function lha(id: string, unit: string, lng: number) {
  return {
    id,
    unit_designator: unit,
    setting_angle: 3.0,
    position: { type: "Point", coordinates: [lng, 48.12316, 128.7] },
  };
}

const AIRPORT = {
  id: "ap1",
  location: { type: "Point", coordinates: [17.13865, 48.12316] },
  safety_zones: [],
  obstacles: [],
  surfaces: [
    {
      id: "s1",
      surface_type: "RUNWAY",
      identifier: "RWY 1",
      boundary: null,
      geometry: null,
      agls: [
        {
          id: "agl1",
          agl_type: "PAPI",
          name: "",
          position: { type: "Point", coordinates: [17.13865, 48.12316, 128.7] },
          lhas: [
            lha("a", "A", 17.13854),
            lha("b", "B", 17.138617),
            lha("c", "C", 17.138694),
            lha("d", "D", 17.138771),
          ],
        },
      ],
    },
  ],
} as unknown as AirportDetailResponse;

interface Graphics {
  disableDepthTestDistance?: number;
}
interface EntityProps {
  properties?: { featureType?: string; featureId?: string };
  point?: Graphics;
  label?: Graphics;
}

function realTerrainViewer() {
  return {
    isDestroyed: () => false,
    terrainProvider: { realProvider: true },
    scene: { globe: { terrainProviderChanged: { addEventListener: () => () => {} } } },
  };
}

function ellipsoidViewer() {
  return {
    isDestroyed: () => false,
    terrainProvider: new EllipsoidTerrainProvider(),
    scene: { globe: { terrainProviderChanged: { addEventListener: () => () => {} } } },
  };
}

describe("CesiumInfrastructure agl/lha depth handling", () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it("renders agl + lha point and label with the terrain depth test disabled", () => {
    // real (non-ellipsoid) terrain is already live, so markers render.
    viewerRef.current = realTerrainViewer();
    render(<CesiumInfrastructure airport={AIRPORT} layers={LAYERS_AGL_ONLY} />);

    const entities = captured as unknown as EntityProps[];
    const agl = entities.filter((e) => e.properties?.featureType === "agl");
    const lhas = entities.filter((e) => e.properties?.featureType === "lha");

    expect(agl).toHaveLength(1);
    expect(lhas).toHaveLength(4);

    // without disableDepthTestDistance these markers get occluded by the
    // cesium world terrain mesh and read as "under the ground" (issue: jaro
    // papi a/b sinking while c/d stay correct - a depth-test gap, the stored
    // elevations were identical).
    for (const e of [...agl, ...lhas]) {
      expect(e.point?.disableDepthTestDistance).toBe(Number.POSITIVE_INFINITY);
      expect(e.label?.disableDepthTestDistance).toBe(Number.POSITIVE_INFINITY);
    }
  });

  it("holds agl/lha markers back until terrain has settled", () => {
    // terrain is still the default ellipsoid (setTerrain not resolved yet) and
    // the change event never fires - markers must NOT mount, otherwise they
    // clamp to the ellipsoid and sit under the world terrain once it streams in.
    viewerRef.current = ellipsoidViewer();
    render(<CesiumInfrastructure airport={AIRPORT} layers={LAYERS_AGL_ONLY} />);

    const entities = captured as unknown as EntityProps[];
    expect(entities.filter((e) => e.properties?.featureType === "agl")).toHaveLength(0);
    expect(entities.filter((e) => e.properties?.featureType === "lha")).toHaveLength(0);
  });
});

const AIRPORT_WITH_BOUNDARY = {
  id: "ap2",
  location: { type: "Point", coordinates: [17.13865, 48.12316] },
  safety_zones: [
    {
      id: "ctr1",
      type: "CTR",
      name: "Alpha CTR",
      is_active: true,
      altitude_floor: 0,
      altitude_ceiling: 500,
      geometry: {
        type: "Polygon",
        coordinates: [[[17.0, 48.0], [17.1, 48.0], [17.1, 48.1], [17.0, 48.1], [17.0, 48.0]]],
      },
    },
    {
      id: "bnd1",
      type: "AIRPORT_BOUNDARY",
      name: "Boundary",
      is_active: true,
      altitude_floor: null,
      altitude_ceiling: null,
      geometry: {
        type: "Polygon",
        coordinates: [[[17.0, 48.0], [17.2, 48.0], [17.2, 48.2], [17.0, 48.2], [17.0, 48.0]]],
      },
    },
  ],
  obstacles: [],
  surfaces: [],
} as unknown as AirportDetailResponse;

function layersWith(overrides: Partial<MapLayerConfig>): MapLayerConfig {
  return { ...LAYERS_AGL_ONLY, aglSystems: false, ...overrides };
}

describe("CesiumInfrastructure safety zone / airport boundary split", () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it("renders only boundary entities when safetyZones is off and airportBoundary is on", () => {
    viewerRef.current = realTerrainViewer();
    render(
      <CesiumInfrastructure
        airport={AIRPORT_WITH_BOUNDARY}
        layers={layersWith({ safetyZones: false, airportBoundary: true })}
      />,
    );

    const entities = captured as unknown as EntityProps[];
    const zoneEntities = entities.filter(
      (e) => e.properties?.featureType === "safety_zone" && e.properties.featureId === "ctr1",
    );
    const boundaryEntities = entities.filter(
      (e) => e.properties?.featureType === "safety_zone" && e.properties.featureId === "bnd1",
    );

    expect(zoneEntities).toHaveLength(0);
    expect(boundaryEntities.length).toBeGreaterThan(0);
  });

  it("renders only safety-zone entities when airportBoundary is off and safetyZones is on", () => {
    viewerRef.current = realTerrainViewer();
    render(
      <CesiumInfrastructure
        airport={AIRPORT_WITH_BOUNDARY}
        layers={layersWith({ safetyZones: true, airportBoundary: false })}
      />,
    );

    const entities = captured as unknown as EntityProps[];
    const zoneEntities = entities.filter(
      (e) => e.properties?.featureType === "safety_zone" && e.properties.featureId === "ctr1",
    );
    const boundaryEntities = entities.filter(
      (e) => e.properties?.featureType === "safety_zone" && e.properties.featureId === "bnd1",
    );

    expect(zoneEntities.length).toBeGreaterThan(0);
    expect(boundaryEntities).toHaveLength(0);
  });
});
