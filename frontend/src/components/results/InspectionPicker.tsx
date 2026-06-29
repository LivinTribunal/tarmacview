import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type { InspectionResponse } from "@/types/mission";
import type { InspectionTemplateResponse } from "@/types/inspectionTemplate";
import type { MeasurementListItem } from "@/types/measurement";
import { methodBadgeStyle } from "@/utils/inspectionMethodBadge";
import MeasurementStatusChip from "./MeasurementStatusChip";

interface InspectionPickerProps {
  inspections: InspectionResponse[];
  templates: Map<string, InspectionTemplateResponse>;
  // latest measurement run per inspection id
  measurementByInspection: Map<string, MeasurementListItem>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/** read-only single-select inspection list with a per-row measurement result tag. */
export default function InspectionPicker({
  inspections,
  templates,
  measurementByInspection,
  selectedId,
  onSelect,
}: InspectionPickerProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  const sorted = inspections
    .slice()
    .sort((a, b) => a.sequence_order - b.sequence_order);

  return (
    <div data-testid="results-inspection-picker">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setCollapsed(!collapsed)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCollapsed(!collapsed);
          }
        }}
      >
        <span className="text-sm font-semibold text-tv-text-primary flex items-center gap-2">
          <span className="rounded-full px-3 py-1 bg-tv-bg border border-tv-border">
            {t("mission.config.inspections")}
          </span>
          <span className="flex items-center justify-center min-w-[1.5rem] h-6 rounded-full px-1.5 text-xs font-semibold bg-tv-accent text-tv-accent-text">
            {inspections.length}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 text-tv-text-primary transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`}
        />
      </div>
      {!collapsed && <div className="border-b border-tv-border -mx-4 mt-3" />}

      {!collapsed && sorted.length === 0 && (
        <p className="text-sm text-tv-text-muted py-4 text-center">
          {t("mission.config.noInspectionSelected")}
        </p>
      )}

      {!collapsed && (
        <div className="space-y-1 mt-2 max-h-72 overflow-y-auto">
          {sorted.map((insp, idx) => {
            const template = templates.get(insp.template_id);
            const meas = measurementByInspection.get(insp.id);
            const selectable = meas?.status === "DONE";
            const isSelected = selectedId === insp.id;

            return (
              <div
                key={insp.id}
                role="button"
                tabIndex={selectable ? 0 : -1}
                aria-disabled={!selectable}
                onClick={
                  selectable
                    ? () => onSelect(isSelected ? null : insp.id)
                    : undefined
                }
                onKeyDown={
                  selectable
                    ? (e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelect(isSelected ? null : insp.id);
                        }
                      }
                    : undefined
                }
                className={`flex items-center gap-2 px-3 py-2 rounded-2xl text-sm transition-colors border ${
                  isSelected
                    ? "border-tv-accent bg-tv-surface"
                    : "border-transparent hover:bg-tv-surface-hover"
                } ${selectable ? "cursor-pointer" : "opacity-50 cursor-not-allowed"}`}
                data-testid={`results-inspection-row-${insp.id}`}
              >
                <span className="flex items-center justify-center h-5 w-5 rounded-full bg-tv-accent/20 text-tv-accent text-xs font-semibold flex-shrink-0">
                  {idx + 1}
                </span>

                <span className="flex-1 text-tv-text-primary truncate">
                  {template?.name ?? insp.template_id.slice(0, 8)}
                </span>

                <span
                  className="flex-shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium leading-none"
                  style={methodBadgeStyle(insp.method)}
                >
                  {t(`map.inspectionMethodShort.${insp.method}`, insp.method)}
                </span>

                {/* result tag */}
                {meas?.status === "DONE" ? (
                  <span className="flex items-center gap-1 flex-shrink-0">
                    <MeasurementStatusChip status="DONE" size="sm" />
                    <span className="text-xs text-tv-text-secondary">
                      {meas.pass_count}/{meas.pass_count + meas.fail_count}
                    </span>
                  </span>
                ) : meas ? (
                  <MeasurementStatusChip status={meas.status} size="sm" />
                ) : (
                  <span className="flex-shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium text-tv-text-muted bg-tv-surface-hover">
                    {t("results.picker.notMeasured")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
