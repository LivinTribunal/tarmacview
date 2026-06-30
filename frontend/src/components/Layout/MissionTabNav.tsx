import { useState, useCallback } from "react";
import { Outlet, useParams, useNavigate, useOutletContext } from "react-router";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, Copy, X, Trash2 } from "lucide-react";
import { useMission } from "@/contexts/MissionContext";
import type { MissionRouteOutletContext } from "@/components/Auth/RequireMissionAirportMatch";
import type { MissionResponse, MissionDetailResponse } from "@/types/mission";
import Badge from "@/components/common/Badge";
import DetailSelector from "@/components/common/DetailSelector";
import DetailSelectorItem from "@/components/common/DetailSelectorItem";
import type { MissionStatus } from "@/types/enums";
import { useMissionTabActions } from "@/hooks/useMissionTabActions";
import MissionDeleteDialog from "./MissionDeleteDialog";
import CompactMissionSelector from "./CompactMissionSelector";
import MissionActionBar from "./MissionActionBar";

export interface SaveContext {
  onSave: (() => void) | null;
  isDirty: boolean;
  isSaving: boolean;
  lastSaved: Date | null;
}

export interface ComputeContext {
  onCompute: (() => void) | null;
  canCompute: boolean;
  isComputing: boolean;
  label?: string;
  tooltip?: string;
  variant?: "primary" | "secondary";
  icon?: "upload" | "file";
}

export interface MissionTabOutletContext {
  setSaveContext: (ctx: SaveContext) => void;
  setComputeContext: (ctx: ComputeContext) => void;
  refreshMissions: () => Promise<void>;
  mission: MissionDetailResponse | null;
  updateMissionFromPage: (m: MissionResponse) => void;
  leftPanelEl: HTMLDivElement | null;
  setCompactLeftPanel: (compact: boolean) => void;
}

/** mission workspace shell - selector, tab nav, save/compute bar, and outlet. */
export default function MissionTabNav() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    missions,
    refreshMissions,
    updateMissionInList,
  } = useMission();

  // mission fetched once by the route guard - forwarded so child pages
  // don't have to re-fetch on initial mount. nullable for tests that mount
  // this component without a parent Outlet.
  const routeMission =
    (useOutletContext<MissionRouteOutletContext | null>() ?? null)?.mission ??
    null;

  const [saveCtx, setSaveCtx] = useState<SaveContext>({
    onSave: null,
    isDirty: false,
    isSaving: false,
    lastSaved: null,
  });
  const [computeCtx, setComputeCtx] = useState<ComputeContext>({
    onCompute: null,
    canCompute: false,
    isComputing: false,
  });

  // portal target for page left panel content
  const [leftPanelEl, setLeftPanelEl] = useState<HTMLDivElement | null>(null);
  const [compactLeftPanel, setCompactLeftPanelState] = useState(false);

  const setCompactLeftPanel = useCallback((compact: boolean) => {
    setCompactLeftPanelState(compact);
  }, []);

  const setSaveContext = useCallback((ctx: SaveContext) => {
    setSaveCtx(ctx);
  }, []);

  const setComputeContext = useCallback((ctx: ComputeContext) => {
    setComputeCtx(ctx);
  }, []);

  // update mission in context when a page pushes a status change
  const updateMissionFromPage = useCallback(
    (updated: MissionResponse) => {
      updateMissionInList(updated);
    },
    [updateMissionInList],
  );

  const {
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
  } = useMissionTabActions({ id, missions, refreshMissions, compactLeftPanel });

  const missionSelectorBlock = (
    <DetailSelector
      title={t("mission.label")}
      count={missions.length}
      actions={[
        { icon: Plus, onClick: () => navigate("/operator-center/missions"), title: t("mission.createNew"), variant: "accent" },
        { icon: Copy, onClick: handleDuplicate, title: t("mission.duplicate") },
        { icon: Pencil, onClick: startRename, title: t("common.edit") },
        { icon: Trash2, onClick: () => setShowDeleteDialog(true), title: t("common.delete"), variant: "danger" as const },
        { icon: X, onClick: handleDeselect, title: t("common.close") },
      ]}
      renderSelected={() => (
        <>
          <span className="flex-1 min-w-0 truncate text-sm font-medium text-tv-text-primary">
            {currentMission?.name ?? t("mission.config.selectMission")}
          </span>
          {currentMission && (
            <Badge status={currentMission.status as MissionStatus} className="flex-shrink-0" />
          )}
        </>
      )}
      isOpen={missionDropdownOpen}
      onToggle={handleSelectorToggle}
      isRenaming={renaming}
      renameValue={renameValue}
      onRenameChange={setRenameValue}
      onRenameFinish={confirmRename}
      searchValue={missionSearch}
      onSearchChange={setMissionSearch}
      searchPlaceholder={t("mission.config.searchMissions")}
      noResultsText={t("common.noResults")}
      usePortal
      renderDropdownItems={() =>
        filteredMissions.length === 0 ? null : filteredMissions.map((m) => (
          <DetailSelectorItem
            key={m.id}
            isSelected={m.id === id}
            onClick={() => handleMissionSwitch(m.id)}
          >
            <div className="flex items-center justify-between">
              <span className="truncate text-sm">{m.name}</span>
              <Badge
                status={m.status as MissionStatus}
                className="ml-2 flex-shrink-0"
              />
            </div>
          </DetailSelectorItem>
        ))
      }
    />
  );

  const outletContext = {
    setSaveContext,
    setComputeContext,
    refreshMissions,
    mission: routeMission,
    updateMissionFromPage,
    leftPanelEl,
    setCompactLeftPanel,
  } satisfies MissionTabOutletContext;

  // compact mode: stacked layout - full-width tab bar row above full-width content (like original main)
  if (compactLeftPanel) {
    return (
      <div className="flex flex-col h-[calc(100vh-5.25rem)]">
        {/* full-width tab bar row */}
        <div className="flex items-center px-4 py-2 flex-shrink-0">
          {/* pill selector - 30% */}
          <CompactMissionSelector
            compactSelectorRef={compactSelectorRef}
            compactDropdownRef={compactDropdownRef}
            currentMission={currentMission}
            selectedId={id}
            filteredMissions={filteredMissions}
            missionDropdownOpen={missionDropdownOpen}
            missionSearch={missionSearch}
            compactDropdownPos={compactDropdownPos}
            onActivate={() => {
              if (!renaming) toggleCompactDropdown();
            }}
            onToggleDropdown={toggleCompactDropdown}
            onDuplicate={handleDuplicate}
            onDeselect={handleDeselect}
            onSearchChange={setMissionSearch}
            onMissionSwitch={handleMissionSwitch}
          />

          {/* tabs + buttons */}
          <MissionActionBar missionId={id} saveCtx={saveCtx} computeCtx={computeCtx} />
        </div>

        {renameError && (
          <div className="mx-4 mb-2 rounded-xl bg-red-500/20 border border-red-500/40 px-4 py-2 text-sm text-red-400">
            {renameError}
          </div>
        )}

        {/* full-width content */}
        <div className="flex-1 min-h-0 pb-2">
          <Outlet context={outletContext} />
        </div>

        <MissionDeleteDialog
          isOpen={showDeleteDialog}
          onClose={() => setShowDeleteDialog(false)}
          onConfirm={handleDeleteMission}
        />
      </div>
    );
  }

  // normal mode: two-column layout
  return (
    <div className="flex h-[calc(100vh-5.25rem)] px-4 pt-2">
      {/* left column */}
      <div className="w-[30%] flex-shrink-0 flex">
        <div className="flex-1 flex flex-col overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
          <div className="flex-shrink-0">
            {missionSelectorBlock}
          </div>

          {renameError && (
            <div className="mt-2 rounded-xl bg-red-500/20 border border-red-500/40 px-4 py-2 text-sm text-red-400">
              {renameError}
            </div>
          )}

          <div
            ref={setLeftPanelEl}
            className="flex flex-col gap-4 pt-4 pb-2"
          />
        </div>
        <div className="w-6 flex-shrink-0" />
      </div>

      {/* right column */}
      <div className="flex-1 flex flex-col min-w-0 pb-2">
        <div className="flex items-center gap-4 flex-shrink-0 pb-3">
          <MissionActionBar missionId={id} saveCtx={saveCtx} computeCtx={computeCtx} />
        </div>

        <div className="flex-1 min-h-0">
          <Outlet context={outletContext} />
        </div>
      </div>

      <MissionDeleteDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDeleteMission}
      />
    </div>
  );
}
