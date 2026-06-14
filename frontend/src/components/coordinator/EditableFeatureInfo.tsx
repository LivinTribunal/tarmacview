import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import FeatureInfoPanel from "@/components/common/FeatureInfoPanel";
import ConfirmDeleteDialog from "./ConfirmDeleteDialog";
import type { MapFeature } from "@/types/map";
import type { SurfaceResponse, AGLResponse } from "@/types/airport";
import type { PointZ } from "@/types/common";
import { recalculateSurface, recalculateObstacle } from "@/api/airports";
import SurfaceFields from "./featureInfo/SurfaceFields";
import ObstacleFields from "./featureInfo/ObstacleFields";
import SafetyZoneFields from "./featureInfo/SafetyZoneFields";
import AglFields from "./featureInfo/AglFields";
import LhaFields from "./featureInfo/LhaFields";
import type { RecalcPreview } from "./featureInfo/RecalculateBlock";

interface EditableFeatureInfoProps {
  feature: MapFeature;
  onUpdate: (data: Record<string, unknown>) => void;
  onClose: () => void;
  airportId?: string;
  surfaces?: SurfaceResponse[];
  onDelete?: (featureType: string, id: string) => Promise<void>;
  deleteWarnings?: string[];
  onAddLha?: (aglId: string) => void;
  onLhasGenerated?: () => Promise<void> | void;
  // unsaved patch from the parent's dirty-history; merged on top of the server
  // value every render so undo/redo and feature switches stay in sync
  pendingPatch?: Record<string, unknown>;
  pickingTouchpoint?: boolean;
  onPickTouchpointToggle?: () => void;
  pickedTouchpointCoord?: { lat: number; lon: number; alt: number } | null;
  onPickedTouchpointConsumed?: () => void;
  pickingLha?: "first" | "last" | null;
  onPickLhaToggle?: (which: "first" | "last") => void;
  pickedLhaCoord?: { which: "first" | "last"; lat: number; lon: number; alt: number } | null;
  onPickedLhaConsumed?: () => void;
  pickingThreshold?: boolean;
  onPickThresholdToggle?: () => void;
  pickedThresholdCoord?: { lat: number; lon: number; alt: number } | null;
  onPickedThresholdConsumed?: () => void;
  pickingEnd?: boolean;
  onPickEndToggle?: () => void;
  pickedEndCoord?: { lat: number; lon: number; alt: number } | null;
  onPickedEndConsumed?: () => void;
  // refresh airport detail (used after surface pair couple/decouple/create-reverse)
  onSurfacesChanged?: () => Promise<void> | void;
}

export default function EditableFeatureInfo({
  feature,
  onUpdate,
  onClose,
  airportId,
  surfaces,
  onDelete,
  deleteWarnings,
  onAddLha,
  onLhasGenerated,
  pendingPatch,
  pickingTouchpoint,
  onPickTouchpointToggle,
  pickedTouchpointCoord,
  onPickedTouchpointConsumed,
  pickingLha,
  onPickLhaToggle,
  pickedLhaCoord,
  onPickedLhaConsumed,
  pickingThreshold,
  onPickThresholdToggle,
  pickedThresholdCoord,
  onPickedThresholdConsumed,
  pickingEnd,
  onPickEndToggle,
  pickedEndCoord,
  onPickedEndConsumed,
  onSurfacesChanged,
}: EditableFeatureInfoProps) {
  /** editable feature info panel for selected map features. */
  const { t } = useTranslation();
  // controlled-from-parent: server value overlaid with the parent's pending
  // patch every render. undo/redo flows in via a new pendingPatch reference.
  const data = useMemo(
    () => ({ ...feature.data, ...(pendingPatch ?? {}) }) as Record<string, unknown>,
    [feature, pendingPatch],
  );
  const featureId = (feature.data as { id?: string }).id;

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [recalcPreview, setRecalcPreview] = useState<RecalcPreview | null>(null);
  const [recalcLoading, setRecalcLoading] = useState(false);
  const [recalcError, setRecalcError] = useState<string | null>(null);
  const [seqError, setSeqError] = useState<string | null>(null);
  // raw text held while the user types an out-of-range or partial value;
  // null means defer to data.sequence_number for the input value
  const [seqDraft, setSeqDraft] = useState<string | null>(null);

  // reset transient ui flags only when the feature itself switches
  useEffect(() => {
    setRecalcPreview(null);
    setRecalcError(null);
    setRecalcLoading(false);
    setDeleteError(null);
    setSeqError(null);
    setSeqDraft(null);
  }, [feature.type, featureId]);

  // apply picked touchpoint coord and notify parent it's consumed
  useEffect(() => {
    if (!pickedTouchpointCoord) return;
    onUpdate({
      touchpoint_latitude: pickedTouchpointCoord.lat,
      touchpoint_longitude: pickedTouchpointCoord.lon,
      touchpoint_altitude: pickedTouchpointCoord.alt,
    });
    onPickedTouchpointConsumed?.();
  }, [pickedTouchpointCoord, onUpdate, onPickedTouchpointConsumed]);

  // apply picked threshold coord
  useEffect(() => {
    if (!pickedThresholdCoord) return;
    const pos: PointZ = {
      type: "Point",
      coordinates: [pickedThresholdCoord.lon, pickedThresholdCoord.lat, pickedThresholdCoord.alt],
    };
    onUpdate({ threshold_position: pos });
    onPickedThresholdConsumed?.();
  }, [pickedThresholdCoord, onUpdate, onPickedThresholdConsumed]);

  // apply picked end position coord
  useEffect(() => {
    if (!pickedEndCoord) return;
    const pos: PointZ = {
      type: "Point",
      coordinates: [pickedEndCoord.lon, pickedEndCoord.lat, pickedEndCoord.alt],
    };
    onUpdate({ end_position: pos });
    onPickedEndConsumed?.();
  }, [pickedEndCoord, onUpdate, onPickedEndConsumed]);

  async function handleRecalculate() {
    /** call backend to recompute dimensions and show side-by-side preview. */
    if (!airportId) return;
    setRecalcLoading(true);
    setRecalcError(null);
    try {
      if (feature.type === "surface") {
        const result = await recalculateSurface(airportId, String(data.id));
        setRecalcPreview({ kind: "surface", data: result });
      } else if (feature.type === "obstacle") {
        const result = await recalculateObstacle(airportId, String(data.id));
        setRecalcPreview({ kind: "obstacle", data: result });
      }
    } catch (err) {
      console.error("recalculate failed", err);
      setRecalcError(
        err instanceof Error && err.message
          ? err.message
          : t("coordinator.detail.recalculateError"),
      );
    } finally {
      setRecalcLoading(false);
    }
  }

  function handleApplyRecalculate() {
    /** apply recalculated dimensions via the standard update path. */
    if (!recalcPreview) return;
    // obstacle preview is read-only - obstacles have no length/width columns
    if (recalcPreview.kind !== "surface") {
      setRecalcPreview(null);
      return;
    }
    const recalculated = recalcPreview.data.recalculated;
    const updates: Record<string, unknown> = {};
    if (recalculated.length != null) updates.length = recalculated.length;
    if (recalculated.width != null) updates.width = recalculated.width;
    if (recalculated.heading != null) updates.heading = recalculated.heading;
    onUpdate(updates);
    setRecalcPreview(null);
  }

  function val(key: string): string {
    /** get merged data field value as string for input binding. */
    const v = data[key];
    if (v == null) return "";
    return String(v);
  }

  function handleChange(field: string, value: string | number | boolean | null) {
    /** propagate field change to parent. */
    onUpdate({ [field]: value });
  }

  return (
    <div data-testid="editable-feature-info">
      <FeatureInfoPanel
        title={t("coordinator.detail.featureInfo")}
        onClose={onClose}
      >
      <div className="flex flex-col gap-1.5 [&_input]:!px-3 [&_input]:!py-1.5 [&_input]:!text-xs">
        {feature.type === "surface" && (
          <SurfaceFields
            data={data}
            surface={feature.data as SurfaceResponse}
            val={val}
            handleChange={handleChange}
            onUpdate={onUpdate}
            airportId={airportId}
            surfaces={surfaces}
            pickingTouchpoint={pickingTouchpoint}
            onPickTouchpointToggle={onPickTouchpointToggle}
            pickingThreshold={pickingThreshold}
            onPickThresholdToggle={onPickThresholdToggle}
            pickingEnd={pickingEnd}
            onPickEndToggle={onPickEndToggle}
            recalcLoading={recalcLoading}
            recalcError={recalcError}
            recalcPreview={recalcPreview}
            onRecalculate={handleRecalculate}
            onApplyRecalculate={handleApplyRecalculate}
            onCancelRecalculate={() => setRecalcPreview(null)}
            onSurfacesChanged={onSurfacesChanged}
          />
        )}

        {feature.type === "obstacle" && (
          <ObstacleFields
            val={val}
            handleChange={handleChange}
            airportId={airportId}
            recalcLoading={recalcLoading}
            recalcError={recalcError}
            recalcPreview={recalcPreview}
            onRecalculate={handleRecalculate}
            onApplyRecalculate={handleApplyRecalculate}
            onCancelRecalculate={() => setRecalcPreview(null)}
          />
        )}

        {feature.type === "safety_zone" && (
          <SafetyZoneFields
            data={data}
            val={val}
            handleChange={handleChange}
          />
        )}

        {feature.type === "agl" && (
          <AglFields
            data={data}
            agl={feature.data as AGLResponse}
            val={val}
            handleChange={handleChange}
            onUpdate={onUpdate}
            surfaces={surfaces}
            airportId={airportId}
            onAddLha={onAddLha}
            onLhasGenerated={onLhasGenerated}
            pickingLha={pickingLha}
            onPickLhaToggle={onPickLhaToggle}
            pickedLhaCoord={pickedLhaCoord}
            onPickedLhaConsumed={onPickedLhaConsumed}
          />
        )}

        {feature.type === "lha" && (
          <LhaFields
            data={data}
            val={val}
            handleChange={handleChange}
            onUpdate={onUpdate}
            surfaces={surfaces}
            seqDraft={seqDraft}
            setSeqDraft={setSeqDraft}
            seqError={seqError}
            setSeqError={setSeqError}
          />
        )}

        {/* delete button */}
        {onDelete && (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center justify-center gap-1.5 w-full mt-1 px-3 py-1.5 rounded-full text-xs font-semibold text-white bg-tv-error hover:opacity-90 transition-colors"
            data-testid="feature-delete-button"
          >
            <Trash2 className="h-3 w-3" />
            {t("coordinator.detail.deleteFeature")}
          </button>
        )}
      </div>
      </FeatureInfoPanel>

      {onDelete && (
        <ConfirmDeleteDialog
          isOpen={showDeleteConfirm}
          name={val("name") || val("identifier") || val("unit_designator") || ""}
          warnings={deleteWarnings}
          error={deleteError}
          onConfirm={async () => {
            setDeleteError(null);
            try {
              await onDelete(feature.type, String(data.id));
              setShowDeleteConfirm(false);
              onClose();
            } catch (err) {
              setDeleteError(
                err instanceof Error && err.message
                  ? err.message
                  : t("coordinator.detail.deleteError"),
              );
            }
          }}
          onCancel={() => {
            setDeleteError(null);
            setShowDeleteConfirm(false);
          }}
        />
      )}
    </div>
  );
}
