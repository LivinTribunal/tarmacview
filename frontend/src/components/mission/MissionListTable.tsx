import { useTranslation } from "react-i18next";
import { Copy, Loader2, Pencil, Trash2 } from "lucide-react";
import Badge from "@/components/common/Badge";
import RowActionButtons from "@/components/common/RowActionButtons";
import { SortIndicator } from "@/components/common/ListPageLayout";
import type { SortDir } from "@/components/common/useListSort";
import type { MissionResponse } from "@/types/mission";
import type { MissionSortKey } from "@/hooks/useMissionList";

interface MissionListTableProps {
  rows: MissionResponse[];
  totalMissions: number;
  loading: boolean;
  error: boolean;
  droneMap: Map<string, string>;
  sortKey: MissionSortKey;
  sortDir: SortDir;
  onSort: (key: MissionSortKey) => void;
  onRowClick: (mission: MissionResponse) => void;
  onDuplicate: (mission: MissionResponse) => void;
  onRename: (mission: MissionResponse) => void;
  onDelete: (mission: MissionResponse) => void;
  onRetry: () => void;
}

/** format mission duration in seconds to a human-readable string. */
function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

/** mission list table with sort, click-through, and inline row actions. */
export default function MissionListTable({
  rows,
  totalMissions,
  loading,
  error,
  droneMap,
  sortKey,
  sortDir,
  onSort,
  onRowClick,
  onDuplicate,
  onRename,
  onDelete,
  onRetry,
}: MissionListTableProps) {
  const { t } = useTranslation();

  const columns: { key: MissionSortKey; label: string }[] = [
    { key: "name", label: t("missionList.columns.name") },
    { key: "status", label: t("missionList.columns.status") },
    { key: "drone", label: t("missionList.columns.drone") },
    { key: "inspections", label: t("missionList.columns.inspections") },
    { key: "duration", label: t("missionList.columns.duration") },
    { key: "created_at", label: t("missionList.columns.created") },
    { key: "updated_at", label: t("missionList.columns.lastUpdated") },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-tv-text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-16 text-center text-sm text-tv-error">
        {t("missionList.loadError")}
        <button type="button" onClick={onRetry} className="ml-2 underline hover:no-underline">
          {t("common.retry")}
        </button>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="px-6 py-16 text-center text-sm text-tv-text-muted">
        {totalMissions === 0
          ? t("missionList.noMissions")
          : t("missionList.noMatch")}
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
        {rows.map((mission) => (
          <tr
            key={mission.id}
            onClick={() => onRowClick(mission)}
            className="border-b border-tv-border last:border-b-0 cursor-pointer
              text-sm text-tv-text-primary hover:bg-tv-surface-hover transition-colors"
            data-testid={`mission-row-${mission.id}`}
          >
            <td className="px-4 py-3 font-medium">{mission.name}</td>
            <td className="px-4 py-3">
              <Badge status={mission.status} />
            </td>
            <td className="px-4 py-3 text-tv-text-secondary">
              {(mission.drone_profile_id &&
                droneMap.get(mission.drone_profile_id)) ||
                "—"}
            </td>
            <td className="px-4 py-3 text-tv-text-secondary">
              {mission.inspection_count || "—"}
            </td>
            <td className="px-4 py-3 text-tv-text-secondary">
              {formatDuration(mission.estimated_duration)}
            </td>
            <td className="px-4 py-3 text-tv-text-secondary">
              {new Date(mission.created_at).toLocaleDateString()}
            </td>
            <td className="px-4 py-3 text-tv-text-secondary">
              {new Date(mission.updated_at).toLocaleDateString()}
            </td>
            <td className="px-4 py-3">
              <RowActionButtons
                actions={[
                  {
                    icon: Copy,
                    onClick: () => onDuplicate(mission),
                    title: t("missionList.actions.duplicate"),
                  },
                  {
                    icon: Pencil,
                    onClick: () => onRename(mission),
                    title: t("missionList.actions.rename"),
                  },
                  {
                    icon: Trash2,
                    onClick: () => onDelete(mission),
                    title: t("missionList.actions.delete"),
                    variant: "danger",
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
