import type {
  AirportDetailResponse,
  ObstacleResponse,
  SafetyZoneResponse,
  SurfaceResponse,
} from "@/types/airport";
import type { MapFeature } from "@/types/map";
import type { PendingChange } from "@/hooks/useDirtyHistory";
import type useEntityCreation from "@/hooks/useEntityCreation";
import type useMapPickingTools from "@/hooks/useMapPickingTools";
import type useMeasureDistance from "@/hooks/useMeasureDistance";
import type useHeadingTool from "@/hooks/useHeadingTool";
import type { useElevationResolver } from "@/hooks/useElevationResolver";
import EditableFeatureInfo from "@/components/coordinator/EditableFeatureInfo";
import CreationForm from "@/components/coordinator/CreationForm";
import MeasureInfoCard from "@/components/map/overlays/MeasureInfoCard";
import HeadingInfoCard from "@/components/map/overlays/HeadingInfoCard";
import { buildSurfaceDeleteWarnings } from "@/components/coordinator/surfaceDeleteWarnings";

interface FeatureEditorPanelProps {
  t: (key: string, opts?: Record<string, unknown>) => string;
  airportId: string | undefined;
  airportElevation: number | undefined;
  surfaces: SurfaceResponse[];
  obstacles: ObstacleResponse[];
  safetyZones: SafetyZoneResponse[];
  selectedFeature: MapFeature | null;
  setSelectedFeature: (feature: MapFeature | null) => void;
  creation: ReturnType<typeof useEntityCreation>;
  picking: ReturnType<typeof useMapPickingTools>;
  measure: ReturnType<typeof useMeasureDistance>;
  heading: ReturnType<typeof useHeadingTool>;
  elevationResolver: ReturnType<typeof useElevationResolver>;
  onFeatureUpdate: (data: Record<string, unknown>) => void;
  onFeatureDelete: (featureType: string, featureId: string) => Promise<void>;
  getPendingChange: (entityType: string, entityId: string) => PendingChange | null;
  fetchAirport: () => Promise<AirportDetailResponse | null>;
}

/** create/measure/heading/feature-edit ladder for the airport editor right rail. */
export default function FeatureEditorPanel({
  t,
  airportId,
  airportElevation,
  surfaces,
  obstacles,
  safetyZones,
  selectedFeature,
  setSelectedFeature,
  creation,
  picking,
  measure,
  heading,
  elevationResolver,
  onFeatureUpdate,
  onFeatureDelete,
  getPendingChange,
  fetchAirport,
}: FeatureEditorPanelProps) {
  return (creation.pendingGeometry || creation.pendingPointPosition) ? (
    <CreationForm
      geometryType={creation.pendingGeometryType}
      circleRadius={creation.pendingCircleRadius}
      circleCenter={creation.pendingCircleCenter}
      pointPosition={creation.pendingPointPosition}
      surfaces={surfaces}
      onCancel={creation.handleCreationCancel}
      onCreate={creation.handleCreate}
      prefilledWidth={creation.prefilledGeometry.width}
      prefilledLength={creation.prefilledGeometry.length}
      prefilledHeading={creation.prefilledGeometry.heading}
      prefilledArea={creation.prefilledGeometry.area}
      centerlineEndpoints={creation.centerlineEndpoints}
      obstacles={obstacles}
      safetyZones={safetyZones}
      airportElevation={airportElevation}
      prefilledEntityType={creation.boundaryEntityOverride ?? undefined}
      pickingTouchpoint={picking.pickingTouchpoint}
      onPickTouchpointToggle={() => picking.setPickingTouchpoint((v) => !v)}
      pickedTouchpointCoord={picking.pickedTouchpointCoord}
      onPickedTouchpointConsumed={() => picking.setPickedTouchpointCoord(null)}
      pickingThreshold={picking.pickingThreshold}
      onPickThresholdToggle={() => picking.setPickingThreshold((v) => !v)}
      pickedThresholdCoord={picking.pickedThresholdCoord}
      onPickedThresholdConsumed={() => picking.setPickedThresholdCoord(null)}
      pickingEnd={picking.pickingEnd}
      onPickEndToggle={() => picking.setPickingEnd((v) => !v)}
      pickedEndCoord={picking.pickedEndCoord}
      onPickedEndConsumed={() => picking.setPickedEndCoord(null)}
      resolver={elevationResolver}
      prefilledLensHeightMslM={creation.prefilledLensHeights?.msl ?? undefined}
      prefilledLensHeightAglM={creation.prefilledLensHeights?.agl ?? undefined}
    />
  ) : measure.isComplete ? (
    <MeasureInfoCard
      totalDistance={measure.totalDistance}
      segmentCount={measure.segments.length}
      onClose={measure.dismiss}
    />
  ) : heading.isComplete && heading.bearing !== null ? (
    <HeadingInfoCard
      bearing={heading.bearing}
      onClose={heading.dismiss}
    />
  ) : selectedFeature && selectedFeature.type !== "waypoint" ? (
    <EditableFeatureInfo
      feature={selectedFeature}
      onUpdate={onFeatureUpdate}
      onClose={() => setSelectedFeature(null)}
      airportId={airportId}
      surfaces={surfaces}
      onDelete={onFeatureDelete}
      pendingPatch={
        selectedFeature
          ? getPendingChange(
              selectedFeature.type,
              (selectedFeature.data as { id: string }).id,
            )?.data
          : undefined
      }
      deleteWarnings={
        selectedFeature.type === "surface"
          ? buildSurfaceDeleteWarnings(
              selectedFeature.data as SurfaceResponse,
              surfaces,
              t,
            )
          : undefined
      }
      onAddLha={selectedFeature.type === "agl" ? creation.handleAddLha : undefined}
      onLhasGenerated={selectedFeature.type === "agl" ? async () => { await fetchAirport(); } : undefined}
      pickingTouchpoint={selectedFeature.type === "surface" ? picking.pickingTouchpoint : false}
      onPickTouchpointToggle={
        selectedFeature.type === "surface"
          ? () => picking.setPickingTouchpoint((v) => !v)
          : undefined
      }
      pickedTouchpointCoord={selectedFeature.type === "surface" ? picking.pickedTouchpointCoord : null}
      onPickedTouchpointConsumed={() => picking.setPickedTouchpointCoord(null)}
      pickingLha={selectedFeature.type === "agl" ? picking.pickingLha : null}
      onPickLhaToggle={
        selectedFeature.type === "agl"
          ? (which) => picking.setPickingLha((v) => (v === which ? null : which))
          : undefined
      }
      pickedLhaCoord={selectedFeature.type === "agl" ? picking.pickedLhaCoord : null}
      onPickedLhaConsumed={() => picking.setPickedLhaCoord(null)}
      pickingThreshold={selectedFeature.type === "surface" ? picking.pickingThreshold : false}
      onPickThresholdToggle={
        selectedFeature.type === "surface"
          ? () => picking.setPickingThreshold((v) => !v)
          : undefined
      }
      pickedThresholdCoord={selectedFeature.type === "surface" ? picking.pickedThresholdCoord : null}
      onPickedThresholdConsumed={() => picking.setPickedThresholdCoord(null)}
      pickingEnd={selectedFeature.type === "surface" ? picking.pickingEnd : false}
      onPickEndToggle={
        selectedFeature.type === "surface"
          ? () => picking.setPickingEnd((v) => !v)
          : undefined
      }
      pickedEndCoord={selectedFeature.type === "surface" ? picking.pickedEndCoord : null}
      onPickedEndConsumed={() => picking.setPickedEndCoord(null)}
      onSurfacesChanged={async () => {
        // refetch and re-sync the selected feature with the partner-aware
        // server data so PairSurfaceSection reflects the new paired_surface_id
        // immediately (otherwise the panel keeps the pre-pair surface object
        // until the user clicks elsewhere).
        const fresh = await fetchAirport();
        if (fresh && selectedFeature?.type === "surface") {
          const sid = (selectedFeature.data as { id: string }).id;
          const freshSurface = fresh.surfaces.find((s) => s.id === sid);
          if (freshSurface) {
            setSelectedFeature({ type: "surface", data: freshSurface });
          }
        }
      }}
    />
  ) : null;
}
