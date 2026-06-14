import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAirport } from "@/contexts/AirportContext";
import { useAirportSummaries } from "@/api/queries/airports";
import {
  ListPageContainer,
  ListPageContent,
  SearchBar,
  Pagination,
  SortIndicator,
} from "@/components/common/ListPageLayout";
import { DEFAULT_PAGE_SIZE } from "@/constants/pagination";

type SortKey =
  | "icao_code"
  | "name"
  | "city"
  | "country"
  | "surfaces_count"
  | "agls_count"
  | "missions_count";

type SortDir = "asc" | "desc";

export default function AirportSelectionView() {
  const { selectAirport } = useAirport();
  const { t } = useTranslation();
  const { data: summariesData, isLoading: loading, isError: error, refetch } = useAirportSummaries();
  const airports = useMemo(() => summariesData?.data ?? [], [summariesData]);
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [hasAglFilter, setHasAglFilter] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("icao_code");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const countries = useMemo(
    () =>
      Array.from(
        new Set(airports.map((a) => a.country).filter((c): c is string => !!c)),
      ).sort(),
    [airports],
  );

  const columns: { key: SortKey; label: string }[] = [
    { key: "icao_code", label: t("airportSelection.columns.icaoCode") },
    { key: "name", label: t("airportSelection.columns.name") },
    { key: "city", label: t("airportSelection.columns.city") },
    { key: "country", label: t("airportSelection.columns.country") },
    { key: "surfaces_count", label: t("airportSelection.columns.runways") },
    { key: "agls_count", label: t("airportSelection.columns.aglSystems") },
    { key: "missions_count", label: t("airportSelection.columns.missions") },
  ];

  function handleSort(key: SortKey) {
    const numeric: SortKey[] = ["surfaces_count", "agls_count", "missions_count"];
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(numeric.includes(key) ? "desc" : "asc");
    }
  }

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

  const sorted = useMemo(() => {
    return filtered.slice().sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

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
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <svg
              className="h-6 w-6 animate-spin text-tv-text-muted"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          </div>
        ) : error ? (
          <div className="px-6 py-16 text-center text-sm text-tv-error">
            {t("airportSelection.loadError")}
            <button
              type="button"
              onClick={() => refetch()}
              className="ml-2 underline hover:no-underline"
            >
              {t("common.retry")}
            </button>
          </div>
        ) : sorted.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-tv-text-muted">
            {airports.length === 0
              ? t("airportSelection.noAirports")
              : t("airportSelection.noMatch")}
          </div>
        ) : (
          <>
          <table className="w-full">
            <thead>
              <tr className="border-b border-tv-border">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider
                      text-tv-text-secondary cursor-pointer select-none hover:text-tv-text-primary transition-colors"
                  >
                    {col.label}
                    <SortIndicator
                      active={sortKey === col.key}
                      dir={sortDir}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((airport) => (
                <tr
                  key={airport.id}
                  onClick={() => selectAirport(airport)}
                  className="border-b border-tv-border last:border-b-0 cursor-pointer
                    text-sm text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
                >
                  <td className="px-4 py-3 font-medium">{airport.icao_code}</td>
                  <td className="px-4 py-3">{airport.name}</td>
                  <td className="px-4 py-3 text-tv-text-secondary">
                    {airport.city ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-tv-text-secondary">
                    {airport.country ?? "—"}
                  </td>
                  <td className="px-4 py-3">{airport.surfaces_count}</td>
                  <td className="px-4 py-3">{airport.agls_count}</td>
                  <td className="px-4 py-3">{airport.missions_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
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
