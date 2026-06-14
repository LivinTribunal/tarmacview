import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import useListSort from "@/components/common/useListSort";
import type { AirportAdminResponse, AuditLogEntry } from "@/types/admin";
import { listAirportsAdmin, listAuditLogs, exportAuditLog } from "@/api/admin";

export type AuditLogSortKey =
  | "timestamp"
  | "user_email"
  | "action"
  | "entity_type"
  | "entity_name";

/** stable comparator for the audit-log table headers (server still owns the actual sort). */
function compareEntries(a: AuditLogEntry, b: AuditLogEntry, key: AuditLogSortKey): number {
  const av = a[key as keyof AuditLogEntry];
  const bv = b[key as keyof AuditLogEntry];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv);
  return 0;
}

/** owns the super-admin audit-log filter/list state, server fetch+sort, and csv export. */
export default function useAuditLog() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [error, setError] = useState<string | null>(null);
  // standalone filter state, mirroring the pre-template inline layout
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string | null>(null);
  const [entityTypeFilter, setEntityTypeFilter] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [allAirports, setAllAirports] = useState<AirportAdminResponse[]>([]);

  // ?airport_id=<uuid> drives a read-only scope chip. clearing the chip drops the param.
  const airportIdFilter = searchParams.get("airport_id");
  const scopedAirport = useMemo(
    () => allAirports.find((a) => a.id === airportIdFilter) ?? null,
    [allAirports, airportIdFilter],
  );

  // load airport list once so the chip can resolve the airport name
  useEffect(() => {
    listAirportsAdmin()
      .then((res) => setAllAirports(res.data))
      .catch(() => {
        /* chip just shows the raw id if the resolver fails */
      });
  }, []);

  function clearAirportFilter() {
    /** drop the airport_id query param, keep other filters intact. */
    const next = new URLSearchParams(searchParams);
    next.delete("airport_id");
    setSearchParams(next, { replace: true });
    setPage(0);
  }

  const { sortedRows: sortedEntries, sortKey, sortDir, handleSort } = useListSort<
    AuditLogEntry,
    AuditLogSortKey
  >(entries, "timestamp", compareEntries, "desc", ["timestamp"]);

  const fetchLogs = useCallback(async () => {
    /** fetch audit log entries from the server using the current filter state. */
    setLoading(true);
    setError(null);
    try {
      const res = await listAuditLogs({
        search: search || undefined,
        action: actionFilter || undefined,
        entity_type: entityTypeFilter || undefined,
        airport_id: airportIdFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        sort_by: sortKey,
        sort_dir: sortDir,
        limit: pageSize,
        offset: page * pageSize,
      });
      setEntries(res.data);
      setTotal(res.meta.total);
    } catch (err) {
      console.warn("audit log fetch failed", err);
      setError(t("superAdmin.errors.auditLogLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [
    search,
    actionFilter,
    entityTypeFilter,
    airportIdFilter,
    dateFrom,
    dateTo,
    sortKey,
    sortDir,
    page,
    pageSize,
    t,
  ]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  async function handleExport() {
    /** export the current filter window as a csv blob. */
    try {
      const blob = await exportAuditLog({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        airport_id: airportIdFilter || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "audit-log.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn("audit log export failed", err);
      setError(t("superAdmin.errors.auditLogExportFailed"));
    }
  }

  function toggleAction(value: string) {
    /** toggle the single-select action pill. */
    setActionFilter((prev) => (prev === value ? null : value));
    setPage(0);
  }

  function toggleEntityType(value: string) {
    /** toggle the single-select entity-type pill. */
    setEntityTypeFilter((prev) => (prev === value ? null : value));
    setPage(0);
  }

  function handleSearchChange(value: string) {
    /** standalone search updates reset to the first page. */
    setSearch(value);
    setPage(0);
  }

  function handleDateFromChange(value: string) {
    /** date-from change resets to the first page. */
    setDateFrom(value);
    setPage(0);
  }

  function handleDateToChange(value: string) {
    /** date-to change resets to the first page. */
    setDateTo(value);
    setPage(0);
  }

  return {
    entries,
    total,
    loading,
    page,
    pageSize,
    error,
    search,
    actionFilter,
    entityTypeFilter,
    dateFrom,
    dateTo,
    airportIdFilter,
    scopedAirport,
    sortedEntries,
    sortKey,
    sortDir,
    setPage,
    setPageSize,
    handleSort,
    clearAirportFilter,
    handleExport,
    toggleAction,
    toggleEntityType,
    handleSearchChange,
    handleDateFromChange,
    handleDateToChange,
  };
}
