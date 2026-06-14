import { useState, useRef, useCallback } from "react";

import { isAxiosError } from "@/api/client";
import {
  getMission,
  addInspection,
  updateInspection,
  removeInspection,
  reorderInspections,
} from "@/api/missions";
import type {
  InspectionConfigOverride,
  LhaSelectionRules,
  MissionDetailResponse,
} from "@/types/mission";
import type { InspectionTemplateResponse } from "@/types/inspectionTemplate";
import type { AGLResponse } from "@/types/airport";
import type { InspectionMethod } from "@/types/enums";
import { STATUS_ORDER } from "@/constants/mission";

interface UseInspectionEditingParams {
  id: string | undefined;
  mission: MissionDetailResponse | null;
  templateMap: Map<string, InspectionTemplateResponse>;
  allAgls: AGLResponse[];
  selectedInspectionId: string | null;
  setSelectedInspectionId: React.Dispatch<React.SetStateAction<string | null>>;
  setVisibleInspectionIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  updateMissionState: (
    fresh: MissionDetailResponse,
    previousStatus?: string,
  ) => void;
  setLastSaved: React.Dispatch<React.SetStateAction<Date | null>>;
  showNotification: (msg: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

interface InspectionEditingReturn {
  inspectionDirty: Record<string, InspectionConfigOverride>;
  setInspectionDirty: React.Dispatch<
    React.SetStateAction<Record<string, InspectionConfigOverride>>
  >;
  inspectionDirtyRef: React.MutableRefObject<
    Record<string, InspectionConfigOverride>
  >;
  selectedLhas: Record<string, Set<string>>;
  lhaRules: Record<string, LhaSelectionRules>;
  restoreLhaSelectionsFromMission: (missionData: MissionDetailResponse) => void;
  handleInspectionConfigChange: (override: InspectionConfigOverride) => void;
  handleToggleLha: (inspId: string, lhaId: string) => void;
  handleSelectionForAglChange: (
    inspId: string,
    aglId: string,
    nextForAgl: Set<string>,
  ) => void;
  handleLhaRulesChange: (inspId: string, rules: LhaSelectionRules) => void;
  handleAddInspection: (
    templateId: string,
    method: InspectionMethod,
  ) => Promise<void>;
  handleChangeMethod: (
    inspId: string,
    method: InspectionMethod,
  ) => Promise<void>;
  handleRemoveInspection: (inspId: string) => Promise<void>;
  handleReorder: (ids: string[]) => Promise<void>;
}

/** owns inspection-level dirty config, lha selection, and the inspection crud handlers. */
export default function useInspectionEditing({
  id,
  mission,
  templateMap,
  allAgls,
  selectedInspectionId,
  setSelectedInspectionId,
  setVisibleInspectionIds,
  updateMissionState,
  setLastSaved,
  showNotification,
  t,
}: UseInspectionEditingParams): InspectionEditingReturn {
  // lha selection per inspection
  const [selectedLhas, setSelectedLhas] = useState<Record<string, Set<string>>>(
    {},
  );
  // per-inspection lha-selection rules (mode + params), keyed [inspectionId][aglId]
  const [lhaRules, setLhaRules] = useState<Record<string, LhaSelectionRules>>(
    {},
  );

  // dirty tracking for inspection-level config overrides
  const [inspectionDirty, setInspectionDirty] = useState<
    Record<string, InspectionConfigOverride>
  >({});

  const inspectionDirtyRef = useRef(inspectionDirty);
  inspectionDirtyRef.current = inspectionDirty;

  // restore LHA selections - prefer dirty (unsaved) over backend
  const restoreLhaSelectionsFromMission = useCallback(
    (missionData: MissionDetailResponse) => {
      const lhaInit: Record<string, Set<string>> = {};
      const rulesInit: Record<string, LhaSelectionRules> = {};
      const currentDirty = inspectionDirtyRef.current;
      for (const insp of missionData.inspections) {
        const dirtyIds = currentDirty[insp.id]?.lha_ids;
        if (dirtyIds && dirtyIds.length > 0) {
          lhaInit[insp.id] = new Set(dirtyIds);
        } else if (insp.lha_ids && insp.lha_ids.length > 0) {
          lhaInit[insp.id] = new Set(insp.lha_ids);
        }
        const dirtyRules = currentDirty[insp.id]?.lha_selection_rules;
        if (dirtyRules) {
          rulesInit[insp.id] = dirtyRules;
        } else if (insp.config?.lha_selection_rules) {
          rulesInit[insp.id] = insp.config.lha_selection_rules;
        }
      }
      setSelectedLhas((prev) => ({ ...prev, ...lhaInit }));
      setLhaRules((prev) => ({ ...prev, ...rulesInit }));
    },
    [],
  );

  function handleInspectionConfigChange(override: InspectionConfigOverride) {
    if (!selectedInspectionId) return;
    setInspectionDirty((prev) => ({
      ...prev,
      [selectedInspectionId]: override,
    }));
  }

  function handleToggleLha(inspId: string, lhaId: string) {
    setSelectedLhas((prev) => {
      const current = prev[inspId] ?? new Set();
      const next = new Set(current);
      if (next.has(lhaId)) {
        next.delete(lhaId);
      } else {
        next.add(lhaId);
      }

      // persist lha_ids into inspectionDirty so they get sent to backend
      setInspectionDirty((prevDirty) => ({
        ...prevDirty,
        [inspId]: {
          ...(prevDirty[inspId] ?? {}),
          lha_ids: Array.from(next),
        },
      }));

      return { ...prev, [inspId]: next };
    });
  }

  function handleSelectionForAglChange(
    inspId: string,
    aglId: string,
    nextForAgl: Set<string>,
  ) {
    setSelectedLhas((prev) => {
      const current = prev[inspId] ?? new Set();
      // strip any ids that belong to this AGL, then union the new set
      const aglLhaIds = new Set(
        allAgls.find((a) => a.id === aglId)?.lhas.map((l) => l.id) ?? [],
      );
      const merged = new Set<string>();
      for (const id of current) {
        if (!aglLhaIds.has(id)) merged.add(id);
      }
      for (const id of nextForAgl) merged.add(id);

      setInspectionDirty((prevDirty) => ({
        ...prevDirty,
        [inspId]: {
          ...(prevDirty[inspId] ?? {}),
          lha_ids: Array.from(merged),
        },
      }));

      return { ...prev, [inspId]: merged };
    });
  }

  function handleLhaRulesChange(inspId: string, rules: LhaSelectionRules) {
    setLhaRules((prev) => ({ ...prev, [inspId]: rules }));
    setInspectionDirty((prevDirty) => ({
      ...prevDirty,
      [inspId]: {
        ...(prevDirty[inspId] ?? {}),
        lha_selection_rules: rules,
      },
    }));
  }

  async function handleAddInspection(
    templateId: string,
    method: InspectionMethod,
  ) {
    if (!id || !mission) return;
    const previousStatus = mission.status;
    try {
      await addInspection(id, { template_id: templateId, method });
      const fresh = await getMission(id);
      updateMissionState(fresh, previousStatus);
      setVisibleInspectionIds(new Set(fresh.inspections.map((i) => i.id)));

      // default all LHAs from template targets as selected for the new inspection
      const template = templateMap.get(templateId);
      if (template) {
        const allLhaIds = allAgls.flatMap((agl) =>
          template.target_agl_ids.includes(agl.id)
            ? agl.lhas.map((lha) => lha.id)
            : [],
        );

        // find the newly added inspection (highest sequence_order)
        const newInsp = fresh.inspections.reduce((a, b) =>
          a.sequence_order > b.sequence_order ? a : b,
        );
        if (allLhaIds.length > 0) {
          // persist lha_ids to backend immediately
          try {
            await updateInspection(id, newInsp.id, { config: { lha_ids: allLhaIds } });
          } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            showNotification(t("mission.config.lhaSaveError"));
          }
          setSelectedLhas((prev) => ({
            ...prev,
            [newInsp.id]: new Set(allLhaIds),
          }));
        }
      }

      setLastSaved(new Date());
      showNotification(t("mission.config.saved"));
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 409) {
        showNotification(t("mission.config.domainError"));
      } else {
        showNotification(t("mission.config.addError"));
      }
    }
  }

  async function handleChangeMethod(
    inspId: string,
    method: InspectionMethod,
  ) {
    if (!id || !mission) return;
    const previousStatus = mission.status;
    try {
      await updateInspection(id, inspId, { method });
      const fresh = await getMission(id);
      updateMissionState(fresh, previousStatus);
      setLastSaved(new Date());
      showNotification(t("mission.config.saved"));
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 409) {
        showNotification(t("mission.config.domainError"));
      } else {
        showNotification(t("mission.config.saveError"));
      }
    }
  }

  async function handleRemoveInspection(inspId: string) {
    if (!id || !mission) return;
    const previousStatus = mission.status;
    try {
      await removeInspection(id, inspId);
      if (selectedInspectionId === inspId) setSelectedInspectionId(null);
      // clear any pending dirty state for the removed inspection
      setInspectionDirty((prev) => {
        const next = { ...prev };
        delete next[inspId];
        return next;
      });
      const fresh = await getMission(id);
      updateMissionState(fresh, previousStatus);
      setLastSaved(new Date());
      showNotification(t("mission.config.saved"));
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 409) {
        showNotification(t("mission.config.domainError"));
      } else {
        showNotification(t("mission.config.removeError"));
      }
    }
  }

  async function handleReorder(ids: string[]) {
    if (!id || !mission) return;
    const previousStatus = mission.status;
    try {
      await reorderInspections(id, { inspection_ids: ids });
      const fresh = await getMission(id);
      updateMissionState(fresh, previousStatus);
      setLastSaved(new Date());

      const oldIdx = STATUS_ORDER.indexOf(previousStatus);
      const newIdx = STATUS_ORDER.indexOf(fresh.status);
      if (newIdx >= oldIdx) {
        showNotification(t("mission.config.saved"));
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      showNotification(t("mission.config.saveError"));
    }
  }

  return {
    inspectionDirty,
    setInspectionDirty,
    inspectionDirtyRef,
    selectedLhas,
    lhaRules,
    restoreLhaSelectionsFromMission,
    handleInspectionConfigChange,
    handleToggleLha,
    handleSelectionForAglChange,
    handleLhaRulesChange,
    handleAddInspection,
    handleChangeMethod,
    handleRemoveInspection,
    handleReorder,
  };
}
