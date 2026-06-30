import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Button from "@/components/common/Button";
import {
  ListPageContainer,
  ListPageContent,
  Pagination,
  SearchBar,
} from "@/components/common/ListPageLayout";
import BulkChangeDroneSimpleDialog from "@/components/drone/BulkChangeDroneSimpleDialog";
import OperatorDroneTable from "@/components/drone/OperatorDroneTable";
import useDroneProfileList from "@/hooks/useDroneProfileList";
import { setDefaultDrone } from "@/api/airports";
import { useAirport } from "@/contexts/AirportContext";

/** read-only drone profile list with search, default toggle, and bulk reassignment. */
export default function OperatorDronesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { selectedAirport, refreshAirportDetail } = useAirport();

  const list = useDroneProfileList();

  const [showBulkDialog, setShowBulkDialog] = useState(false);

  async function handleToggleDefault(droneId: string) {
    if (!selectedAirport) return;
    const isDefault = selectedAirport.default_drone_profile_id === droneId;
    try {
      await setDefaultDrone(selectedAirport.id, isDefault ? null : droneId);
      await refreshAirportDetail();
      list.showToast(
        isDefault
          ? t("operatorDrones.removeDefault")
          : t("operatorDrones.defaultBadge"),
      );
    } catch (err) {
      console.error(
        "toggle default drone failed:",
        err instanceof Error ? err.message : String(err),
      );
      list.showToast(t("common.error"));
    }
  }

  function handleBulkResult(updatedCount: number) {
    if (updatedCount === 0) {
      list.showToast(t("operatorDrones.noMissions"));
    } else {
      list.showToast(
        t("operatorDrones.bulkChangeSuccess", { count: updatedCount }),
      );
    }
  }

  return (
    <ListPageContainer>
      <SearchBar
        value={list.search}
        onChange={list.handleSearchChange}
        placeholder={t("coordinator.drones.searchPlaceholder")}
        testId="drone-search"
      >
        <select
          value={list.manufacturerFilter}
          onChange={(e) => list.handleManufacturerChange(e.target.value)}
          className="rounded-full border border-tv-border bg-tv-surface px-4 h-10 text-sm
            text-tv-text-primary focus:outline-none focus:border-tv-accent"
          data-testid="manufacturer-filter"
        >
          <option value="">{t("coordinator.drones.allManufacturers")}</option>
          {list.manufacturers.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <Button
          onClick={() => setShowBulkDialog(true)}
          variant="secondary"
          data-testid="bulk-change-btn"
        >
          {t("operatorDrones.bulkChange")}
        </Button>
      </SearchBar>

      <ListPageContent className="rounded-2xl border border-tv-border bg-tv-surface overflow-hidden">
        <OperatorDroneTable
          rows={list.paged}
          totalDrones={list.drones.length}
          loading={list.loading}
          error={list.error}
          defaultDroneId={selectedAirport?.default_drone_profile_id}
          sortKey={list.sortKey}
          sortDir={list.sortDir}
          onSort={list.handleSort}
          onRowClick={(drone) =>
            navigate(`/operator-center/drones/${drone.id}`)
          }
          onToggleDefault={(drone) => handleToggleDefault(drone.id)}
          onBulkChange={() => setShowBulkDialog(true)}
          onRetry={list.fetchDrones}
        />
      </ListPageContent>

      {!list.loading && !list.error && list.sorted.length > 0 && (
        <Pagination
          page={list.page}
          pageSize={list.pageSize}
          totalItems={list.sorted.length}
          onPageChange={list.setPage}
          onPageSizeChange={list.handlePageSizeChange}
          showingKey="coordinator.drones.showing"
        />
      )}

      {selectedAirport && (
        <BulkChangeDroneSimpleDialog
          isOpen={showBulkDialog}
          onClose={() => setShowBulkDialog(false)}
          airportId={selectedAirport.id}
          airportName={selectedAirport.name}
          drones={list.drones}
          onResult={handleBulkResult}
          onError={() => list.showToast(t("common.error"))}
        />
      )}

      {list.notification && (
        <div className="fixed bottom-6 right-6 z-50 rounded-2xl border border-tv-border bg-tv-surface px-4 py-3 text-sm text-tv-text-primary">
          {list.notification}
        </div>
      )}
    </ListPageContainer>
  );
}
