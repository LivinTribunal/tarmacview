import { type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { Copy, X, ChevronDown, Search } from "lucide-react";
import type { MissionResponse } from "@/types/mission";
import type { MissionStatus } from "@/types/enums";
import Badge from "@/components/common/Badge";
import DetailSelectorItem from "@/components/common/DetailSelectorItem";

interface CompactMissionSelectorProps {
  compactSelectorRef: RefObject<HTMLDivElement>;
  compactDropdownRef: RefObject<HTMLDivElement>;
  currentMission: MissionResponse | undefined;
  selectedId: string | undefined;
  filteredMissions: MissionResponse[];
  missionDropdownOpen: boolean;
  missionSearch: string;
  compactDropdownPos: { top: number; left: number; width: number } | null;
  onActivate: () => void;
  onToggleDropdown: () => void;
  onDuplicate: () => void;
  onDeselect: () => void;
  onSearchChange: (value: string) => void;
  onMissionSwitch: (missionId: string) => void;
}

/** compact-mode mission pill selector with a portal-rendered dropdown. */
export default function CompactMissionSelector({
  compactSelectorRef,
  compactDropdownRef,
  currentMission,
  selectedId,
  filteredMissions,
  missionDropdownOpen,
  missionSearch,
  compactDropdownPos,
  onActivate,
  onToggleDropdown,
  onDuplicate,
  onDeselect,
  onSearchChange,
  onMissionSwitch,
}: CompactMissionSelectorProps) {
  const { t } = useTranslation();
  return (
    <div className="w-[30%] flex-shrink-0 flex">
      <div className="flex-1 overflow-hidden" style={{ scrollbarGutter: "stable" }}>
        <div
          ref={compactSelectorRef}
          role="button"
          tabIndex={0}
          onClick={onActivate}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onActivate();
            }
          }}
          className="flex items-center w-full px-4 h-11 rounded-full bg-tv-surface text-tv-text-primary cursor-pointer hover:bg-tv-surface-hover transition-colors"
          data-testid="mission-selector"
        >
          <span className="flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-tv-bg border border-tv-border text-tv-text-primary mr-2">
            {t("mission.label")}
          </span>
          <span className="flex-1 min-w-0 truncate text-sm font-medium">
            {currentMission?.name ?? t("mission.config.selectMission")}
          </span>
          {currentMission && (
            <Badge status={currentMission.status as MissionStatus} className="flex-shrink-0 ml-2" />
          )}
          <div className="flex items-center gap-0.5 ml-2 flex-shrink-0">
            <button type="button" onClick={(e) => { e.stopPropagation(); onDuplicate(); }} className="flex items-center justify-center h-5 w-5 rounded-full bg-tv-surface-hover text-tv-text-secondary hover:text-tv-text-primary transition-colors" title={t("mission.duplicate")}><Copy className="h-3 w-3" /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); onDeselect(); }} className="flex items-center justify-center h-5 w-5 rounded-full bg-tv-surface-hover text-tv-text-secondary hover:text-tv-text-primary transition-colors" title={t("common.close")}><X className="h-3 w-3" /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); onToggleDropdown(); }} className="p-1.5 rounded-full hover:bg-tv-surface-hover transition-colors text-tv-text-primary"><ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${missionDropdownOpen ? "rotate-180" : ""}`} /></button>
          </div>
        </div>
      </div>

      {/* compact dropdown via portal */}
      {missionDropdownOpen && compactDropdownPos && createPortal(
        <div
          ref={compactDropdownRef}
          className="fixed z-50 rounded-2xl border border-tv-border bg-tv-surface"
          style={{ top: compactDropdownPos.top, left: compactDropdownPos.left, width: compactDropdownPos.width }}
        >
          <div className="p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-tv-text-muted" />
              <input
                value={missionSearch}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={t("mission.config.searchMissions")}
                aria-label={t("mission.config.searchMissions")}
                className="w-full pl-8 pr-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filteredMissions.length === 0 ? (
              <p className="px-3 py-3 text-xs text-tv-text-muted text-center">{t("common.noResults")}</p>
            ) : (
              filteredMissions.map((m) => (
                <DetailSelectorItem
                  key={m.id}
                  isSelected={m.id === selectedId}
                  onClick={() => onMissionSwitch(m.id)}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate text-sm">{m.name}</span>
                    <Badge status={m.status as MissionStatus} className="ml-2 flex-shrink-0" />
                  </div>
                </DetailSelectorItem>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
      <div className="w-6 flex-shrink-0" />
    </div>
  );
}
