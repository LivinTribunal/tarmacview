import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useAirport } from "@/contexts/AirportContext";
import {
  ListPageContainer,
  ListPageContent,
  Pagination,
  SearchBar,
} from "@/components/common/ListPageLayout";
import MeasurementListTable from "@/components/results/MeasurementListTable";
import MeasurementFlowDialog from "@/components/mission/MeasurementFlowDialog";
import useMeasurementList from "@/hooks/useMeasurementList";
import type { MeasurementListItem } from "@/types/measurement";

/** a measurement to resume in the flow dialog (confirm-later / watch progress). */
interface ResumeTarget {
  measurementId: string;
  inspectionId: string;
  label: string;
}

const ACTIVE_STATUSES: MeasurementListItem["status"][] = [
  "QUEUED",
  "FIRST_FRAME",
  "PROCESSING",
];

/** airport-scoped measurements list - the results entry point for the operator. */
export default function MeasurementsListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { selectedAirport } = useAirport();

  const list = useMeasurementList({ airportId: selectedAirport?.id });
  const [resumeTarget, setResumeTarget] = useState<ResumeTarget | null>(null);

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

  // route each row by its phase: done -> results, awaiting/active -> flow dialog,
  // error rows surface their message inline and are not actionable.
  function handleRowClick(row: MeasurementListItem) {
    if (row.status === "DONE") {
      navigate(`/operator-center/measurements/${row.id}/results`);
      return;
    }
    if (row.status === "AWAITING_CONFIRM" || ACTIVE_STATUSES.includes(row.status)) {
      setResumeTarget({
        measurementId: row.id,
        inspectionId: row.inspection_id,
        label: rowLabel(row),
      });
    }
  }

  // resuming an AWAITING_CONFIRM run may finish it; refresh on close
  function handleResumeClose() {
    setResumeTarget(null);
    list.fetchRows();
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

      {resumeTarget && (
        <MeasurementFlowDialog
          inspectionId={resumeTarget.inspectionId}
          inspectionLabel={resumeTarget.label}
          resumeMeasurementId={resumeTarget.measurementId}
          onClose={handleResumeClose}
        />
      )}
    </ListPageContainer>
  );
}
