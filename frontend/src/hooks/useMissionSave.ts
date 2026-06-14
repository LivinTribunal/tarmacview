import { useState, useEffect, useCallback } from "react";

import {
  getMission,
  updateMission,
  updateInspection,
} from "@/api/missions";
import type {
  InspectionConfigOverride,
  MissionDetailResponse,
  MissionUpdate,
} from "@/types/mission";
import type { SaveContext } from "@/components/Layout/MissionTabNav";
import { STATUS_ORDER } from "@/constants/mission";

interface UseMissionSaveParams {
  id: string | undefined;
  mission: MissionDetailResponse | null;
  inspectionDirty: Record<string, InspectionConfigOverride>;
  setInspectionDirty: React.Dispatch<
    React.SetStateAction<Record<string, InspectionConfigOverride>>
  >;
  updateMissionState: (
    fresh: MissionDetailResponse,
    previousStatus?: string,
  ) => void;
  lastSaved: Date | null;
  setLastSaved: React.Dispatch<React.SetStateAction<Date | null>>;
  setSaveContext: (ctx: SaveContext) => void;
  navigate: (path: string) => void;
  showNotification: (msg: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

interface MissionSaveReturn {
  missionDirty: Partial<MissionUpdate>;
  setMissionDirty: React.Dispatch<React.SetStateAction<Partial<MissionUpdate>>>;
  pendingNav: string | null;
  setPendingNav: React.Dispatch<React.SetStateAction<string | null>>;
  saving: boolean;
  isDirty: boolean;
  handleSave: () => Promise<void>;
  handleMissionChange: (update: Partial<MissionUpdate>) => void;
  confirmDiscard: () => void;
  handleEditWaypoints: () => void;
}

/** owns mission-level dirty state, save flow, discard, and the save-context wiring. */
export default function useMissionSave({
  id,
  mission,
  inspectionDirty,
  setInspectionDirty,
  updateMissionState,
  lastSaved,
  setLastSaved,
  setSaveContext,
  navigate,
  showNotification,
  t,
}: UseMissionSaveParams): MissionSaveReturn {
  const [saving, setSaving] = useState(false);

  // dirty tracking for mission-level changes
  const [missionDirty, setMissionDirty] = useState<Partial<MissionUpdate>>({});

  // unsaved changes dialog
  const [pendingNav, setPendingNav] = useState<string | null>(null);

  const isDirty =
    Object.keys(missionDirty).length > 0 ||
    Object.keys(inspectionDirty).length > 0;

  // handle save
  const handleSave = useCallback(async () => {
    if (!id || !mission) return;
    setSaving(true);
    const previousStatus = mission.status;

    try {
      // save mission-level changes
      if (Object.keys(missionDirty).length > 0) {
        await updateMission(id, missionDirty);
        setMissionDirty({});
      }

      // save inspection-level changes
      const failedInspections: Record<string, InspectionConfigOverride> = {};
      for (const [inspId, override] of Object.entries(inspectionDirty)) {
        try {
          await updateInspection(id, inspId, { config: override });
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          failedInspections[inspId] = override;
        }
      }
      setInspectionDirty(failedInspections);

      if (Object.keys(failedInspections).length > 0) {
        showNotification(t("mission.config.savePartialError"));
        // re-fetch so mission-level state is not stale after partial save
        const fresh = await getMission(id);
        updateMissionState(fresh, previousStatus);
        return;
      }

      // re-fetch mission after all saves to detect status regression
      const fresh = await getMission(id);
      updateMissionState(fresh, previousStatus);

      setLastSaved(new Date());

      // only show "saved" if no regression notification was already shown
      const oldIdx = STATUS_ORDER.indexOf(previousStatus);
      const newIdx = STATUS_ORDER.indexOf(fresh.status);
      if (newIdx >= oldIdx) {
        showNotification(t("mission.config.saved"));
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : t("mission.config.saveError");
      showNotification(msg);
    } finally {
      setSaving(false);
    }
  }, [id, mission, missionDirty, inspectionDirty, t, updateMissionState]);

  // wire up save context to tab nav
  useEffect(() => {
    setSaveContext({
      onSave: handleSave,
      isDirty,
      isSaving: saving,
      lastSaved,
    });

    return () => {
      setSaveContext({
        onSave: null,
        isDirty: false,
        isSaving: false,
        lastSaved: null,
      });
    };
  }, [setSaveContext, handleSave, isDirty, saving, lastSaved]);

  // unsaved changes on beforeunload
  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  function handleMissionChange(update: Partial<MissionUpdate>) {
    setMissionDirty((prev) => ({ ...prev, ...update }));
  }

  function handleEditWaypoints() {
    if (isDirty) {
      setPendingNav(`/operator-center/missions/${id}/map`);
    } else {
      navigate(`/operator-center/missions/${id}/map`);
    }
  }

  function confirmDiscard() {
    setMissionDirty({});
    setInspectionDirty({});
    if (pendingNav) {
      navigate(pendingNav);
      setPendingNav(null);
    }
  }

  return {
    missionDirty,
    setMissionDirty,
    pendingNav,
    setPendingNav,
    saving,
    isDirty,
    handleSave,
    handleMissionChange,
    confirmDiscard,
    handleEditWaypoints,
  };
}
