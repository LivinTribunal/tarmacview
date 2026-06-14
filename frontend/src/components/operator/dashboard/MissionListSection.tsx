import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Layers, Clock, Map, Download, Copy, Pencil, Trash2 } from "lucide-react";
import { updateMission, deleteMission, duplicateMission } from "@/api/missions";
import type { MissionResponse } from "@/types/mission";
import type { DroneProfileResponse } from "@/types/droneProfile";
import CollapsibleSection from "@/components/common/CollapsibleSection";
import Badge from "@/components/common/Badge";
import RowActionButtons from "@/components/common/RowActionButtons";
import { formatDuration } from "@/utils/format";
import Spinner from "./Spinner";

const isTerminal = (status: string) => status === "COMPLETED" || status === "CANCELLED";

export default function MissionListSection({
  missions,
  loading,
  error,
  onRetry,
  onRefresh,
  droneProfiles,
  headerRight,
}: {
  missions: MissionResponse[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onRefresh: () => void;
  droneProfiles: DroneProfileResponse[];
  headerRight?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search) return missions;
    const q = search.toLowerCase();
    return missions.filter((m) => m.name.toLowerCase().includes(q));
  }, [missions, search]);

  async function handleDuplicate(mission: MissionResponse) {
    /** duplicate a mission and refresh the list. */
    try {
      await duplicateMission(mission.id);
      onRefresh();
    } catch (err) {
      console.error("duplicate mission failed:", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRename(missionId: string) {
    /** rename a mission and refresh the list. */
    if (!renameValue.trim()) return;
    try {
      await updateMission(missionId, { name: renameValue.trim() });
      setRenamingId(null);
      onRefresh();
    } catch (err) {
      console.error("rename mission failed:", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(missionId: string) {
    /** delete a mission and refresh the list. */
    try {
      await deleteMission(missionId);
      setDeletingId(null);
      onRefresh();
    } catch (err) {
      console.error("delete mission failed:", err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <CollapsibleSection title={t("dashboard.missions")} count={missions.length} headerRight={headerRight}>
      {/* search */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-tv-accent flex-shrink-0">
          <svg className="h-4 w-4 text-tv-accent-text" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("dashboard.searchMissions")}
          aria-label={t("dashboard.searchMissions")}
          className="flex-1 rounded-full border border-tv-border bg-tv-bg px-4 py-2 text-xs
            text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent"
          data-testid="mission-search"
        />
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="text-center text-xs text-tv-error py-4">
          {t("dashboard.loadError")}
          <button type="button" onClick={onRetry} className="ml-2 underline hover:no-underline">
            {t("common.retry")}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-xs text-tv-text-muted py-4">
          {t("dashboard.noMissions")}
        </p>
      ) : (
        <div className="space-y-2 max-h-[360px] overflow-y-auto">
          {filtered.map((mission) => {
            const drone = droneProfiles.find(
              (dp) => dp.id === mission.drone_profile_id,
            );
            const terminal = isTerminal(mission.status);
            return (
              <div key={mission.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/operator-center/missions/${mission.id}/overview`)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(`/operator-center/missions/${mission.id}/overview`);
                    }
                  }}
                  className="w-full text-left rounded-xl border border-tv-border bg-tv-bg p-3
                    hover:bg-tv-surface-hover transition-colors cursor-pointer"
                  data-testid={`mission-row-${mission.id}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-tv-text-primary truncate mr-2">
                      {mission.name}
                    </span>
                    <div className="flex items-center gap-1">
                      <RowActionButtons
                        actions={[
                          {
                            icon: Map,
                            onClick: () => navigate(`/operator-center/missions/${mission.id}/map`),
                            title: t("dashboard.mapAction"),
                          },
                          {
                            icon: Download,
                            onClick: () => navigate(`/operator-center/missions/${mission.id}/validation-export`),
                            disabled: terminal,
                            title: t("dashboard.exportAction"),
                          },
                          {
                            icon: Copy,
                            onClick: () => handleDuplicate(mission),
                            title: t("dashboard.duplicateAction"),
                          },
                          {
                            icon: Pencil,
                            onClick: () => { setRenamingId(mission.id); setRenameValue(mission.name); },
                            title: t("dashboard.renameAction"),
                          },
                          {
                            icon: Trash2,
                            onClick: () => setDeletingId(mission.id),
                            disabled: terminal,
                            variant: "danger",
                            title: t("dashboard.deleteAction"),
                          },
                        ]}
                      />
                      <Badge status={mission.status} />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-tv-text-secondary">
                    <span>{drone ? drone.name : t("dashboard.noDrone")}</span>
                    <span className="flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5" style={{ color: "var(--tv-text-muted)" }} />
                      {mission.inspection_count}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" style={{ color: "var(--tv-text-muted)" }} />
                      {mission.estimated_duration != null ? formatDuration(mission.estimated_duration) : "—"}
                    </span>
                    <span className="ml-auto flex items-center gap-1">
                      <span className="text-xs" style={{ color: "var(--tv-text-muted)" }}>{t("dashboard.lastSaved")}</span>
                      <span className="text-xs" style={{ color: "var(--tv-text-secondary)" }}>{new Date(mission.updated_at).toLocaleDateString()}</span>
                    </span>
                  </div>
                </div>

                {/* rename dialog */}
                {renamingId === mission.id && (
                  <div className="mt-1 p-2 rounded-xl border border-tv-border bg-tv-surface flex items-center gap-2">
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleRename(mission.id); if (e.key === "Escape") setRenamingId(null); }}
                      className="flex-1 rounded-full border border-tv-border bg-tv-bg px-3 py-1 text-xs text-tv-text-primary focus:outline-none focus:border-tv-accent"
                      placeholder={t("dashboard.renamePlaceholder")}
                      aria-label={t("dashboard.renamePlaceholder")}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => handleRename(mission.id)}
                      className="rounded-full px-3 py-1 text-xs font-medium bg-tv-accent text-tv-accent-text"
                    >
                      {t("common.save")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                      className="rounded-full px-3 py-1 text-xs font-medium text-tv-text-secondary hover:text-tv-text-primary"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                )}

                {/* delete confirmation */}
                {deletingId === mission.id && (
                  <div className="mt-1 p-2 rounded-xl border border-tv-error/30 bg-tv-surface flex items-center gap-2">
                    <span className="flex-1 text-xs text-tv-text-primary">
                      {t("dashboard.deleteConfirm", { name: mission.name })}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDelete(mission.id)}
                      className="rounded-full px-3 py-1 text-xs font-medium bg-tv-error text-white"
                    >
                      {t("common.delete")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingId(null)}
                      className="rounded-full px-3 py-1 text-xs font-medium text-tv-text-secondary hover:text-tv-text-primary"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </CollapsibleSection>
  );
}
