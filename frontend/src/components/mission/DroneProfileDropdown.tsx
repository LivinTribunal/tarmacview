import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Search } from "lucide-react";
import type { DroneProfileResponse } from "@/types/droneProfile";
import InfoHint from "@/components/common/InfoHint";

interface DroneProfileDropdownProps {
  droneProfiles: DroneProfileResponse[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export default function DroneProfileDropdown({
  droneProfiles,
  selectedId,
  onSelect,
}: DroneProfileDropdownProps) {
  /** compact drone profile selector with search. */
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setTimeout(() => searchRef.current?.focus(), 0);
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const selected = droneProfiles.find((dp) => dp.id === selectedId);
  const filtered = search
    ? droneProfiles.filter((dp) =>
        dp.name.toLowerCase().includes(search.toLowerCase())
        || (dp.manufacturer ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : droneProfiles;

  return (
    <div ref={ref} className="relative">
      <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
        <span>{t("mission.config.droneProfile")}</span>
        <InfoHint
          text={t("mission.config.droneProfileHelp")}
          label={t("mission.config.droneProfile")}
          testId="hint-drone-profile"
        />
      </label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full text-left px-3 py-2.5 rounded-2xl text-sm border bg-tv-bg text-tv-text-primary transition-colors ${
          open ? "border-tv-accent" : "border-tv-border hover:bg-tv-surface-hover"
        }`}
        data-testid="drone-profile-select"
      >
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate">
            {selected ? selected.name : t("mission.config.selectDrone")}
          </span>
          {selected?.manufacturer && (
            <span className="text-[10px] text-tv-text-muted flex-shrink-0">{selected.manufacturer}</span>
          )}
          <ChevronDown className={`h-4 w-4 text-tv-text-secondary flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </div>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-2xl border border-tv-border bg-tv-surface z-50">
          <div className="p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-tv-text-muted" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("mission.config.searchDrone")}
                aria-label={t("mission.config.searchDrone")}
                className="w-full pl-8 pr-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
              />
            </div>
          </div>
          <div className="max-h-[240px] overflow-y-auto">
            {selectedId && (
              <button
                type="button"
                onClick={() => { onSelect(""); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs text-tv-text-muted hover:bg-tv-surface-hover transition-colors"
              >
                {t("mission.config.selectDrone")}
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-xs text-tv-text-muted text-center italic">
                {t("common.noResults")}
              </p>
            ) : (
              filtered.map((dp) => {
                const isSelected = dp.id === selectedId;
                return (
                  <button
                    key={dp.id}
                    type="button"
                    onClick={() => { onSelect(dp.id); setOpen(false); }}
                    className={`w-full text-left px-3 py-2.5 transition-colors ${
                      isSelected ? "bg-tv-accent text-tv-accent-text" : "hover:bg-tv-surface-hover"
                    }`}
                  >
                    <span className={`text-sm truncate block ${isSelected ? "font-medium" : "text-tv-text-primary"}`}>
                      {dp.name}
                    </span>
                    <div className={`flex items-center gap-3 text-[10px] mt-0.5 ${isSelected ? "text-tv-accent-text/70" : "text-tv-text-muted"}`}>
                      {dp.manufacturer && <span>{dp.manufacturer}</span>}
                      {dp.endurance_minutes != null && <span>{dp.endurance_minutes} min</span>}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
