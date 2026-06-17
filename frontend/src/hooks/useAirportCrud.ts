import { useState, useCallback } from "react";
import maplibregl from "maplibre-gl";

import {
  deleteAirport,
  deleteSurface,
  deleteObstacle,
  deleteSafetyZone,
  deleteAGL,
  deleteLHA,
  updateSurface,
  updateObstacle,
  updateSafetyZone,
  updateAGL,
  updateLHA,
  updateAirport,
} from "@/api/airports";
import type { AirportDetailResponse } from "@/types/airport";
import type { MapFeature } from "@/types/map";
import type { PendingChange } from "@/hooks/useDirtyHistory";

/** pull the FastAPI DomainError detail out of an axios error, string or {message} form. */
function extractApiErrorMessage(err: unknown): string | null {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (
    detail &&
    typeof detail === "object" &&
    "message" in detail &&
    typeof (detail as { message: unknown }).message === "string"
  ) {
    return (detail as { message: string }).message;
  }
  return null;
}

interface UseAirportCrudParams {
  id: string | undefined;
  airport: AirportDetailResponse | null;
  fetchAirport: () => Promise<AirportDetailResponse | null>;
  getPendingChanges: () => PendingChange[];
  clearAll: () => void;
  selectedFeature: MapFeature | null;
  setSelectedFeature: (feature: MapFeature | null) => void;
  clearAirport: () => void;
  navigate: (path: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
  getMap: () => maplibregl.Map | null;
}

interface AirportCrudReturn {
  deleteError: boolean;
  saveError: string | null;
  saving: boolean;
  deleteAirportError: string | null;
  setDeleteAirportError: React.Dispatch<React.SetStateAction<string | null>>;
  handleDeleteAirport: () => Promise<void>;
  handleDeleteSurface: (surfaceId: string) => Promise<void>;
  handleDeleteObstacle: (obstacleId: string) => Promise<void>;
  handleDeleteSafetyZone: (zoneId: string) => Promise<void>;
  handleDeleteAgl: (aglId: string) => Promise<void>;
  handleDeleteLha: (lhaId: string) => Promise<void>;
  handleFeatureDelete: (featureType: string, featureId: string) => Promise<void>;
  handleSave: () => Promise<void>;
}

/** owns airport/entity delete handlers and the save flow plus their error state. */
export default function useAirportCrud({
  id,
  airport,
  fetchAirport,
  getPendingChanges,
  clearAll,
  selectedFeature,
  setSelectedFeature,
  clearAirport,
  navigate,
  t,
  getMap,
}: UseAirportCrudParams): AirportCrudReturn {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  const [deleteAirportError, setDeleteAirportError] = useState<string | null>(null);

  const handleDeleteAirport = useCallback(async () => {
    /** delete the entire airport and navigate back to list. */
    if (!id) return;
    setDeleteAirportError(null);
    try {
      await deleteAirport(id);
      clearAirport();
      navigate("/coordinator-center/airports");
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      setDeleteAirportError(t("coordinator.detail.deleteAirportError"));
    }
  }, [id, clearAirport, navigate, t]);

  const handleDeleteSurface = useCallback(
    async (surfaceId: string) => {
      /** delete a surface and refresh. */
      if (!id) return;
      setDeleteError(false);
      try {
        await deleteSurface(id, surfaceId);
        await fetchAirport();
      } catch {
        setDeleteError(true);
      }
    },
    [id, fetchAirport],
  );

  const handleDeleteObstacle = useCallback(
    async (obstacleId: string) => {
      /** delete an obstacle and refresh. */
      if (!id) return;
      setDeleteError(false);
      try {
        await deleteObstacle(id, obstacleId);
        await fetchAirport();
      } catch {
        setDeleteError(true);
      }
    },
    [id, fetchAirport],
  );

  const handleDeleteSafetyZone = useCallback(
    async (zoneId: string) => {
      /** delete a safety zone and refresh. */
      if (!id) return;
      setDeleteError(false);
      try {
        await deleteSafetyZone(id, zoneId);
        await fetchAirport();
      } catch {
        setDeleteError(true);
      }
    },
    [id, fetchAirport],
  );

  const handleDeleteAgl = useCallback(
    async (aglId: string) => {
      /** delete an agl system and refresh. */
      if (!id || !airport) return;
      const surface = airport.surfaces.find((s) =>
        s.agls.some((a) => a.id === aglId),
      );
      if (!surface) return;
      setDeleteError(false);
      try {
        await deleteAGL(id, surface.id, aglId);
        await fetchAirport();
      } catch (e) {
        setDeleteError(true);
        // re-throw so the calling dialog can surface the error inline
        throw e;
      }
    },
    [id, airport, fetchAirport],
  );

  const handleDeleteLha = useCallback(
    async (lhaId: string) => {
      /** delete an lha unit and refresh. */
      if (!id || !airport) return;
      for (const surface of airport.surfaces) {
        for (const agl of surface.agls) {
          if (agl.lhas.some((l) => l.id === lhaId)) {
            setDeleteError(false);
            try {
              await deleteLHA(id, surface.id, agl.id, lhaId);
              await fetchAirport();
            } catch (e) {
              setDeleteError(true);
              // re-throw so the calling dialog can surface the error inline
              throw e;
            }
            return;
          }
        }
      }
    },
    [id, airport, fetchAirport],
  );

  const handleFeatureDelete = useCallback(
    async (featureType: string, featureId: string) => {
      /** dispatch delete by feature type from the feature info panel. */
      switch (featureType) {
        case "surface":
          await handleDeleteSurface(featureId);
          break;
        case "obstacle":
          await handleDeleteObstacle(featureId);
          break;
        case "safety_zone":
          await handleDeleteSafetyZone(featureId);
          break;
        case "agl":
          await handleDeleteAgl(featureId);
          break;
        case "lha":
          await handleDeleteLha(featureId);
          break;
      }
      setSelectedFeature(null);
    },
    [handleDeleteSurface, handleDeleteObstacle, handleDeleteSafetyZone, handleDeleteAgl, handleDeleteLha, setSelectedFeature],
  );

  const handleSave = useCallback(async () => {
    /** persist all pending changes to the backend, preserving map viewport. */
    if (!id || !airport) return;
    setSaving(true);
    setSaveError(null);

    // capture viewport before save
    const mapInst = getMap();
    const viewport = mapInst ? {
      center: mapInst.getCenter(),
      zoom: mapInst.getZoom(),
      bearing: mapInst.getBearing(),
      pitch: mapInst.getPitch(),
    } : null;

    try {
      const pending = getPendingChanges();
      await Promise.all(
        pending
          .map((change) => {
            if (change.action !== "update" || !change.data) return undefined;
            switch (change.entityType) {
              case "surface":
                return updateSurface(id, change.entityId, change.data);
              case "obstacle":
                return updateObstacle(id, change.entityId, change.data);
              case "safety_zone":
                return updateSafetyZone(id, change.entityId, change.data);
              case "agl": {
                const surface = airport.surfaces.find((s) =>
                  s.agls.some((a) => a.id === change.entityId),
                );
                if (surface) {
                  return updateAGL(id, surface.id, change.entityId, change.data);
                }
                return undefined;
              }
              case "lha": {
                const parentAgl = airport.surfaces
                  .flatMap((s) => s.agls.map((a) => ({ surface: s, agl: a })))
                  .find(({ agl }) => agl.lhas.some((l) => l.id === change.entityId));
                if (parentAgl) {
                  return updateLHA(id, parentAgl.surface.id, parentAgl.agl.id, change.entityId, change.data);
                }
                return undefined;
              }
              case "airport":
                return updateAirport(id, change.data);
              default:
                return undefined;
            }
          })
          .filter((p): p is NonNullable<typeof p> => p !== undefined),
      );
      clearAll();
      const freshAirport = await fetchAirport();

      // sync selected feature with fresh data so vertex editor uses updated geometry
      if (freshAirport && selectedFeature) {
        const ft = selectedFeature.type;
        const fid = selectedFeature.data.id;
        let freshData;
        if (ft === "surface") {
          freshData = freshAirport.surfaces.find((s) => s.id === fid);
        } else if (ft === "obstacle") {
          freshData = freshAirport.obstacles.find((o) => o.id === fid);
        } else if (ft === "safety_zone") {
          freshData = freshAirport.safety_zones.find((z) => z.id === fid);
        } else if (ft === "agl") {
          freshData = freshAirport.surfaces.flatMap((s) => s.agls).find((a) => a.id === fid);
        } else if (ft === "lha") {
          freshData = freshAirport.surfaces.flatMap((s) => s.agls.flatMap((a) => a.lhas)).find((l) => l.id === fid);
        }
        if (freshData) {
          setSelectedFeature({ type: ft, data: freshData } as MapFeature);
        } else {
          setSelectedFeature(null);
        }
      }

      // restore viewport after re-render
      if (viewport && mapInst) {
        requestAnimationFrame(() => {
          mapInst.jumpTo(viewport);
        });
      }
    } catch (err) {
      // surface the backend's reason (e.g. "sequence_number must be between
      // 1 and 3") instead of swallowing it; fall back to the generic banner.
      setSaveError(extractApiErrorMessage(err) ?? t("coordinator.detail.saveError"));
    } finally {
      setSaving(false);
    }
  }, [id, airport, getPendingChanges, clearAll, fetchAirport, selectedFeature, setSelectedFeature, getMap, t]);

  return {
    deleteError,
    saveError,
    saving,
    deleteAirportError,
    setDeleteAirportError,
    handleDeleteAirport,
    handleDeleteSurface,
    handleDeleteObstacle,
    handleDeleteSafetyZone,
    handleDeleteAgl,
    handleDeleteLha,
    handleFeatureDelete,
    handleSave,
  };
}
