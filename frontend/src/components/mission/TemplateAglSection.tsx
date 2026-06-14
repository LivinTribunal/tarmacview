import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import InfoHint from "@/components/common/InfoHint";
import type { AGLResponse, SurfaceResponse } from "@/types/airport";
import type {
  LhaSelectionMode,
  LhaSelectionRule,
} from "@/types/mission";
import { formatAglDisplayName } from "@/utils/agl";
import {
  resolveLhaSelection,
  surfaceSupportsFromThreshold,
} from "@/utils/resolveLhaSelection";
import LhaFromThresholdSelector from "./LhaFromThresholdSelector";
import LhaRangeSelector from "./LhaRangeSelector";
import LhaSelectionModeToggle from "./LhaSelectionModeToggle";

const MIN_LHAS_FOR_TOGGLE = 5;
const DEFAULT_FROM_THRESHOLD_DISTANCE_M = 100;

interface TemplateAglSectionProps {
  agl: AGLResponse | null;
  surface?: SurfaceResponse | null;
  selectedLhaIds: Set<string>;
  onSelectionChange: (lhaIds: Set<string>) => void;
  isEditing: boolean;
  rule?: LhaSelectionRule;
  onRuleChange?: (rule: LhaSelectionRule) => void;
}

const DEFAULT_RULE: LhaSelectionRule = { mode: "CUSTOM" };

function ruleForMode(
  mode: LhaSelectionMode,
  prev: LhaSelectionRule,
): LhaSelectionRule {
  switch (mode) {
    case "ALL":
      return { mode: "ALL" };
    case "RANGE":
      return {
        mode: "RANGE",
        params:
          prev.mode === "RANGE"
            ? { ...prev.params }
            : { from: null, to: null },
      };
    case "FROM_THRESHOLD":
      return {
        mode: "FROM_THRESHOLD",
        params:
          prev.mode === "FROM_THRESHOLD"
            ? { ...prev.params }
            : { threshold: "START", distance_m: DEFAULT_FROM_THRESHOLD_DISTANCE_M },
      };
    case "CUSTOM":
      return { mode: "CUSTOM" };
  }
}

export default function TemplateAglSection({
  agl,
  surface,
  selectedLhaIds,
  onSelectionChange,
  isEditing,
  rule,
  onRuleChange,
}: TemplateAglSectionProps) {
  /** collapsible AGL block with LHA selection by rule mode or manual checkboxes. */
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  // sort by sequence_number for stable display + range references
  const sortedLhas = useMemo(
    () => (agl?.lhas ?? []).slice().sort((a, b) => a.sequence_number - b.sequence_number),
    [agl?.lhas],
  );

  if (!agl) {
    return (
      <p className="text-sm text-tv-text-muted">{t("airport.noAglSystems")}</p>
    );
  }

  const showToggle = agl.lhas.length >= MIN_LHAS_FOR_TOGGLE && Boolean(onRuleChange);
  const effectiveRule = rule ?? DEFAULT_RULE;
  const fromThresholdAvailable = surfaceSupportsFromThreshold(surface);

  const allSelected =
    agl.lhas.length > 0 && agl.lhas.every((lha) => selectedLhaIds.has(lha.id));

  function toggleLha(lhaId: string) {
    const next = new Set(selectedLhaIds);
    if (next.has(lhaId)) {
      next.delete(lhaId);
    } else {
      next.add(lhaId);
    }
    onSelectionChange(next);
  }

  function handleSelectAll() {
    onSelectionChange(new Set(agl!.lhas.map((l) => l.id)));
  }

  function handleDeselectAll() {
    onSelectionChange(new Set());
  }

  function handleModeChange(nextMode: LhaSelectionMode) {
    if (!onRuleChange) return;
    const next = ruleForMode(nextMode, effectiveRule);
    onRuleChange(next);
    if (nextMode === "CUSTOM") {
      // custom inherits the current selection - no change to onSelectionChange
      return;
    }
    const resolved = resolveLhaSelection(next, agl!, surface ?? null);
    if (resolved !== null) {
      onSelectionChange(resolved);
    }
  }

  function handleRuleParamsChange(next: LhaSelectionRule) {
    if (!onRuleChange) return;
    onRuleChange(next);
    const resolved = resolveLhaSelection(next, agl!, surface ?? null);
    if (resolved !== null) {
      onSelectionChange(resolved);
    }
  }

  const checkboxesDisabled =
    !isEditing || (showToggle && effectiveRule.mode !== "CUSTOM");

  return (
    <div data-testid={`template-agl-section-${agl.id}`}>
      <div className="flex w-full items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex flex-1 items-center gap-2 text-left min-w-0"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-tv-text-secondary flex-shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-tv-text-secondary flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <span className="text-sm font-semibold text-tv-text-primary">
              {formatAglDisplayName(agl)}
            </span>
            <span className="ml-2 text-xs text-tv-text-secondary">
              {agl.agl_type}
            </span>
          </div>
          <span
            className="text-xs text-tv-text-muted"
            data-testid={`template-agl-section-count-${agl.id}`}
          >
            {t("mission.config.lhaSelection.headerCount", {
              selected: selectedLhaIds.size,
              total: agl.lhas.length,
            })}
          </span>
        </button>
        <InfoHint
          text={t("mission.config.lhaSelection.titleHelp")}
          label={formatAglDisplayName(agl)}
          testId={`hint-template-agl-section-${agl.id}`}
        />
      </div>

      {expanded && (
        <div className="mt-2 ml-6">
          {showToggle && (
            <div className="mb-2">
              <LhaSelectionModeToggle
                mode={effectiveRule.mode}
                onChange={handleModeChange}
                disabled={!isEditing}
                fromThresholdAvailable={fromThresholdAvailable}
              />
              {effectiveRule.mode === "RANGE" && (
                <LhaRangeSelector
                  params={effectiveRule.params}
                  disabled={!isEditing}
                  onChange={(params) =>
                    handleRuleParamsChange({ mode: "RANGE", params })
                  }
                />
              )}
              {effectiveRule.mode === "FROM_THRESHOLD" && (
                <LhaFromThresholdSelector
                  params={effectiveRule.params}
                  available={fromThresholdAvailable}
                  disabled={!isEditing}
                  onChange={(params) =>
                    handleRuleParamsChange({ mode: "FROM_THRESHOLD", params })
                  }
                />
              )}
            </div>
          )}

          {(effectiveRule.mode === "CUSTOM" || !showToggle) &&
            isEditing &&
            agl.lhas.length > 1 && (
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={allSelected ? handleDeselectAll : handleSelectAll}
                  className="text-xs text-tv-accent hover:underline"
                  data-testid={`template-agl-select-all-${agl.id}`}
                >
                  {allSelected
                    ? t("coordinator.inspections.deselectAll")
                    : t("coordinator.inspections.selectAll")}
                </button>
              </div>
            )}
          <div className="flex flex-col gap-1.5">
            {sortedLhas.map((lha) => (
              <label
                key={lha.id}
                className="flex items-center gap-2 text-sm cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedLhaIds.has(lha.id)}
                  onChange={() => toggleLha(lha.id)}
                  disabled={checkboxesDisabled}
                  className="rounded accent-tv-accent"
                  data-testid={`template-agl-lha-checkbox-${lha.id}`}
                />
                <span className="text-tv-text-muted text-xs">
                  #{lha.sequence_number}
                </span>
                <span className="text-tv-text-primary">
                  {t("coordinator.inspections.lhaUnit", {
                    designator: lha.unit_designator,
                  })}
                </span>
                <span className="text-tv-text-muted text-xs">
                  {lha.setting_angle?.toFixed(2) ?? "—"}&deg;
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
