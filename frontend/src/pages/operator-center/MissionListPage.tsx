import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useAirport } from "@/contexts/AirportContext";
import Button from "@/components/common/Button";
import Modal from "@/components/common/Modal";
import RenameModal from "@/components/common/RenameModal";
import {
  ListPageContainer,
  ListPageContent,
  Pagination,
  SearchBar,
} from "@/components/common/ListPageLayout";
import CreateMissionDialog from "@/components/mission/CreateMissionDialog";
import MissionListTable from "@/components/mission/MissionListTable";
import useMissionList from "@/hooks/useMissionList";
import type { MissionResponse } from "@/types/mission";

/** full-width mission list page shown when no mission is selected. */
export default function MissionListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { selectedAirport } = useAirport();

  const list = useMissionList({ airportId: selectedAirport?.id });

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MissionResponse | null>(null);
  const [renameTarget, setRenameTarget] = useState<MissionResponse | null>(null);
  const [renameValue, setRenameValue] = useState("");

  if (!selectedAirport) {
    return (
      <div className="flex items-center justify-center h-full bg-tv-bg">
        <p className="text-sm text-tv-text-muted">{t("nav.selectAirport")}</p>
      </div>
    );
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    await list.handleDelete(deleteTarget);
    setDeleteTarget(null);
  }

  async function handleRenameConfirm() {
    if (!renameTarget) return;
    if (!renameValue.trim()) {
      setRenameTarget(null);
      return;
    }
    await list.handleRename(renameTarget, renameValue);
    setRenameTarget(null);
  }


  return (
    <ListPageContainer>
      <SearchBar
        value={list.search}
        onChange={list.handleSearchChange}
        placeholder={t("missionList.searchPlaceholder")}
        testId="mission-list-search"
      >
        <Button
          onClick={() => setShowCreateDialog(true)}
          data-testid="new-mission-btn"
        >
          {t("missionList.newMission")}
        </Button>
      </SearchBar>

      <ListPageContent className="mb-4">{list.filterBar}</ListPageContent>

      <ListPageContent>
        <div className="rounded-2xl border border-tv-border bg-tv-surface overflow-hidden">
          <MissionListTable
            rows={list.paged}
            totalMissions={list.missions.length}
            loading={list.loading}
            error={list.error}
            droneMap={list.droneMap}
            sortKey={list.sortKey}
            sortDir={list.sortDir}
            onSort={list.handleSort}
            onRowClick={(mission) =>
              navigate(`/operator-center/missions/${mission.id}/overview`)
            }
            onDuplicate={(mission) => list.handleDuplicate(mission)}
            onRename={(mission) => {
              setRenameTarget(mission);
              setRenameValue(mission.name);
            }}
            onDelete={setDeleteTarget}
            onRetry={list.fetchMissions}
          />
        </div>
      </ListPageContent>

      {!list.loading && !list.error && list.sorted.length > 0 && (
        <Pagination
          page={list.page}
          pageSize={list.pageSize}
          totalItems={list.sorted.length}
          onPageChange={list.setPage}
          onPageSizeChange={list.handlePageSizeChange}
          showingKey="missionList.showing"
        />
      )}

      <CreateMissionDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        airportId={selectedAirport.id}
      />

      <Modal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t("common.delete")}
      >
        <p className="text-sm text-tv-text-primary mb-6">
          {t("missionList.deleteConfirm", { name: deleteTarget?.name })}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={handleDeleteConfirm}>
            {t("common.delete")}
          </Button>
        </div>
      </Modal>

      <RenameModal
        isOpen={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title={t("missionList.renameTitle")}
        value={renameValue}
        onChange={setRenameValue}
        onSubmit={handleRenameConfirm}
        placeholder={t("missionList.renamePlaceholder")}
        inputId="rename-input"
        inputTestId="rename-input"
        submitDisabledWhenEmpty
      />
    </ListPageContainer>
  );
}
