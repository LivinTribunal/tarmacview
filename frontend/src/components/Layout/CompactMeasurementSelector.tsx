import { type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { Pencil, Trash2, X, ChevronDown, Search } from "lucide-react";
import type { MeasurementListItem } from "@/types/measurement";
import DetailSelectorItem from "@/components/common/DetailSelectorItem";

interface CompactMeasurementSelectorProps {
  selectorRef: RefObject<HTMLDivElement>;
  dropdownRef: RefObject<HTMLDivElement>;
  dropdownPos: { top: number; left: number; width: number } | null;
  currentRow: MeasurementListItem | null;
  count: number;
  selectedId: string | undefined;
  filteredMeasurements: MeasurementListItem[];
  dropdownOpen: boolean;
  search: string;
  displayLabel: (row: MeasurementListItem) => string;
  onToggleDropdown: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDeselect: () => void;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
}

/** compact-mode measurement pill selector with inline rename/delete/deselect and a portal dropdown. */
export default function CompactMeasurementSelector({
  selectorRef,
  dropdownRef,
  dropdownPos,
  currentRow,
  count,
  selectedId,
  filteredMeasurements,
  dropdownOpen,
  search,
  displayLabel,
  onToggleDropdown,
  onRename,
  onDelete,
  onDeselect,
  onSearchChange,
  onSelect,
}: CompactMeasurementSelectorProps) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 min-w-0 flex">
      <div className="flex-1 overflow-hidden" style={{ scrollbarGutter: "stable" }}>
        <div
          ref={selectorRef}
          role="button"
          tabIndex={0}
          onClick={onToggleDropdown}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggleDropdown();
            }
          }}
          className="flex items-center w-full px-4 h-11 rounded-full bg-tv-surface text-tv-text-primary cursor-pointer hover:bg-tv-surface-hover transition-colors"
          data-testid="measurement-selector"
        >
          <span className="flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold bg-tv-bg border border-tv-border text-tv-text-primary mr-2">
            {t("measurement.label")}
          </span>
          <span className="flex-shrink-0 flex items-center justify-center min-w-[1.5rem] h-6 rounded-full px-1.5 text-xs font-semibold bg-tv-accent text-tv-accent-text mr-2">
            {count}
          </span>
          <span className="flex-1 min-w-0 truncate text-sm font-medium">
            {currentRow ? displayLabel(currentRow) : t("measurement.selectMeasurement")}
          </span>
          {currentRow && (
            <div className="flex items-center gap-0.5 ml-2 flex-shrink-0">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRename(); }}
                className="flex items-center justify-center h-5 w-5 rounded-full bg-tv-surface-hover text-tv-text-secondary hover:text-tv-text-primary transition-colors"
                title={t("measurementsList.actions.rename")}
                data-testid="rename-measurement-btn"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="flex items-center justify-center h-5 w-5 rounded-full bg-tv-surface-hover text-tv-text-secondary hover:text-tv-error transition-colors"
                title={t("measurementsList.actions.delete")}
                data-testid="delete-measurement-btn"
              >
                <Trash2 className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDeselect(); }}
                className="flex items-center justify-center h-5 w-5 rounded-full bg-tv-surface-hover text-tv-text-secondary hover:text-tv-text-primary transition-colors"
                title={t("common.close")}
                data-testid="deselect-measurement-btn"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleDropdown(); }}
            className="p-1.5 ml-0.5 flex-shrink-0 rounded-full hover:bg-tv-surface-hover transition-colors text-tv-text-primary"
            aria-label={t("measurement.label")}
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* compact dropdown via portal */}
      {dropdownOpen && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-50 rounded-2xl border border-tv-border bg-tv-surface"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
        >
          <div className="p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-tv-text-muted" />
              <input
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={t("measurement.searchPlaceholder")}
                aria-label={t("measurement.searchPlaceholder")}
                className="w-full pl-8 pr-3 py-1.5 rounded-full text-xs border border-tv-border bg-tv-bg text-tv-text-primary placeholder:text-tv-text-muted focus:outline-none focus:border-tv-accent transition-colors"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filteredMeasurements.length === 0 ? (
              <p className="px-3 py-3 text-xs text-tv-text-muted text-center">{t("common.noResults")}</p>
            ) : (
              filteredMeasurements.map((m) => (
                <DetailSelectorItem
                  key={m.id}
                  isSelected={m.id === selectedId}
                  onClick={() => onSelect(m.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm">{displayLabel(m)}</span>
                    <span className="ml-2 flex-shrink-0 text-xs text-tv-text-muted">
                      {t("measurementsList.passFail", { pass: m.pass_count, fail: m.fail_count })}
                    </span>
                  </div>
                </DetailSelectorItem>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
