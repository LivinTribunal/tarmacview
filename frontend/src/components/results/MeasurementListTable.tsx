import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ChevronDown, ChevronRight, Loader2, Pencil, Trash2 } from "lucide-react";
import RowActionButtons from "@/components/common/RowActionButtons";
import { SortableHeader } from "@/components/common/ListPageLayout";
import type { SortDir } from "@/components/common/useListSort";
import type {
  MeasurementGroup,
  MeasurementSortKey,
} from "@/hooks/useMeasurementList";
import type { MeasurementListItem } from "@/types/measurement";
import { formatDate } from "@/utils/format";
import MeasurementStatusChip from "./MeasurementStatusChip";

interface MeasurementListTableProps {
  groups: MeasurementGroup[];
  totalRows: number;
  loading: boolean;
  error: boolean;
  sortKey: MeasurementSortKey;
  sortDir: SortDir;
  expandedGroups: Set<string>;
  onSort: (key: MeasurementSortKey) => void;
  onToggleExpand: (groupId: string) => void;
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

/** the result cell - PASS/FAIL rollup, error message, or a dash by status. */
function resultCell(row: MeasurementListItem) {
  const total = row.pass_count + row.fail_count;
  if (row.status === "DONE") {
    return (
      <span className="text-tv-text-primary font-medium">
        {row.pass_count}/{total}
      </span>
    );
  }
  if (row.status === "ERROR" && row.error_message) {
    return (
      <span className="text-xs text-tv-error" data-testid={`error-${row.id}`}>
        {row.error_message}
      </span>
    );
  }
  return <span className="text-tv-text-muted">—</span>;
}

/** row-action buttons (rename / delete) shared by representative and member rows. */
function rowActions(
  row: MeasurementListItem,
  onRename: (row: MeasurementListItem) => void,
  onDelete: (row: MeasurementListItem) => void,
  t: TFunction,
) {
  return (
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
  );
}

/** measurements list table - one collapsible row per iteration group. */
export default function MeasurementListTable({
  groups,
  totalRows,
  loading,
  error,
  sortKey,
  sortDir,
  expandedGroups,
  onSort,
  onToggleExpand,
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

  if (groups.length === 0) {
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
        {groups.map((group) => {
          const row = group.representative;
          const expandable = group.runCount > 1;
          const expanded = expandedGroups.has(group.groupId);
          return [
            <tr
              key={row.id}
              onClick={() => onRowClick(row)}
              className="border-b border-tv-border last:border-b-0 cursor-pointer
                text-sm text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
              data-testid={`measurement-row-${row.id}`}
            >
              <td className="px-4 py-3 font-medium">{row.mission_name}</td>
              <td className="px-4 py-3 text-tv-text-secondary">
                <span className="flex items-center gap-2">
                  {expandable && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleExpand(group.groupId);
                      }}
                      className="text-tv-text-muted hover:text-tv-text-primary"
                      aria-label={t("measurementsList.expandRuns")}
                      data-testid={`expand-group-${group.groupId}`}
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                  )}
                  {measurementDisplayName(row, t)}
                  {expandable && (
                    <span
                      className="rounded-full bg-tv-surface-hover px-2 py-0.5 text-xs text-tv-text-muted"
                      data-testid={`run-count-${group.groupId}`}
                    >
                      {t("measurementsList.runCount", { count: group.runCount })}
                    </span>
                  )}
                </span>
              </td>
              <td className="px-4 py-3">
                <MeasurementStatusChip status={row.status} />
              </td>
              <td className="px-4 py-3 text-tv-text-secondary">
                {row.created_at ? formatDate(row.created_at) : "—"}
              </td>
              <td className="px-4 py-3">{resultCell(row)}</td>
              <td className="px-4 py-3">{rowActions(row, onRename, onDelete, t)}</td>
            </tr>,
            ...(expandable && expanded
              ? group.runs.map((member) => (
                  <tr
                    key={`sub-${member.id}`}
                    onClick={() => onRowClick(member)}
                    className="border-b border-tv-border last:border-b-0 cursor-pointer
                      text-sm text-tv-text-secondary bg-tv-surface-hover/40 hover:bg-tv-surface-hover transition-colors"
                    data-testid={`measurement-subrow-${member.id}`}
                  >
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2 pl-10">
                      {t("measurement.iteration.label", {
                        index: member.iteration_index,
                      })}
                    </td>
                    <td className="px-4 py-2">
                      <MeasurementStatusChip status={member.status} />
                    </td>
                    <td className="px-4 py-2">
                      {member.created_at ? formatDate(member.created_at) : "—"}
                    </td>
                    <td className="px-4 py-2">{resultCell(member)}</td>
                    <td className="px-4 py-2">
                      {rowActions(member, onRename, onDelete, t)}
                    </td>
                  </tr>
                ))
              : []),
          ];
        })}
      </tbody>
    </table>
  );
}
