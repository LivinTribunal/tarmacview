import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
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
import MeasurementListTable, {
  measurementDisplayName,
} from "@/components/results/MeasurementListTable";
import MeasurementFlowDialog from "@/components/mission/MeasurementFlowDialog";
import useMeasurementList from "@/hooks/useMeasurementList";
import type { MeasurementListItem } from "@/types/measurement";

/** a measurement opened for PAPI-box review in the flow dialog. */
interface ReviewTarget {
  measurementId: string;
  label: string;
}

/** airport-scoped measurements list - the results entry point for the operator. */
export default function MeasurementsListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { selectedAirport } = useAirport();

  const list = useMeasurementList({ airportId: selectedAirport?.id });
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MeasurementListItem | null>(null);
  const [renameTarget, setRenameTarget] = useState<MeasurementListItem | null>(null);
  const [renameValue, setRenameValue] = useState("");

  if (!selectedAirport) {
    return (
      <div
        className="flex items-center justify-center h-full bg-tv-bg"
        data-testid="measurements-no-airport"
      >
        <p className="text-sm text-tv-text-muted">{t("nav.selectAirport")}</p>
      </div>
    );
  }

  function rowLabel(row: MeasurementListItem): string {
    return t("measurementsList.inspectionLabel", {
      order: row.inspection_sequence_order,
      method: t(`map.inspectionMethod.${row.inspection_method}`, row.inspection_method),
    });
  }

  // route each row by its phase: done -> results, awaiting -> review modal.
  // active rows are inert (the corner progress toast tracks them); error rows
  // surface their message inline.
  function handleRowClick(row: MeasurementListItem) {
    if (row.status === "DONE") {
      navigate(`/operator-center/measurements/${row.id}/results`);
      return;
    }
    if (row.status === "AWAITING_CONFIRM") {
      setReviewTarget({ measurementId: row.id, label: rowLabel(row) });
    }
  }

  // confirming a run sends it back to processing; refresh so the list reflects it
  function handleReviewClose() {
    setReviewTarget(null);
    list.fetchRows();
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    await list.handleDelete(deleteTarget);
    setDeleteTarget(null);
  }

  // a blank label is valid - it clears the run name back to the inspection fallback
  async function handleRenameConfirm() {
    if (!renameTarget) return;
    await list.handleRename(renameTarget, renameValue);
    setRenameTarget(null);
  }

  return (
    <ListPageContainer>
      <SearchBar
        value={list.search}
        onChange={list.handleSearchChange}
        placeholder={t("measurementsList.searchPlaceholder")}
        testId="measurements-search"
      />

      <ListPageContent className="mb-4">{list.filterBar}</ListPageContent>

      <ListPageContent>
        <div className="rounded-2xl border border-tv-border bg-tv-surface overflow-hidden">
          <MeasurementListTable
            rows={list.paged}
            totalRows={list.rows.length}
            loading={list.loading}
            error={list.error}
            sortKey={list.sortKey}
            sortDir={list.sortDir}
            onSort={list.handleSort}
            onRowClick={handleRowClick}
            onRename={(row) => {
              setRenameTarget(row);
              setRenameValue(row.label ?? "");
            }}
            onDelete={setDeleteTarget}
            onRetry={list.fetchRows}
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
          showingKey="measurementsList.showing"
        />
      )}

      {reviewTarget && (
        <MeasurementFlowDialog
          measurementId={reviewTarget.measurementId}
          inspectionLabel={reviewTarget.label}
          onClose={handleReviewClose}
        />
      )}

      <Modal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t("common.delete")}
      >
        <p className="text-sm text-tv-text-primary mb-6">
          {t("measurementsList.deleteConfirm", {
            name: deleteTarget ? measurementDisplayName(deleteTarget, t) : "",
          })}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={handleDeleteConfirm}
            data-testid="confirm-delete-measurement"
          >
            {t("common.delete")}
          </Button>
        </div>
      </Modal>

      <RenameModal
        isOpen={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title={t("measurementsList.renameTitle")}
        value={renameValue}
        onChange={setRenameValue}
        onSubmit={handleRenameConfirm}
        placeholder={t("measurementsList.renamePlaceholder")}
        inputId="measurement-rename-input"
        inputTestId="measurement-rename-input"
        submitTestId="confirm-rename-measurement"
      />
    </ListPageContainer>
  );
}
