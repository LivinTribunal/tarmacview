import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "@/components/common/Button";
import Modal from "@/components/common/Modal";
import { bulkChangeDrone } from "@/api/airports";
import type { DroneProfileResponse } from "@/types/droneProfile";

interface BulkChangeDroneModalProps {
  isOpen: boolean;
  onClose: () => void;
  airportId: string;
  airportName: string;
  drones: DroneProfileResponse[];
  onResult: (updatedCount: number) => void;
  onError: () => void;
}

/** simple bulk-change modal used by the operator drone list page. */
export default function BulkChangeDroneModal({
  isOpen,
  onClose,
  airportId,
  airportName,
  drones,
  onResult,
  onError,
}: BulkChangeDroneModalProps) {
  const { t } = useTranslation();

  const [bulkDroneId, setBulkDroneId] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);

  function handleClose() {
    onClose();
    setBulkDroneId("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!airportId || !bulkDroneId) return;
    setBulkLoading(true);
    try {
      const result = await bulkChangeDrone(airportId, bulkDroneId);
      onClose();
      setBulkDroneId("");
      onResult(result.updated_count);
    } catch (err) {
      console.error(
        "bulk change drone failed:",
        err instanceof Error ? err.message : String(err),
      );
      onError();
    } finally {
      setBulkLoading(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("operatorDrones.bulkChange")}
    >
      <form onSubmit={handleSubmit}>
        <div>
          <label
            htmlFor="bulk-drone-select"
            className="block text-xs font-medium mb-1 text-tv-text-secondary"
          >
            {t("dashboard.selectDrone")}
          </label>
          <select
            id="bulk-drone-select"
            value={bulkDroneId}
            onChange={(e) => setBulkDroneId(e.target.value)}
            className="w-full rounded-full border border-tv-border bg-tv-bg px-4 py-2.5 text-sm
              text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
            data-testid="bulk-drone-select"
          >
            <option value="">{t("dashboard.selectDronePlaceholder")}</option>
            {drones.map((dp) => (
              <option key={dp.id} value={dp.id}>
                {dp.name}
              </option>
            ))}
          </select>
        </div>
        {bulkDroneId && (
          <p className="mt-3 text-sm text-tv-text-secondary">
            {t("operatorDrones.bulkChangeConfirm", { airport: airportName })}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!bulkDroneId || bulkLoading}>
            {bulkLoading
              ? t("common.loading")
              : t("operatorDrones.bulkChange")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
