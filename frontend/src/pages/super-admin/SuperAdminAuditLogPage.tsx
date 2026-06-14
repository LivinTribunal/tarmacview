import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import {
  ListPageContainer,
  ListPageContent,
  SearchBar,
  SortableHeader,
  Pagination,
} from "@/components/common/ListPageLayout";
import Button from "@/components/common/Button";
import AuditLogFilterBar from "@/components/admin/AuditLogFilterBar";
import useAuditLog from "@/hooks/useAuditLog";
import { actionBadgeStyle, entityTypeBadgeStyle } from "./badgeStyles";

/** format the timestamp using the user locale. */
function formatTimestamp(ts: string) {
  return new Date(ts).toLocaleString();
}

/** flatten the details json into a one-line preview. */
function formatDetails(details: Record<string, unknown> | null) {
  if (!details) return "";
  return JSON.stringify(details);
}

/** super-admin audit log page driven by FilterBar with server pagination + server sort. */
export default function SuperAdminAuditLogPage() {
  const { t } = useTranslation();
  const audit = useAuditLog();

  return (
    <ListPageContainer data-testid="admin-audit-log-page">
      {/* standalone search bar with the export-log action inline */}
      <SearchBar
        value={audit.search}
        onChange={(e) => audit.handleSearchChange(e.target.value)}
        placeholder={t("admin.searchAuditLog")}
        testId="audit-log-search"
      >
        <Button
          onClick={audit.handleExport}
          data-testid="export-button"
          className="flex items-center justify-center gap-2"
        >
          <Download className="w-4 h-4" />
          {t("admin.exportLog")}
        </Button>
      </SearchBar>

      <ListPageContent>
        <AuditLogFilterBar
          airportIdFilter={audit.airportIdFilter}
          scopedAirport={audit.scopedAirport}
          onClearAirportFilter={audit.clearAirportFilter}
          actionFilter={audit.actionFilter}
          onToggleAction={audit.toggleAction}
          entityTypeFilter={audit.entityTypeFilter}
          onToggleEntityType={audit.toggleEntityType}
          dateFrom={audit.dateFrom}
          onDateFromChange={audit.handleDateFromChange}
          dateTo={audit.dateTo}
          onDateToChange={audit.handleDateToChange}
        />

        {audit.error && (
          <p className="text-center text-[var(--tv-error)] py-4">{audit.error}</p>
        )}

        <div className="rounded-2xl border border-tv-border bg-tv-surface overflow-hidden">
          {audit.loading ? (
            <p className="text-center text-tv-text-muted py-8">{t("common.loading")}</p>
          ) : audit.entries.length === 0 ? (
            <p className="text-center text-tv-text-muted py-8">{t("admin.noAuditLogs")}</p>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full" data-testid="audit-log-table">
                <thead>
                  <tr className="border-b border-tv-border">
                    <SortableHeader sortKey="timestamp" currentSort={audit.sortKey} currentDir={audit.sortDir} onSort={audit.handleSort}>
                      {t("admin.columns.timestamp")}
                    </SortableHeader>
                    <SortableHeader sortKey="user_email" currentSort={audit.sortKey} currentDir={audit.sortDir} onSort={audit.handleSort}>
                      {t("admin.columns.user")}
                    </SortableHeader>
                    <SortableHeader sortKey="action" currentSort={audit.sortKey} currentDir={audit.sortDir} onSort={audit.handleSort}>
                      {t("admin.columns.action")}
                    </SortableHeader>
                    <SortableHeader sortKey="entity_type" currentSort={audit.sortKey} currentDir={audit.sortDir} onSort={audit.handleSort}>
                      {t("admin.columns.entityType")}
                    </SortableHeader>
                    <SortableHeader sortKey="entity_name" currentSort={audit.sortKey} currentDir={audit.sortDir} onSort={audit.handleSort}>
                      {t("admin.columns.entityName")}
                    </SortableHeader>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-tv-text-secondary">
                      {t("admin.columns.details")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {audit.sortedEntries.map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-b border-tv-border hover:bg-tv-surface-hover transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-tv-text-secondary whitespace-nowrap">
                        {formatTimestamp(entry.timestamp)}
                      </td>
                      <td className="px-4 py-3 text-sm text-tv-text-primary">
                        {entry.user_email || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-semibold"
                          style={actionBadgeStyle(entry.action)}
                        >
                          {entry.action}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {entry.entity_type ? (
                          <span
                            className="rounded-full px-2 py-0.5 text-xs font-semibold"
                            style={entityTypeBadgeStyle(entry.entity_type)}
                          >
                            {entry.entity_type}
                          </span>
                        ) : (
                          <span className="text-sm text-tv-text-secondary">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-tv-text-secondary">
                        {entry.entity_name || "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-tv-text-muted max-w-xs truncate">
                        {formatDetails(entry.details)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <Pagination
          page={audit.page}
          pageSize={audit.pageSize}
          totalItems={audit.total}
          onPageChange={audit.setPage}
          onPageSizeChange={(size) => {
            audit.setPageSize(size);
            audit.setPage(0);
          }}
          showingKey="admin.pagination"
        />
      </ListPageContent>
    </ListPageContainer>
  );
}
