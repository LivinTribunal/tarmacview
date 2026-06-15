import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTranslation } from "react-i18next";
import type { DronePathPoint, ReferencePoint } from "@/types/measurement";
import { makeSatelliteStyle } from "@/components/map/mapStyles";
import { TRAJECTORY_COLORS, AGL_COLORS, NEUTRAL } from "@/constants/palette";

interface DronePathMapProps {
  dronePath: DronePathPoint[];
  referencePoints: ReferencePoint[];
}

function pathFeature(path: DronePathPoint[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: path.map((p) => [p.longitude, p.latitude]),
    },
  };
}

function refPointsFeature(
  refs: ReferencePoint[],
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: refs.map((r) => ({
      type: "Feature",
      properties: { name: r.light_name },
      geometry: { type: "Point", coordinates: [r.longitude, r.latitude] },
    })),
  };
}

function pathPointsFeature(
  path: DronePathPoint[],
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: path.map((p) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
    })),
  };
}

/** read-only maplibre map showing the flown drone path + PAPI reference points. */
export default function DronePathMap({
  dronePath,
  referencePoints,
}: DronePathMapProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const coords = [
      ...dronePath.map((p) => [p.longitude, p.latitude] as [number, number]),
      ...referencePoints.map(
        (r) => [r.longitude, r.latitude] as [number, number],
      ),
    ];

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: makeSatelliteStyle(),
      center: coords[0] ?? [0, 0],
      zoom: 15,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      map.addSource("drone-path", { type: "geojson", data: pathFeature(dronePath) });
      map.addLayer({
        id: "drone-path-line",
        type: "line",
        source: "drone-path",
        paint: { "line-color": TRAJECTORY_COLORS.PATH, "line-width": 3 },
      });

      // per-position dots so a stationary / near-zero-length path (papi footage
      // holds a fixed standoff while altitude sweeps) is still visible on the map
      map.addSource("drone-path-points", {
        type: "geojson",
        data: pathPointsFeature(dronePath),
      });
      map.addLayer({
        id: "drone-path-point",
        type: "circle",
        source: "drone-path-points",
        paint: {
          "circle-radius": 4,
          "circle-color": TRAJECTORY_COLORS.PATH,
          "circle-stroke-width": 1,
          "circle-stroke-color": NEUTRAL.WHITE,
        },
      });

      map.addSource("ref-points", {
        type: "geojson",
        data: refPointsFeature(referencePoints),
      });
      map.addLayer({
        id: "ref-points-circle",
        type: "circle",
        source: "ref-points",
        paint: {
          "circle-radius": 6,
          "circle-color": AGL_COLORS.PAPI,
          "circle-stroke-width": 2,
          "circle-stroke-color": NEUTRAL.WHITE,
        },
      });

      if (coords.length > 0) {
        const bounds = coords.reduce(
          (b, c) => b.extend(c),
          new maplibregl.LngLatBounds(coords[0], coords[0]),
        );
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        // a single point or a near-zero-span path collapses fitBounds to a
        // degenerate box - center on it at a sensible zoom instead of a blank map
        const spanDeg = Math.max(
          Math.abs(ne.lng - sw.lng),
          Math.abs(ne.lat - sw.lat),
        );
        if (spanDeg < 1e-4) {
          map.jumpTo({ center: bounds.getCenter(), zoom: 17 });
        } else {
          map.fitBounds(bounds, { padding: 48, maxZoom: 18, duration: 0 });
        }
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // draw once on mount - results are immutable for a finished run, so the
    // path/refs props are intentionally read once and not in the dep array
  }, []);

  return (
    <div className="relative w-full h-full min-h-[320px]">
      <div
        ref={containerRef}
        className="absolute inset-0 rounded-2xl overflow-hidden"
        data-testid="drone-path-map"
      />
      {dronePath.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-sm text-tv-text-muted">
            {t("results.map.noPath")}
          </span>
        </div>
      )}
    </div>
  );
}
