import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useNavigate, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { updateMission, duplicateMission, deleteMission } from "@/api/missions";
import type { MissionResponse } from "@/types/mission";
import { SLOW_NOTIFICATION_TIMEOUT_MS } from "@/constants/ui";

interface UseMissionTabActionsArgs {
  id: string | undefined;
  missions: MissionResponse[];
  refreshMissions: () => Promise<void>;
  compactLeftPanel: boolean;
}

/** mission selector dropdown/rename state plus duplicate/rename/delete/switch handlers. */
export function useMissionTabActions({
  id,
  missions,
  refreshMissions,
  compactLeftPanel,
}: UseMissionTabActionsArgs) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const [missionDropdownOpen, setMissionDropdownOpen] = useState(false);
  const [missionSearch, setMissionSearch] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const renameErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // compact pill selector refs + portal position
  const compactSelectorRef = useRef<HTMLDivElement>(null);
  const compactDropdownRef = useRef<HTMLDivElement>(null);
  const [compactDropdownPos, setCompactDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const currentMission = missions.find((m) => m.id === id);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const filteredMissions = useMemo(() => {
    /** filter missions by search query. */
    if (!missionSearch.trim()) return missions;
    const q = missionSearch.toLowerCase();
    return missions.filter((m) => m.name.toLowerCase().includes(q));
  }, [missions, missionSearch]);

  // close compact dropdown on outside click
  useEffect(() => {
    if (!compactLeftPanel || !missionDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      /** close compact dropdown on outside click. */
      const target = e.target as Node;
      if (compactSelectorRef.current?.contains(target)) return;
      if (compactDropdownRef.current?.contains(target)) return;
      setMissionDropdownOpen(false);
      setMissionSearch("");
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [compactLeftPanel, missionDropdownOpen]);

  /** toggle the mission selector dropdown. */
  const handleSelectorToggle = useCallback(() => {
    setMissionDropdownOpen((prev) => {
      if (prev) setMissionSearch("");
      return !prev;
    });
  }, []);

  function handleMissionSwitch(missionId: string) {
    /** switch to a different mission. */
    setMissionDropdownOpen(false);
    setMissionSearch("");
    const tabMatch = location.pathname.match(/\/missions\/[^/]+\/(.+)/);
    const tab = tabMatch?.[1] ?? "configuration";
    navigate(`/operator-center/missions/${missionId}/${tab}`);
  }

  function handleDeselect() {
    /** clear the mission selection and return to the missions list. */
    navigate("/operator-center/missions");
  }

  async function handleDuplicate() {
    /** duplicate the current mission and navigate to the copy. */
    if (!id) return;
    try {
      const copy = await duplicateMission(id);
      await refreshMissions();
      const tabMatch = location.pathname.match(/\/missions\/[^/]+\/(.+)/);
      const tab = tabMatch?.[1] ?? "configuration";
      navigate(`/operator-center/missions/${copy.id}/${tab}`);
    } catch (err) {
      console.error("duplicate failed", err instanceof Error ? err.message : String(err));
    }
  }

  function startRename() {
    /** enter inline rename mode seeded with the current mission name. */
    setRenaming(true);
    setRenameValue(currentMission?.name ?? "");
  }

  async function confirmRename() {
    /** persist the renamed mission, surfacing a transient error on failure. */
    if (!id || !renameValue.trim()) {
      setRenaming(false);
      return;
    }
    try {
      await updateMission(id, { name: renameValue.trim() });
      await refreshMissions();
    } catch (e) {
      console.error("rename failed", e instanceof Error ? e.message : String(e));
      setRenameError(t("mission.renameError"));
      if (renameErrorTimer.current) clearTimeout(renameErrorTimer.current);
      renameErrorTimer.current = setTimeout(() => setRenameError(null), SLOW_NOTIFICATION_TIMEOUT_MS);
    }
    setRenaming(false);
  }

  async function handleDeleteMission() {
    /** delete the current mission after confirmation. */
    if (!id) return;
    try {
      await deleteMission(id);
      setShowDeleteDialog(false);
      navigate("/operator-center/missions");
      refreshMissions().catch((err) =>
        console.error("refresh after delete failed", err instanceof Error ? err.message : String(err)),
      );
    } catch (err) {
      console.error("delete failed", err instanceof Error ? err.message : String(err));
    }
  }

  function toggleCompactDropdown() {
    /** open/close the compact selector dropdown, anchoring it to the pill. */
    setMissionDropdownOpen(!missionDropdownOpen);
    if (!missionDropdownOpen && compactSelectorRef.current) {
      const rect = compactSelectorRef.current.getBoundingClientRect();
      setCompactDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }

  return {
    missionDropdownOpen,
    missionSearch,
    setMissionSearch,
    renameError,
    showDeleteDialog,
    setShowDeleteDialog,
    renaming,
    renameValue,
    setRenameValue,
    compactSelectorRef,
    compactDropdownRef,
    compactDropdownPos,
    currentMission,
    filteredMissions,
    handleSelectorToggle,
    handleMissionSwitch,
    handleDeselect,
    handleDuplicate,
    startRename,
    confirmRename,
    handleDeleteMission,
    toggleCompactDropdown,
  };
}
