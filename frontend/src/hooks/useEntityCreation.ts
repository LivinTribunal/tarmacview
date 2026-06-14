import { useState, useCallback, useMemo } from "react";

import type { AirportDetailResponse } from "@/types/airport";
import type { MapFeature, DrawingTool } from "@/types/map";
import type {
  PendingGeometryType,
  EntityType,
} from "@/components/coordinator/CreationForm";
import type { CircleResult } from "@/hooks/useDrawCircle";
import type {
  ExtractorHandoff,
  LensHeights,
} from "@/components/coordinator/ImageMetadataExtractorModal";
import type { ElevationResolver } from "@/utils/takeoffLandingPlacement";
import {
  extractCenterline,
  haversineDistance,
  computeBearing,
} from "@/utils/geo";
import {
  openRing,
  derivePolygonWidth,
  shoelaceArea,
  circleArea,
} from "@/utils/polygonGeometryDerivation";
import { createEntity } from "@/pages/coordinator-center/buildEntityCreatePayloads";

interface UseEntityCreationParams {
  id: string | undefined;
  airport: AirportDetailResponse | null;
  elevationResolver: ElevationResolver | undefined;
  fetchAirport: () => Promise<AirportDetailResponse | null>;
  setActiveTool: (tool: DrawingTool) => void;
  setSelectedFeature: (feature: MapFeature | null) => void;
}

interface PrefilledGeometry {
  width?: number;
  length?: number;
  heading?: number;
  area?: number;
}

interface EntityCreationReturn {
  pendingGeometry: GeoJSON.Polygon | null;
  pendingGeometryType: PendingGeometryType;
  pendingCircleRadius: number | undefined;
  pendingCircleCenter: [number, number] | undefined;
  pendingPointPosition: [number, number] | undefined;
  boundaryEntityOverride: EntityType | null;
  setBoundaryEntityOverride: React.Dispatch<React.SetStateAction<EntityType | null>>;
  handlePolygonComplete: (polygon: GeoJSON.Polygon) => void;
  handleCircleComplete: (result: CircleResult) => void;
  handleRectangleComplete: (polygon: GeoJSON.Polygon) => void;
  handlePointComplete: (point: [number, number]) => void;
  handleCreationCancel: () => void;
  handleAddLha: (aglId: string) => void;
  handleCreate: (entityType: string, data: Record<string, unknown>) => Promise<void>;
  // pre-fill the creation panel from extracted photo metadata (no db write).
  beginExtractorHandoff: (handoff: ExtractorHandoff) => void;
  // PAPI lens heights to seed the lha creation form, set by an extractor handoff.
  prefilledLensHeights: LensHeights | null;
  prefilledGeometry: PrefilledGeometry;
  // (start, end) of the derived centerline so the form can seed runway
  // threshold/end without re-running extractCenterline.
  centerlineEndpoints: [[number, number], [number, number]] | undefined;
  clearPending: () => void;
}

/** owns pending creation geometry, the creation form submit, and prefill derivation. */
export default function useEntityCreation({
  id,
  airport,
  elevationResolver,
  fetchAirport,
  setActiveTool,
  setSelectedFeature,
}: UseEntityCreationParams): EntityCreationReturn {
  const [pendingLhaParentAglId, setPendingLhaParentAglId] = useState<string | null>(null);

  // extractor handoff: queue of remaining points + their lens heights, plus the
  // lens prefill seeding the point currently in the creation form.
  const [pointQueue, setPointQueue] = useState<[number, number][]>([]);
  const [queueLens, setQueueLens] = useState<(LensHeights | null)[]>([]);
  const [lensPrefill, setLensPrefill] = useState<LensHeights | null>(null);

  // pending geometry from drawing tools
  const [pendingGeometry, setPendingGeometry] = useState<GeoJSON.Polygon | null>(null);
  const [pendingGeometryType, setPendingGeometryType] = useState<PendingGeometryType>("polygon");
  const [pendingCircleRadius, setPendingCircleRadius] = useState<number | undefined>();
  const [pendingCircleCenter, setPendingCircleCenter] = useState<[number, number] | undefined>();
  const [pendingPointPosition, setPendingPointPosition] = useState<[number, number] | undefined>();
  const [boundaryEntityOverride, setBoundaryEntityOverride] = useState<EntityType | null>(null);

  // drawing completion handlers
  const handlePolygonComplete = useCallback((polygon: GeoJSON.Polygon) => {
    /** handle completed polygon from draw polygon tool. */
    setPendingGeometry(polygon);
    setPendingGeometryType("polygon");
    setPendingCircleRadius(undefined);
    setPendingCircleCenter(undefined);
    setPendingPointPosition(undefined);
    setActiveTool("select");
  }, [setActiveTool]);

  const handleCircleComplete = useCallback((result: CircleResult) => {
    /** handle completed circle from draw circle tool. */
    setPendingGeometry(result.polygon);
    setPendingGeometryType("circle");
    setPendingCircleRadius(result.radius);
    setPendingCircleCenter(result.center);
    setPendingPointPosition(undefined);
    setActiveTool("select");
  }, [setActiveTool]);

  const handleRectangleComplete = useCallback((polygon: GeoJSON.Polygon) => {
    /** handle completed rectangle from draw rectangle tool. */
    setPendingGeometry(polygon);
    setPendingGeometryType("polygon");
    setPendingCircleRadius(undefined);
    setPendingCircleCenter(undefined);
    setPendingPointPosition(undefined);
    setActiveTool("select");
  }, [setActiveTool]);

  const handlePointComplete = useCallback((point: [number, number]) => {
    /** handle completed point from place point tool. */
    setPendingGeometry(null);
    setPendingCircleRadius(undefined);
    setPendingCircleCenter(undefined);
    setPendingPointPosition(point);

    setPendingGeometryType("point");

    setActiveTool("select");
  }, [setActiveTool]);

  // clear pending creation geometry without touching the boundary override
  const clearPending = useCallback(() => {
    /** clear pending geometry for a tool switch (keeps boundary override). */
    setPendingGeometry(null);
    setPendingPointPosition(undefined);
    setPendingCircleCenter(undefined);
    setPendingCircleRadius(undefined);
    setPendingLhaParentAglId(null);
  }, []);

  const handleCreationCancel = useCallback(() => {
    /** cancel pending creation and clear geometry. */
    setPendingGeometry(null);
    setPendingPointPosition(undefined);
    setPendingCircleCenter(undefined);
    setPendingCircleRadius(undefined);
    setPendingLhaParentAglId(null);
    setBoundaryEntityOverride(null);
    setPointQueue([]);
    setQueueLens([]);
    setLensPrefill(null);
  }, []);

  const handleAddLha = useCallback((aglId: string) => {
    /** start lha creation workflow - switch to place point tool with parent agl context. */
    setPendingLhaParentAglId(aglId);
    setSelectedFeature(null);
    setActiveTool("placePoint");
  }, [setActiveTool, setSelectedFeature]);

  const beginExtractorHandoff = useCallback((handoff: ExtractorHandoff) => {
    /** seed the creation form from extracted photo metadata (no db write). */
    setSelectedFeature(null);

    if (handoff.kind === "polygon") {
      setBoundaryEntityOverride(handoff.entityType);
      setLensPrefill(null);
      setPointQueue([]);
      setQueueLens([]);
      handlePolygonComplete(handoff.polygon);
      return;
    }

    if (handoff.kind === "point") {
      setBoundaryEntityOverride(handoff.entityType ?? null);
      setLensPrefill(handoff.lens ?? null);
      setPointQueue([]);
      setQueueLens([]);
      handlePointComplete(handoff.position);
      return;
    }

    // kind === "points": consume the first point now, queue the rest so each
    // subsequent create advances to the next point (same entity type).
    const [first, ...rest] = handoff.positions;
    const lensPerPoint = handoff.lensPerPoint ?? [];
    setBoundaryEntityOverride(handoff.entityType);
    setLensPrefill(lensPerPoint[0] ?? null);
    setPointQueue(rest);
    setQueueLens(lensPerPoint.slice(1));
    if (first) handlePointComplete(first);
  }, [handlePolygonComplete, handlePointComplete, setSelectedFeature]);

  const handleCreate = useCallback(
    async (entityType: string, data: Record<string, unknown>) => {
      /** create entity from the creation form. */
      if (!id || !airport) throw new Error("missing airport context");

      await createEntity(entityType, data, {
        id,
        airport,
        elevationResolver,
        fallbackElevation: airport.elevation,
        pendingGeometry,
        pendingCircleCenter,
        pendingPointPosition,
        pendingLhaParentAglId,
      });

      await fetchAirport();

      // advance the extractor point queue if more points remain, keeping the
      // boundary override so the next point lands the same entity type.
      if (pointQueue.length > 0) {
        const [next, ...rest] = pointQueue;
        const [nextLens, ...restLens] = queueLens;
        setPendingGeometry(null);
        setPendingCircleCenter(undefined);
        setPendingCircleRadius(undefined);
        setPendingPointPosition(next);
        setPendingGeometryType("point");
        setLensPrefill(nextLens ?? null);
        setPointQueue(rest);
        setQueueLens(restLens);
        setActiveTool("select");
      } else {
        handleCreationCancel();
      }
    },
    [id, airport, pendingGeometry, pendingCircleCenter, pendingPointPosition, pendingLhaParentAglId, pointQueue, queueLens, handleCreationCancel, fetchAirport, elevationResolver, setActiveTool],
  );

  // pre-compute geometry-derived values for the creation form
  const prefilledGeometry = useMemo<PrefilledGeometry>(() => {
    /** derive width, length, heading, area from pending geometry for form pre-fill. */
    if (!pendingGeometry) return {};
    const ring = pendingGeometry.coordinates[0] as [number, number][];
    const pts = openRing(ring);

    let length: number | undefined;
    let heading: number | undefined;

    // heading and length from centerline
    const centerline = extractCenterline(ring);
    if (centerline.length >= 2) {
      heading = computeBearing(centerline[0][0], centerline[0][1], centerline[1][0], centerline[1][1]);
      length = haversineDistance(centerline[0][0], centerline[0][1], centerline[1][0], centerline[1][1]);
    }

    const width = derivePolygonWidth(ring, centerline, pts);

    // area via shoelace on projected coordinates
    let area = shoelaceArea(pts);

    // for circles, use pi * r^2
    if (pendingGeometryType === "circle" && pendingCircleRadius != null) {
      area = circleArea(pendingCircleRadius);
    }

    return { width, length, heading, area };
  }, [pendingGeometry, pendingGeometryType, pendingCircleRadius]);

  // extracted centerline endpoints used by the runway threshold/end picker -
  // the creation form needs them as raw (lon, lat) pairs, not the prefill bag.
  const centerlineEndpoints = useMemo<
    [[number, number], [number, number]] | undefined
  >(() => {
    if (!pendingGeometry) return undefined;
    const ring = pendingGeometry.coordinates[0] as [number, number][];
    const cl = extractCenterline(ring);
    if (cl.length < 2) return undefined;
    return [cl[0], cl[1]];
  }, [pendingGeometry]);

  return {
    pendingGeometry,
    pendingGeometryType,
    pendingCircleRadius,
    pendingCircleCenter,
    pendingPointPosition,
    boundaryEntityOverride,
    setBoundaryEntityOverride,
    handlePolygonComplete,
    handleCircleComplete,
    handleRectangleComplete,
    handlePointComplete,
    handleCreationCancel,
    handleAddLha,
    handleCreate,
    beginExtractorHandoff,
    prefilledLensHeights: lensPrefill,
    prefilledGeometry,
    centerlineEndpoints,
    clearPending,
  };
}
