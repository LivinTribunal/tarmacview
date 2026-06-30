import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { listAirportSummaries } from "@/api/airports";
import { useAirport } from "@/contexts/AirportContext";
import type { AirportSummaryResponse } from "@/types/airport";
import Button from "@/components/common/Button";
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
import CreateAirportDialog from "@/components/coordinator/CreateAirportDialog";
import { DEFAULT_PAGE_SIZE } from "@/constants/pagination";

/** airport list page with search, filters, sortable table, and pagination. */
export default function AirportListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { selectAirport } = useAirport();
  const [airports, setAirports] = useState<AirportSummaryResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // filters
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [hasAglFilter, setHasAglFilter] = useState(false);

  // pagination
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  // dialogs
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const fetchAirports = useCallback(async () => {
    /** load airport summaries from api. */
    setLoading(true);
    setError(false);
    try {
      const result = await listAirportSummaries();
      setAirports(result.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAirports();
  }, [fetchAirports]);

  const countries = useMemo(() => {
    /** extract unique country values for filter dropdown. */
    const set = new Set<string>();
    airports.forEach((a) => {
      if (a.country) set.add(a.country);
    });
    return Array.from(set).sort();
  }, [airports]);

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    /** update search and reset to first page. */
    setSearch(e.target.value);
    setPage(0);
  }

  function handlePageSizeChange(size: number) {
    /** change page size and reset to first page. */
    setPageSize(size);
    setPage(0);
  }

  function handleRowClick(airport: AirportSummaryResponse) {
    /** select airport in context and navigate to detail editor. */
    selectAirport(airport);
    navigate(`/coordinator-center/airports/${airport.id}`);
  }

  function handleCreated(id: string) {
    /** close dialog and navigate to newly created airport. */
    setShowCreateDialog(false);
    navigate(`/coordinator-center/airports/${id}`);
  }

  // filtering
  const filtered = useMemo(() => {
    let result = airports;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) =>
          a.icao_code.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q) ||
          (a.city && a.city.toLowerCase().includes(q)),
      );
    }
    if (countryFilter) {
      result = result.filter((a) => a.country === countryFilter);
    }
    if (hasAglFilter) {
      result = result.filter((a) => a.agls_count > 0);
    }
    return result;
  }, [airports, search, countryFilter, hasAglFilter]);

  const { sortedRows: sorted, sortKey, sortDir, handleSort } = useListSort<
    AirportSummaryResponse,
    AirportSortKey
  >(filtered, "icao_code", compareAirport, "asc", [
    "surfaces_count",
    "agls_count",
    "missions_count",
  ]);

  // pagination
  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const columns: { key: AirportSortKey; label: string }[] = [
    { key: "icao_code", label: t("coordinator.airportList.columns.icaoCode") },
    { key: "name", label: t("coordinator.airportList.columns.name") },
    { key: "city", label: t("coordinator.airportList.columns.city") },
    { key: "country", label: t("coordinator.airportList.columns.country") },
    { key: "surfaces_count", label: t("coordinator.airportList.columns.runways") },
    { key: "agls_count", label: t("coordinator.airportList.columns.aglSystems") },
    { key: "missions_count", label: t("coordinator.airportList.columns.missions") },
  ];

  return (
    <ListPageContainer data-testid="airport-list-page">
      {/* search bar + filters + add button */}
      <SearchBar
        value={search}
        onChange={handleSearchChange}
        placeholder={t("coordinator.airportList.searchPlaceholder")}
        testId="airport-search-input"
      >
        {/* country filter */}
        <select
          value={countryFilter}
          onChange={(e) => { setCountryFilter(e.target.value); setPage(0); }}
          className="rounded-full border border-tv-border bg-tv-surface px-4 h-10 text-sm
            text-tv-text-primary focus:outline-none focus:border-tv-accent"
          data-testid="country-filter"
        >
          <option value="">{t("coordinator.airportList.filterCountry")}</option>
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
          <span className="text-tv-text-primary whitespace-nowrap">{t("coordinator.airportList.filterHasAgl")}</span>
        </label>

        <Button
          onClick={() => setShowCreateDialog(true)}
          data-testid="add-airport-button"
        >
          {t("coordinator.airportList.addAirport")}
        </Button>
      </SearchBar>

      {/* airport table */}
      <ListPageContent className="rounded-2xl border border-tv-border bg-tv-surface overflow-hidden">
        <AirportTable
          columns={columns}
          rows={paged}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          onRowClick={handleRowClick}
          loading={loading}
          error={error}
          loadErrorMessage={t("coordinator.airportList.loadError")}
          emptyMessage={
            airports.length === 0
              ? t("coordinator.airportList.noAirports")
              : t("coordinator.airportList.noMatch")
          }
          onRetry={fetchAirports}
        />
      </ListPageContent>

      {/* pagination */}
      {!loading && !error && sorted.length > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          totalItems={sorted.length}
          onPageChange={setPage}
          onPageSizeChange={handlePageSizeChange}
          showingKey="coordinator.airportList.showing"
        />
      )}

      {/* create airport dialog */}
      <CreateAirportDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreated={handleCreated}
      />
    </ListPageContainer>
  );
}
