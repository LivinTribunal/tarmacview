import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import RowActionButtons from "@/components/common/RowActionButtons";
import { SortableHeader } from "@/components/common/ListPageLayout";
import type { SortDir } from "@/components/common/useListSort";
import type { MeasurementSortKey } from "@/hooks/useMeasurementList";
import type { MeasurementListItem } from "@/types/measurement";
import { formatDate } from "@/utils/format";
import MeasurementStatusChip from "./MeasurementStatusChip";

interface MeasurementListTableProps {
  rows: MeasurementListItem[];
  totalRows: number;
  loading: boolean;
  error: boolean;
  sortKey: MeasurementSortKey;
  sortDir: SortDir;
  onSort: (key: MeasurementSortKey) => void;
  onRowClick: (row: MeasurementListItem) => void;
  onRename: (row: MeasurementListItem) => void;
  onDelete: (row: MeasurementListItem) => void;
  onRetry: () => void;
}

/** the run's display name - the operator label when set, else the inspection label. */
export function measurementDisplayName(
  row: Pick<
    MeasurementListItem,
    "label" | "inspection_sequence_order" | "inspection_method"
  >,
  t: TFunction,
): string {
  return (
    row.label ||
    t("measurementsList.inspectionLabel", {
      order: row.inspection_sequence_order,
      method: t(`map.inspectionMethod.${row.inspection_method}`, row.inspection_method),
    })
  );
}

/** measurements list table with sort, click-through, and the PASS/FAIL rollup. */
export default function MeasurementListTable({
  rows,
  totalRows,
  loading,
  error,
  sortKey,
  sortDir,
  onSort,
  onRowClick,
  onRename,
  onDelete,
  onRetry,
}: MeasurementListTableProps) {
  const { t } = useTranslation();

  const columns: { key: MeasurementSortKey; label: string }[] = [
    { key: "mission", label: t("measurementsList.columns.mission") },
    { key: "inspection", label: t("measurementsList.columns.inspection") },
    { key: "status", label: t("measurementsList.columns.status") },
    { key: "created_at", label: t("measurementsList.columns.date") },
    { key: "result", label: t("measurementsList.columns.result") },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-tv-text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-16 text-center text-sm text-tv-error">
        {t("measurementsList.loadError")}
        <button
          type="button"
          onClick={onRetry}
          className="ml-2 underline hover:no-underline"
        >
          {t("measurementsList.retry")}
        </button>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        className="px-6 py-16 text-center text-sm text-tv-text-muted"
        data-testid="measurements-empty"
      >
        {totalRows === 0
          ? t("measurementsList.empty")
          : t("measurementsList.noMatch")}
      </div>
    );
  }

  return (
    <table className="w-full" data-testid="measurements-table">
      <thead>
        <tr className="border-b border-tv-border">
          {columns.map((col) => (
            <SortableHeader
              key={col.key}
              sortKey={col.key}
              currentSort={sortKey}
              currentDir={sortDir}
              onSort={onSort}
            >
              {col.label}
            </SortableHeader>
          ))}
          <th className="w-10" aria-label={t("common.actions")} />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const total = row.pass_count + row.fail_count;
          return (
            <tr
              key={row.id}
              onClick={() => onRowClick(row)}
              className="border-b border-tv-border last:border-b-0 cursor-pointer
                text-sm text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
              data-testid={`measurement-row-${row.id}`}
            >
              <td className="px-4 py-3 font-medium">{row.mission_name}</td>
              <td className="px-4 py-3 text-tv-text-secondary">
                {measurementDisplayName(row, t)}
              </td>
              <td className="px-4 py-3">
                <MeasurementStatusChip status={row.status} />
              </td>
              <td className="px-4 py-3 text-tv-text-secondary">
                {row.created_at ? formatDate(row.created_at) : "—"}
              </td>
              <td className="px-4 py-3">
                {row.status === "DONE" ? (
                  <span className="text-tv-text-primary font-medium">
                    {row.pass_count}/{total}
                  </span>
                ) : row.status === "ERROR" && row.error_message ? (
                  <span
                    className="text-xs text-tv-error"
                    data-testid={`error-${row.id}`}
                  >
                    {row.error_message}
                  </span>
                ) : (
                  <span className="text-tv-text-muted">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <RowActionButtons
                  actions={[
                    {
                      icon: Pencil,
                      onClick: () => onRename(row),
                      title: t("measurementsList.actions.rename"),
                    },
                    {
                      icon: Trash2,
                      onClick: () => onDelete(row),
                      title: t("measurementsList.actions.delete"),
                      variant: "danger",
                    },
                  ]}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
