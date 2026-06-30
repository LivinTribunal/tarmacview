import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { AirportSummaryResponse } from "@/types/airport";
import { SortIndicator } from "@/components/common/ListPageLayout";
import type { SortDir } from "@/components/common/useListSort";

export type AirportSortKey =
  | "icao_code"
  | "name"
  | "city"
  | "country"
  | "surfaces_count"
  | "agls_count"
  | "missions_count";

/** comparator for the airport-list columns; numeric and string, null cells last in asc. */
export function compareAirport(
  a: AirportSummaryResponse,
  b: AirportSummaryResponse,
  key: AirportSortKey,
): number {
  const av = a[key];
  const bv = b[key];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv);
  return 0;
}

interface AirportTableProps {
  columns: { key: AirportSortKey; label: string }[];
  rows: AirportSummaryResponse[];
  sortKey: AirportSortKey;
  sortDir: SortDir;
  onSort: (key: AirportSortKey) => void;
  onRowClick: (airport: AirportSummaryResponse) => void;
  loading: boolean;
  error: boolean;
  emptyMessage: string;
  loadErrorMessage: string;
  onRetry: () => void;
}

/** shared airport table body with loading, error, empty, and sortable-row states. */
export default function AirportTable({
  columns,
  rows,
  sortKey,
  sortDir,
  onSort,
  onRowClick,
  loading,
  error,
  emptyMessage,
  loadErrorMessage,
  onRetry,
}: AirportTableProps) {
  const { t } = useTranslation();

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
        {loadErrorMessage}
        <button type="button" onClick={onRetry} className="ml-2 underline hover:no-underline">
          {t("common.retry")}
        </button>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="px-6 py-16 text-center text-sm text-tv-text-muted">
        {emptyMessage}
      </div>
    );
  }

  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-tv-border">
          {columns.map((col) => (
            <th
              key={col.key}
              onClick={() => onSort(col.key)}
              className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider
                text-tv-text-secondary cursor-pointer select-none hover:text-tv-text-primary transition-colors"
            >
              {col.label}
              <SortIndicator active={sortKey === col.key} dir={sortDir} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((airport) => (
          <tr
            key={airport.id}
            onClick={() => onRowClick(airport)}
            className="border-b border-tv-border last:border-b-0 cursor-pointer
              text-sm text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
            data-testid={`airport-row-${airport.id}`}
          >
            <td className="px-4 py-3 font-semibold text-tv-accent">
              {airport.icao_code}
            </td>
            <td className="px-4 py-3">{airport.name}</td>
            <td className="px-4 py-3 text-tv-text-secondary">
              {airport.city ?? "—"}
            </td>
            <td className="px-4 py-3 text-tv-text-secondary">
              {airport.country ?? "—"}
            </td>
            <td className="px-4 py-3 text-tv-text-secondary text-center">
              {airport.surfaces_count}
            </td>
            <td className="px-4 py-3 text-tv-text-secondary text-center">
              {airport.agls_count}
            </td>
            <td className="px-4 py-3 text-tv-text-secondary text-center">
              {airport.missions_count}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
