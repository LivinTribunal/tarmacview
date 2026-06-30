import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Star, ArrowLeftRight } from "lucide-react";
import Button from "@/components/common/Button";
import Toast from "@/components/common/Toast";
import RowActionButtons from "@/components/common/RowActionButtons";
import {
  ListPageContainer,
  ListPageContent,
  Pagination,
} from "@/components/common/ListPageLayout";
import BulkChangeDroneSimpleDialog from "@/components/drone/BulkChangeDroneSimpleDialog";
import DroneListSearchBar from "@/components/drone/DroneListSearchBar";
import DroneTable from "@/components/drone/DroneTable";
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
      <DroneListSearchBar
        search={list.search}
        onSearchChange={list.handleSearchChange}
        manufacturerFilter={list.manufacturerFilter}
        onManufacturerChange={list.handleManufacturerChange}
        manufacturers={list.manufacturers}
      >
        <Button
          onClick={() => setShowBulkDialog(true)}
          variant="secondary"
          data-testid="bulk-change-btn"
        >
          {t("operatorDrones.bulkChange")}
        </Button>
      </DroneListSearchBar>

      <ListPageContent className="rounded-2xl border border-tv-border bg-tv-surface overflow-hidden">
        <DroneTable
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
          onRetry={list.fetchDrones}
          renderRowActions={(drone, isDefault) => (
            <RowActionButtons
              actions={[
                {
                  icon: Star,
                  onClick: () => handleToggleDefault(drone.id),
                  title: isDefault
                    ? t("operatorDrones.removeDefault")
                    : t("operatorDrones.setDefault"),
                  className: isDefault ? "text-tv-accent" : undefined,
                  filled: isDefault,
                },
                {
                  icon: ArrowLeftRight,
                  onClick: () => setShowBulkDialog(true),
                  title: t("operatorDrones.bulkChange"),
                },
              ]}
            />
          )}
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

      {list.notification && <Toast message={list.notification} />}
    </ListPageContainer>
  );
}
