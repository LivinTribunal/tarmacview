import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2, Upload, FileText } from "lucide-react";
import { MS_PER_DAY } from "@/constants/ui";
import type { SaveContext, ComputeContext } from "./MissionTabNav";

/** format a save timestamp as a localized today / yesterday / dated string. */
function formatSavedTime(date: Date, t: (key: string, opts?: Record<string, string>) => string): string {
  const now = new Date();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const time = `${hh}:${mm}`;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const saved = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.floor((today.getTime() - saved.getTime()) / MS_PER_DAY);
  if (diff === 0) return t("mission.config.savedToday", { time });
  if (diff === 1) return t("mission.config.savedYesterday", { time });
  const dd = String(date.getDate()).padStart(2, "0");
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  return t("mission.config.savedOn", { date: `${dd}.${mo}.`, time });
}

interface MissionActionBarProps {
  missionId: string | undefined;
  saveCtx: SaveContext;
  computeCtx: ComputeContext;
}

/** mission tab strip with compute, save, and last-saved indicator. */
export default function MissionActionBar({ missionId, saveCtx, computeCtx }: MissionActionBarProps) {
  const { t } = useTranslation();

  const tabs = [
    { label: t("mission.overviewTab"), path: "overview" },
    { label: t("mission.configuration"), path: "configuration" },
    { label: t("mission.map"), path: "map" },
    { label: t("mission.validationExport"), path: "validation-export" },
    { label: t("mission.results"), path: "results" },
  ];

  const showSave = saveCtx.onSave !== null;
  const showCompute = computeCtx.onCompute !== null;

  return (
    <div className="flex-1 flex items-center gap-4 min-w-0">
      <div
        className="flex flex-1 items-center justify-center gap-1 rounded-full bg-tv-surface p-1 h-11"
        data-testid="mission-tabs"
      >
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={`/operator-center/missions/${missionId}/${tab.path}`}
            className={({ isActive }) =>
              `px-5 h-9 rounded-full text-sm font-medium transition-colors flex items-center ${
                isActive
                  ? "bg-tv-nav-active-bg text-tv-nav-active-text"
                  : "text-tv-text-primary hover:bg-tv-surface-hover"
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      {showCompute && (
        <button
          type="button"
          onClick={() => computeCtx.onCompute?.()}
          disabled={!computeCtx.canCompute || computeCtx.isComputing}
          title={!computeCtx.canCompute && !computeCtx.isComputing ? (computeCtx.tooltip ?? t("mission.config.recomputeTooltip")) : undefined}
          className={`flex items-center justify-center gap-2 w-[280px] flex-shrink-0 h-11 rounded-full text-sm font-semibold transition-colors whitespace-nowrap ${
            computeCtx.variant === "secondary"
              ? "border border-tv-border bg-tv-surface text-tv-text-primary hover:bg-tv-surface-hover"
              : computeCtx.isComputing
                ? "bg-tv-accent-busy text-tv-accent-text cursor-not-allowed"
                : !computeCtx.canCompute
                  ? "bg-tv-surface text-tv-text-muted opacity-50 cursor-not-allowed"
                  : "bg-tv-accent text-tv-accent-text hover:bg-tv-accent-hover"
          }`}
          data-testid="compute-trajectory-btn"
        >
          {computeCtx.isComputing && <Loader2 className="h-4 w-4 animate-spin" />}
          {!computeCtx.isComputing && computeCtx.icon === "upload" && <Upload className="h-4 w-4" />}
          {!computeCtx.isComputing && computeCtx.icon === "file" && <FileText className="h-4 w-4" />}
          {computeCtx.isComputing ? t("mission.config.computing") : computeCtx.label ?? t("mission.config.computeTrajectory")}
        </button>
      )}

      {showSave && (
        <button
          type="button"
          onClick={() => saveCtx.onSave?.()}
          disabled={!saveCtx.isDirty || saveCtx.isSaving}
          className={`rounded-full px-4 h-11 min-w-[81px] flex-shrink-0 text-sm font-semibold transition-colors border ${
            saveCtx.isDirty && !saveCtx.isSaving
              ? "border-tv-accent bg-tv-surface text-tv-accent hover:bg-tv-accent hover:text-tv-accent-text"
              : "border-tv-border bg-tv-surface text-tv-text-muted cursor-not-allowed"
          }`}
          data-testid="save-button"
        >
          {saveCtx.isSaving ? t("mission.config.saving") : t("mission.config.save")}
        </button>
      )}

      <div className="w-[140px] flex-shrink-0">
        <span className="flex items-center justify-center rounded-full px-4 h-11 text-xs text-tv-text-muted whitespace-nowrap">
          {saveCtx.lastSaved ? formatSavedTime(saveCtx.lastSaved, t) : t("mission.config.notSavedYet")}
        </span>
      </div>
    </div>
  );
}
