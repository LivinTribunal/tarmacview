import { useTranslation } from "react-i18next";
import { Star, ArrowLeftRight } from "lucide-react";
import RowActionButtons from "@/components/common/RowActionButtons";
import { SortIndicator } from "@/components/common/ListPageLayout";
import type { SortDir } from "@/components/common/useListSort";
import DroneModelThumbnail from "@/components/drone/DroneModelThumbnail";
import {
  resolveModelUrl,
  type DroneSortKey,
} from "@/hooks/useDroneProfileList";
import type { DroneProfileResponse } from "@/types/droneProfile";

interface OperatorDroneTableProps {
  rows: DroneProfileResponse[];
  totalDrones: number;
  loading: boolean;
  error: boolean;
  defaultDroneId: string | null | undefined;
  sortKey: DroneSortKey;
  sortDir: SortDir;
  onSort: (key: DroneSortKey) => void;
  onRowClick: (drone: DroneProfileResponse) => void;
  onToggleDefault: (drone: DroneProfileResponse) => void;
  onBulkChange: () => void;
  onRetry: () => void;
}

/** operator-variant drone table with star (default) and bulk-change row actions. */
export default function OperatorDroneTable({
  rows,
  totalDrones,
  loading,
  error,
  defaultDroneId,
  sortKey,
  sortDir,
  onSort,
  onRowClick,
  onToggleDefault,
  onBulkChange,
  onRetry,
}: OperatorDroneTableProps) {
  const { t } = useTranslation();

  const columns: { key: DroneSortKey; label: string }[] = [
    { key: "name", label: t("coordinator.drones.columns.name") },
    {
      key: "manufacturer",
      label: t("coordinator.drones.columns.manufacturer"),
    },
    { key: "model", label: t("coordinator.drones.columns.model") },
    { key: "max_speed", label: t("coordinator.drones.columns.maxSpeed") },
    {
      key: "endurance_minutes",
      label: t("coordinator.drones.columns.endurance"),
    },
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
        {rows.map((drone) => {
          const isDefault = defaultDroneId === drone.id;
          return (
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
                  {isDefault && (
                    <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold bg-[var(--tv-status-validated-bg)] text-[var(--tv-status-validated-text)]">
                      {t("operatorDrones.defaultBadge")}
                    </span>
                  )}
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
                      icon: Star,
                      onClick: () => onToggleDefault(drone),
                      title: isDefault
                        ? t("operatorDrones.removeDefault")
                        : t("operatorDrones.setDefault"),
                      className: isDefault ? "text-tv-accent" : undefined,
                      filled: isDefault,
                    },
                    {
                      icon: ArrowLeftRight,
                      onClick: () => onBulkChange(),
                      title: t("operatorDrones.bulkChange"),
                    },
                  ]}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
