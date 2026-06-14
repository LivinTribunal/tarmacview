import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { createDroneProfile, deleteDroneProfile } from "@/api/droneProfiles";
import type { DroneProfileResponse } from "@/types/droneProfile";
import Button from "@/components/common/Button";
import Modal from "@/components/common/Modal";
import {
  ListPageContainer,
  ListPageContent,
  Pagination,
  SearchBar,
} from "@/components/common/ListPageLayout";
import CreateDroneDialog from "@/components/drone/CreateDroneDialog";
import DroneListTable from "@/components/drone/DroneListTable";
import useDroneProfileList from "@/hooks/useDroneProfileList";

/** drone profile list with sorting, pagination, and filtering. */
export default function DroneListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const list = useDroneProfileList();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DroneProfileResponse | null>(
    null,
  );

  /** duplicate a drone profile. */
  async function handleDuplicate(drone: DroneProfileResponse) {
    try {
      const payload = {
        name: `${drone.name} ${t("coordinator.drones.duplicate.suffix")}`,
        manufacturer: drone.manufacturer,
        model: drone.model,
        max_speed: drone.max_speed,
        max_climb_rate: drone.max_climb_rate,
        max_altitude: drone.max_altitude,
        battery_capacity: drone.battery_capacity,
        endurance_minutes: drone.endurance_minutes,
        camera_resolution: drone.camera_resolution,
        camera_frame_rate: drone.camera_frame_rate,
        sensor_fov: drone.sensor_fov,
        weight: drone.weight,
        model_identifier: drone.model_identifier,
      };
      const created = await createDroneProfile(payload);
      navigate(`/coordinator-center/drones/${created.id}`);
    } catch {
      list.showToast(t("coordinator.drones.duplicate.error"));
    }
  }

  /** delete the targeted drone profile. */
  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteDroneProfile(deleteTarget.id);
      setDeleteTarget(null);
      list.fetchDrones();
    } catch {
      list.showToast(t("coordinator.drones.delete.deleteError"));
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
          onClick={() => setShowCreateDialog(true)}
          data-testid="add-drone-btn"
        >
          {t("coordinator.drones.addNew")}
        </Button>
      </SearchBar>

      <ListPageContent className="rounded-2xl border border-tv-border bg-tv-surface overflow-hidden">
        <DroneListTable
          rows={list.paged}
          totalDrones={list.drones.length}
          loading={list.loading}
          error={list.error}
          sortKey={list.sortKey}
          sortDir={list.sortDir}
          onSort={list.handleSort}
          onRowClick={(drone) =>
            navigate(`/coordinator-center/drones/${drone.id}`)
          }
          onDuplicate={handleDuplicate}
          onDelete={setDeleteTarget}
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

      <CreateDroneDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreated={(created) =>
          navigate(`/coordinator-center/drones/${created.id}`)
        }
      />

      <Modal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t("coordinator.drones.delete.title")}
      >
        <p className="text-sm text-tv-text-primary mb-6">
          {t("coordinator.drones.delete.confirm", {
            name: deleteTarget?.name,
          })}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            {t("common.delete")}
          </Button>
        </div>
      </Modal>

      {list.notification && (
        <div className="fixed bottom-6 right-6 z-50 rounded-2xl border border-tv-border bg-tv-surface px-4 py-3 text-sm text-tv-text-primary">
          {list.notification}
        </div>
      )}
    </ListPageContainer>
  );
}
