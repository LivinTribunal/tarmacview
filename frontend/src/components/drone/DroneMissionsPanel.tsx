import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import Badge from "@/components/common/Badge";
import { formatDate } from "@/utils/format";
import type { MissionResponse } from "@/types/mission";
import type { MissionStatus } from "@/types/enums";

interface DroneMissionsPanelProps {
  missions: MissionResponse[];
  expanded: boolean;
  onToggle: () => void;
  headerLabel?: string;
  emptyLabel?: string;
  emptyItalic?: boolean;
  onMissionClick?: (mission: MissionResponse) => void;
  renderSubtitle?: (mission: MissionResponse) => ReactNode;
  maxHeightClass?: string;
}

/** collapsible panel listing missions that use the selected drone. */
export default function DroneMissionsPanel({
  missions,
  expanded,
  onToggle,
  headerLabel,
  emptyLabel,
  emptyItalic = false,
  onMissionClick,
  renderSubtitle,
  maxHeightClass = "max-h-60",
}: DroneMissionsPanelProps) {
  const { t } = useTranslation();

  const heading = headerLabel ?? t("coordinator.drones.detail.missions");
  const emptyText = emptyLabel ?? t("coordinator.drones.detail.noMissions");

  const subtitleFn =
    renderSubtitle ??
    ((m: MissionResponse) => (
      <>
        {t("coordinator.drones.detail.created")}{" "}
        {formatDate(m.created_at)}
        {" · "}
        {t("coordinator.drones.detail.updated")}{" "}
        {formatDate(m.updated_at)}
      </>
    ));

  return (
    <div className="bg-tv-surface border border-tv-border rounded-2xl flex flex-col min-h-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-between w-full px-4 py-3 flex-shrink-0"
        data-testid="missions-panel-toggle"
      >
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-tv-bg px-3 py-1 text-xs font-medium text-tv-text-secondary uppercase tracking-wider">
            {heading}
          </span>
          <span className="rounded-full bg-tv-accent text-tv-accent-text px-2 py-0.5 text-xs font-semibold">
            {missions.length}
          </span>
        </div>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-3 min-h-0">
          {missions.length === 0 ? (
            <p
              className={`text-sm text-tv-text-muted${emptyItalic ? " italic" : ""} py-2`}
            >
              {emptyText}
            </p>
          ) : (
            <div className={`flex flex-col gap-1 ${maxHeightClass} overflow-y-auto`}>
              {missions.map((m) => {
                const rowContent = (
                  <>
                    <div className="min-w-0">
                      <span className="block text-sm font-medium text-tv-text-primary truncate">
                        {m.name}
                      </span>
                      <span className="block text-xs text-tv-text-muted">
                        {subtitleFn(m)}
                      </span>
                    </div>
                    <Badge
                      status={m.status as MissionStatus}
                      className="flex-shrink-0 ml-2"
                    />
                  </>
                );
                const baseClass = "flex items-center justify-between rounded-xl px-3 py-2 bg-tv-bg";
                return onMissionClick ? (
                  <div
                    key={m.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onMissionClick(m)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onMissionClick(m);
                      }
                    }}
                    className={`${baseClass} hover:bg-tv-surface-hover cursor-pointer transition-colors`}
                  >
                    {rowContent}
                  </div>
                ) : (
                  <div key={m.id} className={baseClass}>
                    {rowContent}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
