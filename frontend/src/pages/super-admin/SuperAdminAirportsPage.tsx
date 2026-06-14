import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Users, ExternalLink } from "lucide-react";
import {
  ListPageContainer,
  ListPageContent,
  SearchBar,
  SortableHeader,
  Pagination,
} from "@/components/common/ListPageLayout";
import RowActionButtons from "@/components/common/RowActionButtons";
import useListSort from "@/components/common/useListSort";
import type { AirportAdminResponse } from "@/types/admin";
import { listAirportsAdmin } from "@/api/admin";
import { UNASSIGNED_BADGE } from "@/pages/super-admin/badgeStyles";

type SortKey =
  | "icao_code"
  | "name"
  | "city"
  | "country"
  | "user_count"
  | "coordinator_count"
  | "operator_count"
  | "mission_count"
  | "drone_count"
  | "terrain_source";

/** an airport with no coordinator is orphaned: invisible/unusable to coordinators and operators. */
function isOrphaned(airport: AirportAdminResponse): boolean {
  return airport.coordinator_count === 0;
}

const TERRAIN_STYLES: Record<string, string> = {
  FLAT: "bg-tv-surface-hover text-tv-text-muted",
  DEM_UPLOAD: "bg-[var(--tv-info)]/15 text-[var(--tv-info)]",
  DEM_API: "bg-[var(--tv-accent)]/15 text-[var(--tv-accent)]",
};

/** comparator for the airports table; numeric and string columns. */
function compareAirports(
  a: AirportAdminResponse,
  b: AirportAdminResponse,
  key: SortKey,
): number {
  const av = a[key as keyof AirportAdminResponse];
  const bv = b[key as keyof AirportAdminResponse];
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv);
  return 0;
}

/** super-admin airports list with FilterBar-driven server-side filters. */
export default function SuperAdminAirportsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [airports, setAirports] = useState<AirportAdminResponse[]>([]);
  const [allAirports, setAllAirports] = useState<AirportAdminResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  // standalone search + country select (mirrors coordinator AirportListPage layout)
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [orphanedOnly, setOrphanedOnly] = useState(false);

  // unfiltered fetch on mount to populate the country select options.
  // failure is non-fatal: the country select just stays empty.
  useEffect(() => {
    listAirportsAdmin()
      .then((res) => setAllAirports(res.data))
      .catch((err) => {
        console.warn("country options load failed", err);
      });
  }, []);

  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const a of allAirports) {
      if (a.country) set.add(a.country);
    }
    return Array.from(set).sort();
  }, [allAirports]);

  const fetchAirports = useCallback(async () => {
    /** fetch airports using server-side search + country filter. */
    setLoading(true);
    try {
      const res = await listAirportsAdmin({
        search: search || undefined,
        country: countryFilter || undefined,
      });
      setAirports(res.data);
    } catch (err) {
      console.warn("admin airports list fetch failed", err);
    } finally {
      setLoading(false);
    }
  }, [search, countryFilter]);

  useEffect(() => {
    fetchAirports();
  }, [fetchAirports]);

  // orphaned-only is a client-side narrowing of the server-filtered rows
  const visibleAirports = useMemo(
    () => (orphanedOnly ? airports.filter(isOrphaned) : airports),
    [airports, orphanedOnly],
  );

  const { sortedRows: sortedAirports, sortKey, sortDir, handleSort } = useListSort<
    AirportAdminResponse,
    SortKey
  >(visibleAirports, "name", compareAirports, "asc", [
    "user_count",
    "coordinator_count",
    "operator_count",
    "mission_count",
    "drone_count",
  ]);

  const paginatedAirports = sortedAirports.slice(
    page * pageSize,
    (page + 1) * pageSize,
  );

  return (
    <ListPageContainer data-testid="admin-airports-page">
      {/* standalone search + inline country select, mirroring coordinator AirportListPage */}
      <SearchBar
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
        placeholder={t("admin.searchAirports")}
        testId="airport-search"
      >
        <select
          value={countryFilter}
          onChange={(e) => {
            setCountryFilter(e.target.value);
            setPage(0);
          }}
          aria-label={t("admin.columns.country")}
          className="rounded-full border border-tv-border bg-tv-surface px-4 h-10 text-sm
            text-tv-text-primary focus:outline-none focus:border-tv-accent"
          data-testid="country-filter"
        >
          <option value="">{t("admin.columns.country")}</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <label
          className="flex items-center gap-2 rounded-full border border-tv-border bg-tv-surface
            px-4 h-10 text-sm text-tv-text-secondary cursor-pointer select-none
            hover:text-tv-text-primary"
        >
          <input
            type="checkbox"
            checked={orphanedOnly}
            onChange={(e) => {
              setOrphanedOnly(e.target.checked);
              setPage(0);
            }}
            className="accent-tv-accent"
            data-testid="orphaned-filter"
          />
          {t("admin.orphanedOnly")}
        </label>
      </SearchBar>

      <ListPageContent>
        <div className="rounded-2xl border border-tv-border bg-tv-surface overflow-hidden">
          {loading ? (
            <p className="text-center text-tv-text-muted py-8">{t("common.loading")}</p>
          ) : sortedAirports.length === 0 ? (
            <p className="text-center text-tv-text-muted py-8">{t("common.noResults")}</p>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full" data-testid="airports-table">
              <thead>
                <tr className="border-b border-tv-border">
                  <SortableHeader sortKey="icao_code" currentSort={sortKey} currentDir={sortDir} onSort={handleSort}>
                    {t("admin.columns.icaoCode")}
                  </SortableHeader>
                  <SortableHeader sortKey="name" currentSort={sortKey} currentDir={sortDir} onSort={handleSort}>
                    {t("admin.columns.name")}
                  </SortableHeader>
                  <SortableHeader sortKey="city" currentSort={sortKey} currentDir={sortDir} onSort={handleSort}>
                    {t("admin.columns.city")}
                  </SortableHeader>
                  <SortableHeader sortKey="country" currentSort={sortKey} currentDir={sortDir} onSort={handleSort}>
                    {t("admin.columns.country")}
                  </SortableHeader>
                  <SortableHeader sortKey="user_count" currentSort={sortKey} currentDir={sortDir} onSort={handleSort}>
                    {t("admin.columns.users")}
                  </SortableHeader>
                  <SortableHeader sortKey="coordinator_count" currentSort={sortKey} currentDir={sortDir} onSort={handleSort}>
                    {t("admin.columns.coordinators")}
                  </SortableHeader>
                  <SortableHeader sortKey="operator_count" currentSort={sortKey} currentDir={sortDir} onSort={handleSort}>
                    {t("admin.columns.operators")}
                  </SortableHeader>
                  <SortableHeader sortKey="mission_count" currentSort={sortKey} currentDir={sortDir} onSort={handleSort}>
                    {t("admin.columns.missions")}
                  </SortableHeader>
                  <SortableHeader sortKey="drone_count" currentSort={sortKey} currentDir={sortDir} onSort={handleSort}>
                    {t("admin.columns.drones")}
                  </SortableHeader>
                  <SortableHeader sortKey="terrain_source" currentSort={sortKey} currentDir={sortDir} onSort={handleSort}>
                    {t("admin.columns.terrainSource")}
                  </SortableHeader>
                  <th className="px-4 py-3" aria-label={t("common.actions")} />
                </tr>
              </thead>
              <tbody>
                {paginatedAirports.map((airport) => (
                  <tr
                    key={airport.id}
                    onClick={() => navigate(`/super-admin/airports/${airport.id}`)}
                    className="border-b border-tv-border hover:bg-tv-surface-hover cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-tv-text-primary">
                      {airport.icao_code}
                    </td>
                    <td className="px-4 py-3 text-sm text-tv-text-primary">
                      <span className="flex items-center gap-2">
                        {airport.name}
                        {isOrphaned(airport) && (
                          <span
                            className="rounded-full px-2 py-0.5 text-xs font-semibold"
                            style={UNASSIGNED_BADGE}
                            data-testid="unassigned-badge"
                          >
                            {t("admin.unassigned")}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-tv-text-secondary">{airport.city}</td>
                    <td className="px-4 py-3 text-sm text-tv-text-secondary">{airport.country}</td>
                    <td className="px-4 py-3 text-sm text-tv-text-secondary">{airport.user_count}</td>
                    <td className="px-4 py-3 text-sm text-tv-text-secondary">{airport.coordinator_count}</td>
                    <td className="px-4 py-3 text-sm text-tv-text-secondary">{airport.operator_count}</td>
                    <td className="px-4 py-3 text-sm text-tv-text-secondary">{airport.mission_count}</td>
                    <td className="px-4 py-3 text-sm text-tv-text-secondary">{airport.drone_count}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TERRAIN_STYLES[airport.terrain_source] || ""}`}>
                        {airport.terrain_source === "DEM_UPLOAD"
                          ? "DEM"
                          : airport.terrain_source === "DEM_API"
                            ? "API"
                            : "Flat"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <RowActionButtons
                        actions={[
                          {
                            icon: Users,
                            onClick: () => navigate(`/super-admin/airports/${airport.id}`),
                            title: t("admin.manageUsers"),
                          },
                          {
                            icon: ExternalLink,
                            onClick: () =>
                              navigate(`/coordinator-center/airports/${airport.id}`),
                            title: t("admin.openInConfigurator"),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          )}
        </div>

        <Pagination
          page={page}
          pageSize={pageSize}
          totalItems={sortedAirports.length}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(0); }}
          showingKey="admin.pagination"
        />
      </ListPageContent>
    </ListPageContainer>
  );
}
