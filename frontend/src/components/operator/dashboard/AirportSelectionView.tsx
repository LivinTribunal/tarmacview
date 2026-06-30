import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { AirportSummaryResponse } from "@/types/airport";
import { useAirport } from "@/contexts/AirportContext";
import { useAirportSummaries } from "@/api/queries/airports";
import {
  ListPageContainer,
  ListPageContent,
  SearchBar,
  Pagination,
} from "@/components/common/ListPageLayout";
import useListSort from "@/components/common/useListSort";
import AirportTable, {
  compareAirport,
  type AirportSortKey,
} from "@/components/common/AirportTable";
import { DEFAULT_PAGE_SIZE } from "@/constants/pagination";

/** dashboard airport picker with search, filters, sortable table, and pagination. */
export default function AirportSelectionView() {
  const { selectAirport } = useAirport();
  const { t } = useTranslation();
  const { data: summariesData, isLoading: loading, isError: error, refetch } = useAirportSummaries();
  const airports = useMemo(() => summariesData?.data ?? [], [summariesData]);
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [hasAglFilter, setHasAglFilter] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const countries = useMemo(
    () =>
      Array.from(
        new Set(airports.map((a) => a.country).filter((c): c is string => !!c)),
      ).sort(),
    [airports],
  );

  const columns: { key: AirportSortKey; label: string }[] = [
    { key: "icao_code", label: t("airportSelection.columns.icaoCode") },
    { key: "name", label: t("airportSelection.columns.name") },
    { key: "city", label: t("airportSelection.columns.city") },
    { key: "country", label: t("airportSelection.columns.country") },
    { key: "surfaces_count", label: t("airportSelection.columns.runways") },
    { key: "agls_count", label: t("airportSelection.columns.aglSystems") },
    { key: "missions_count", label: t("airportSelection.columns.missions") },
  ];

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return airports.filter((a) => {
      const matchesSearch =
        a.icao_code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.city ?? "").toLowerCase().includes(q);
      if (!matchesSearch) return false;
      if (countryFilter && a.country !== countryFilter) return false;
      if (hasAglFilter && a.agls_count === 0) return false;
      return true;
    });
  }, [airports, search, countryFilter, hasAglFilter]);

  const { sortedRows: sorted, sortKey, sortDir, handleSort } = useListSort<
    AirportSummaryResponse,
    AirportSortKey
  >(filtered, "icao_code", compareAirport, "asc", [
    "surfaces_count",
    "agls_count",
    "missions_count",
  ]);

  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setPage(0);
  }

  function handlePageSizeChange(size: number) {
    setPageSize(size);
    setPage(0);
  }

  return (
    <ListPageContainer>
      <SearchBar
        value={search}
        onChange={handleSearchChange}
        placeholder={t("airportSelection.searchPlaceholder")}
        testId="dashboard-search"
      >
        {/* country filter */}
        <select
          value={countryFilter}
          onChange={(e) => { setCountryFilter(e.target.value); setPage(0); }}
          className="rounded-full border border-tv-border bg-tv-surface px-4 h-10 text-sm
            text-tv-text-primary focus:outline-none focus:border-tv-accent"
          data-testid="country-filter"
        >
          <option value="">{t("airportSelection.filterCountry")}</option>
          {countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {/* has agl toggle */}
        <label className="flex items-center gap-2 px-4 h-10 rounded-full text-sm border border-tv-border bg-tv-surface cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hasAglFilter}
            onChange={(e) => { setHasAglFilter(e.target.checked); setPage(0); }}
            className="accent-tv-accent"
            data-testid="agl-filter"
          />
          <span className="text-tv-text-primary whitespace-nowrap">{t("airportSelection.filterHasAgl")}</span>
        </label>
      </SearchBar>

      <ListPageContent className="rounded-2xl border border-tv-border bg-tv-surface overflow-hidden">
        <AirportTable
          columns={columns}
          rows={paged}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          onRowClick={(airport) => selectAirport(airport)}
          loading={loading}
          error={error}
          loadErrorMessage={t("airportSelection.loadError")}
          emptyMessage={
            airports.length === 0
              ? t("airportSelection.noAirports")
              : t("airportSelection.noMatch")
          }
          onRetry={() => refetch()}
        />
      </ListPageContent>

      {/* pagination bar */}
      {!loading && !error && sorted.length > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          totalItems={sorted.length}
          onPageChange={setPage}
          onPageSizeChange={handlePageSizeChange}
          showingKey="airportSelection.showing"
        />
      )}
    </ListPageContainer>
  );
}
