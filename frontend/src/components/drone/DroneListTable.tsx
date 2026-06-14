import { useTranslation } from "react-i18next";
import { Copy, Trash2 } from "lucide-react";
import RowActionButtons from "@/components/common/RowActionButtons";
import { SortIndicator } from "@/components/common/ListPageLayout";
import type { SortDir } from "@/components/common/useListSort";
import DroneModelThumbnail from "@/components/drone/DroneModelThumbnail";
import {
  resolveModelUrl,
  type DroneSortKey,
} from "@/hooks/useDroneProfileList";
import type { DroneProfileResponse } from "@/types/droneProfile";

interface DroneListTableProps {
  rows: DroneProfileResponse[];
  totalDrones: number;
  loading: boolean;
  error: boolean;
  sortKey: DroneSortKey;
  sortDir: SortDir;
  onSort: (key: DroneSortKey) => void;
  onRowClick: (drone: DroneProfileResponse) => void;
  onDuplicate: (drone: DroneProfileResponse) => void;
  onDelete: (drone: DroneProfileResponse) => void;
  onRetry: () => void;
}

/** coordinator-variant drone table with duplicate/delete affordances. */
export default function DroneListTable({
  rows,
  totalDrones,
  loading,
  error,
  sortKey,
  sortDir,
  onSort,
  onRowClick,
  onDuplicate,
  onDelete,
  onRetry,
}: DroneListTableProps) {
  const { t } = useTranslation();

  const columns: { key: DroneSortKey; label: string }[] = [
    { key: "name", label: t("coordinator.drones.columns.name") },
    { key: "manufacturer", label: t("coordinator.drones.columns.manufacturer") },
    { key: "model", label: t("coordinator.drones.columns.model") },
    { key: "max_speed", label: t("coordinator.drones.columns.maxSpeed") },
    { key: "endurance_minutes", label: t("coordinator.drones.columns.endurance") },
    { key: "mission_count", label: t("coordinator.drones.columns.missions") },
  ];

  if (loading) {
    return (
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
    );
  }

  if (error) {
    return (
      <div className="px-6 py-16 text-center text-sm text-tv-error">
        {t("coordinator.drones.loadError")}
        <button type="button" onClick={onRetry} className="ml-2 underline hover:no-underline">
          {t("common.retry")}
        </button>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="px-6 py-16 text-center text-sm text-tv-text-muted">
        {totalDrones === 0
          ? t("coordinator.drones.noDrones")
          : t("coordinator.drones.noMatch")}
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
          <th className="w-10" aria-label={t("common.actions")} />
        </tr>
      </thead>
      <tbody>
        {rows.map((drone) => (
          <tr
            key={drone.id}
            onClick={() => onRowClick(drone)}
            className="border-b border-tv-border last:border-b-0 cursor-pointer
              text-sm text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
            data-testid={`drone-row-${drone.id}`}
          >
            <td className="px-4 py-3 font-semibold">
              <div className="flex items-center gap-2">
                <div className="h-10 w-10 rounded-lg bg-[var(--tv-surface-hover)] flex-shrink-0 overflow-hidden">
                  <DroneModelThumbnail
                    modelUrl={resolveModelUrl(drone.model_identifier)}
                    size={128}
                    className="h-full w-full"
                  />
                </div>
                <span>{drone.name}</span>
              </div>
            </td>
            <td className="px-4 py-3 text-tv-text-secondary">
              {drone.manufacturer || "—"}
            </td>
            <td className="px-4 py-3 text-tv-text-secondary">
              {drone.model || "—"}
            </td>
            <td className="px-4 py-3 text-tv-text-secondary">
              {drone.max_speed != null
                ? `${drone.max_speed} ${t("coordinator.drones.units.ms")}`
                : "—"}
            </td>
            <td className="px-4 py-3 text-tv-text-secondary">
              {drone.endurance_minutes != null
                ? `${drone.endurance_minutes} ${t("coordinator.drones.units.min")}`
                : "—"}
            </td>
            <td className="px-4 py-3 text-tv-text-secondary">
              {drone.mission_count}
            </td>
            <td className="px-4 py-3">
              <RowActionButtons
                actions={[
                  {
                    icon: Copy,
                    onClick: () => onDuplicate(drone),
                    title: t("coordinator.drones.actions.duplicate"),
                  },
                  {
                    icon: Trash2,
                    onClick: () => onDelete(drone),
                    variant: "danger",
                    title: t("coordinator.drones.actions.delete"),
                  },
                ]}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
