import { useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useCesium } from "resium";
import { CustomDataSource } from "cesium";
import type { WaypointResponse } from "@/types/flightPlan";
import type { PointZ } from "@/types/common";
import type { MapLayerConfig } from "@/types/map";
import type { FlightPlanScope } from "@/types/enums";
import { collapseWaypointStacks } from "./labelDeclutter";
import {
  addCameraHeadingLines,
  addCornerDots,
  addPathArrows,
  addPathSegments,
  addStackedMeasurementDots,
  addTakeoffLanding,
  addWaypointDots,
  scopeIncludesTakeoffLanding,
} from "./trajectoryEntityBuilders";
import { useTrajectoryTerrainSampling } from "./useTrajectoryTerrainSampling";

interface CesiumTrajectoryProps {
  waypoints: WaypointResponse[];
  layers: MapLayerConfig;
  selectedWaypointId?: string | null;
  takeoffCoordinate?: PointZ | null;
  landingCoordinate?: PointZ | null;
  visibleInspectionIds?: Set<string>;
  inspectionIndexMap?: Record<string, number>;
  showSimplified?: boolean;
  highlightedWaypointIds?: string[] | null;
  flightPlanScope?: FlightPlanScope | null;
}

/** renders trajectory entities (waypoints, flight path, takeoff/landing) in cesium
 * using an imperative CustomDataSource for reliable entity creation. */
export default function CesiumTrajectory({
  waypoints,
  layers,
  selectedWaypointId,
  takeoffCoordinate,
  landingCoordinate,
  visibleInspectionIds,
  inspectionIndexMap,
  showSimplified,
  highlightedWaypointIds,
  flightPlanScope,
}: CesiumTrajectoryProps) {
  const { t } = useTranslation();
  const { viewer } = useCesium();
  // two datasources: lines render first, dots on top (separate render passes)
  const linesRef = useRef<CustomDataSource | null>(null);
  const dotsRef = useRef<CustomDataSource | null>(null);

  // filter visible waypoints - allow simplified OR full trajectory
  const visibleWaypoints = useMemo(() => {
    if (!layers.trajectory && !showSimplified) return [];
    return waypoints.filter((wp) => {
      if (wp.waypoint_type === "TRANSIT") return showSimplified || layers.transitWaypoints;
      if (wp.waypoint_type === "MEASUREMENT") {
        if (!showSimplified && !layers.measurementWaypoints) return false;
        if (visibleInspectionIds && wp.inspection_id) {
          return visibleInspectionIds.has(wp.inspection_id);
        }
        return true;
      }
      return true;
    });
  }, [waypoints, layers, visibleInspectionIds, showSimplified]);

  const sampledHeights = useTrajectoryTerrainSampling(
    viewer,
    visibleWaypoints,
    takeoffCoordinate,
    landingCoordinate,
  );

  // create two datasources on mount - lines first, dots second for z-order
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    // aggressively remove ALL trajectory datasources (handles HMR, strict mode, renames)
    for (const name of ["trajectory", "trajectory-lines", "trajectory-dots"]) {
      let stale = viewer.dataSources.getByName(name);
      while (stale.length > 0) {
        viewer.dataSources.remove(stale[0]);
        stale = viewer.dataSources.getByName(name);
      }
    }

    const lines = new CustomDataSource("trajectory-lines");
    const dots = new CustomDataSource("trajectory-dots");
    viewer.dataSources.add(lines);
    viewer.dataSources.add(dots);
    linesRef.current = lines;
    dotsRef.current = dots;
    return () => {
      linesRef.current = null;
      dotsRef.current = null;
      if (!viewer.isDestroyed()) {
        viewer.dataSources.remove(lines);
        viewer.dataSources.remove(dots);
      }
    };
  }, [viewer]);

  // rebuild all entities on any data change
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;

    // remove any stale datasources not owned by this instance
    for (const name of ["trajectory", "trajectory-lines", "trajectory-dots"]) {
      const all = viewer.dataSources.getByName(name);
      for (let i = 0; i < all.length; i++) {
        if (all[i] !== linesRef.current && all[i] !== dotsRef.current) {
          viewer.dataSources.remove(all[i]);
        }
      }
    }

    const lines = linesRef.current;
    const dots = dotsRef.current;
    if (!lines || !dots) return;
    lines.entities.removeAll();
    dots.entities.removeAll();

    if (visibleWaypoints.length === 0 && !takeoffCoordinate && !landingCoordinate) return;

    // gate on populated heights map to avoid a flash-frame at wrong altitude
    if (sampledHeights.size === 0) return;

    const takeoffLabel = t("map.takeoffLabel");
    const landingLabel = t("map.landingLabel");

    // collapse trajectory waypoints sharing the same ground (lng,lat) into one
    // visible label so vertical measurement profiles don't pile up on the same
    // screen pixel.
    const stackCandidates = visibleWaypoints.reduce<
      Array<{ id: string; lng: number; lat: number; alt: number }>
    >((acc, wp) => {
      if (wp.waypoint_type !== "TAKEOFF" && wp.waypoint_type !== "LANDING") {
        const [lng, lat, alt] = wp.position.coordinates;
        acc.push({ id: wp.id, lng, lat, alt: alt ?? 0 });
      }
      return acc;
    }, []);
    const stackMap = collapseWaypointStacks(stackCandidates);

    // scope omitting ground T/L must not synthesize legs or markers in 3D
    const scopeShowsTakeoffLanding = scopeIncludesTakeoffLanding(flightPlanScope);

    if (showSimplified) {
      addPathSegments(lines, visibleWaypoints, sampledHeights, 5,
        takeoffCoordinate, landingCoordinate, true, flightPlanScope);
      addCornerDots(dots, visibleWaypoints, sampledHeights);
      addStackedMeasurementDots(dots, visibleWaypoints, sampledHeights);
      if (scopeShowsTakeoffLanding) {
        addTakeoffLanding(dots, takeoffCoordinate, landingCoordinate,
          sampledHeights, takeoffLabel, landingLabel);
      }
    } else {
      // lines datasource: path, camera heading, arrows
      if (layers.cameraHeading) {
        addCameraHeadingLines(lines, visibleWaypoints, sampledHeights);
      }
      if (layers.path) {
        addPathSegments(lines, visibleWaypoints, sampledHeights, 3,
          takeoffCoordinate, landingCoordinate, layers.takeoffLanding,
          flightPlanScope);
      }
      if (layers.pathHeading) {
        addPathArrows(lines, visibleWaypoints, sampledHeights);
      }
      // dots datasource: markers and labels (renders on top)
      if (layers.takeoffLanding && scopeShowsTakeoffLanding) {
        addTakeoffLanding(dots, takeoffCoordinate, landingCoordinate,
          sampledHeights, takeoffLabel, landingLabel);
      }
      addWaypointDots(dots, visibleWaypoints, selectedWaypointId,
        sampledHeights, stackMap, inspectionIndexMap, highlightedWaypointIds);
    }
  }, [viewer, visibleWaypoints, selectedWaypointId, sampledHeights,
    takeoffCoordinate, landingCoordinate, flightPlanScope, inspectionIndexMap,
    showSimplified, layers.path, layers.takeoffLanding, layers.cameraHeading,
    layers.pathHeading, highlightedWaypointIds, t]);

  return null;
}
