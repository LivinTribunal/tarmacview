import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type {
  InspectionResponse,
  InspectionConfigOverride,
  LhaSelectionRule,
  LhaSelectionRules,
} from "@/types/mission";
import type { AGLResponse, SurfaceResponse } from "@/types/airport";
import { formatAglDisplayName } from "@/utils/agl";
import { formatNumber } from "@/utils/format";
import { methodCaps } from "@/utils/methodAglCompatibility";
import InfoHint from "@/components/common/InfoHint";
import FormSection from "@/components/common/FormSection";
import TemplateAglSection from "@/components/mission/TemplateAglSection";

interface LhaSelectionSectionProps {
  inspection: InspectionResponse;
  agls: AGLResponse[];
  surfaces?: SurfaceResponse[];
  targetAgls: AGLResponse[];
  selectedLhaIds: Set<string>;
  selectedLhaId: string | null;
  hoverAglId: string;
  setHoverAglId: (id: string) => void;
  hoverAgl: AGLResponse | null;
  lhaSelectionOpen: boolean;
  setLhaSelectionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  configOverride: InspectionConfigOverride;
  onChange: (override: InspectionConfigOverride) => void;
  onToggleLha: (lhaId: string) => void;
  onSelectionForAglChange?: (aglId: string, lhaIds: Set<string>) => void;
  lhaSelectionRules?: LhaSelectionRules;
  onLhaSelectionRulesChange?: (rules: LhaSelectionRules) => void;
  disabled: boolean;
}

export default function LhaSelectionSection({
  inspection,
  agls,
  surfaces,
  targetAgls,
  selectedLhaIds,
  selectedLhaId,
  hoverAglId,
  setHoverAglId,
  hoverAgl,
  lhaSelectionOpen,
  setLhaSelectionOpen,
  configOverride,
  onChange,
  onToggleLha,
  onSelectionForAglChange,
  lhaSelectionRules,
  onLhaSelectionRulesChange,
  disabled,
}: LhaSelectionSectionProps) {
  /** lha-selection section: hover-point-lock agl/lha picker + per-agl template selection list. */
  const { t } = useTranslation();
  const lhaSelectionToggle = useMemo(
    () =>
      inspection.method !== "HOVER_POINT_LOCK" && targetAgls.length > 0 ? (
        <button
          type="button"
          onClick={() => setLhaSelectionOpen((v) => !v)}
          aria-expanded={lhaSelectionOpen}
          className="rounded-full p-1 hover:bg-tv-surface-hover transition-colors"
          data-testid="lha-selection-toggle"
          aria-label={t("mission.config.lhaSelection.title")}
        >
          <ChevronDown
            className={`h-4 w-4 text-tv-text-secondary transition-transform duration-200 ${lhaSelectionOpen ? "rotate-180" : ""}`}
          />
        </button>
      ) : undefined,
    [inspection.method, targetAgls.length, setLhaSelectionOpen, lhaSelectionOpen, t],
  );
  // surface-targeting methods (surface scan) pick a surface, not LHAs - no LHA
  // selection UI for them.
  if (
    methodCaps(inspection.method).target === "SURFACE" ||
    !(
      inspection.method === "HOVER_POINT_LOCK" ||
      (inspection.method !== "MEHT_CHECK" && targetAgls.length > 0)
    )
  ) {
    return null;
  }
  return (
    <FormSection
      title={t("mission.config.sections.lhaSelection")}
      hint={t("mission.config.lhaSelection.titleHelp")}
      testId="section-lha-selection"
      meta={lhaSelectionToggle}
    >
      {inspection.method === "HOVER_POINT_LOCK" && (
        <div className="grid grid-cols-2 gap-2" data-testid="hover-point-lock-target">
          <div>
            <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
              <span>{t("mission.config.targetAgl")}</span>
              <InfoHint
                text={t("mission.config.targetAglHelp")}
                label={t("mission.config.targetAgl")}
                testId="hint-inspection-target-agl"
              />
            </label>
            <select
              value={hoverAglId}
              onChange={(e) => {
                setHoverAglId(e.target.value);
                onChange({ ...configOverride, selected_lha_id: null });
              }}
              className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors"
              data-testid="inspection-hover-agl"
            >
              <option value="">{t("mission.config.targetAglSelect")}</option>
              {agls.map((agl) => (
                <option key={agl.id} value={agl.id}>
                  {formatAglDisplayName(agl)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="flex items-center gap-1 text-xs font-medium mb-1 text-tv-text-secondary">
              <span>{t("mission.config.targetLha")}</span>
              <InfoHint
                text={t("mission.config.targetLhaHelp")}
                label={t("mission.config.targetLha")}
                testId="hint-inspection-target-lha"
              />
            </label>
            <select
              value={selectedLhaId ?? ""}
              disabled={!hoverAgl}
              onChange={(e) => {
                const v = e.target.value || null;
                onChange({ ...configOverride, selected_lha_id: v });
              }}
              className="w-full px-3 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors disabled:opacity-50"
              data-testid="inspection-selected-lha"
            >
              <option value="">{t("mission.config.targetLhaSelect")}</option>
              {hoverAgl?.lhas.map((lha) => (
                <option key={lha.id} value={lha.id}>
                  {t("mission.config.unitDesignator")} {lha.unit_designator}
                  {lha.setting_angle != null ? ` (${formatNumber(lha.setting_angle, 1)}°)` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {inspection.method !== "HOVER_POINT_LOCK" && targetAgls.length > 0 && (
        <div data-testid="lha-selection-section">
          {lhaSelectionOpen && (
          <div className="space-y-3 max-h-72 overflow-y-auto">
            {targetAgls.map((agl) => {
              const aglLhaIds = new Set(agl.lhas.map((l) => l.id));
              const aglSelected = new Set(
                Array.from(selectedLhaIds).filter((id) => aglLhaIds.has(id)),
              );
              const surface =
                (surfaces ?? []).find((s) => s.id === agl.surface_id) ?? null;
              const rule = lhaSelectionRules?.[agl.id];
              return (
                <TemplateAglSection
                  key={agl.id}
                  agl={agl}
                  surface={surface}
                  selectedLhaIds={aglSelected}
                  isEditing={!disabled}
                  rule={rule}
                  onSelectionChange={(nextSet) => {
                    if (onSelectionForAglChange) {
                      onSelectionForAglChange(agl.id, nextSet);
                      return;
                    }
                    // fallback: reduce to per-id toggles so the parent can
                    // diff against its current state.
                    for (const id of aglLhaIds) {
                      const wasSelected = aglSelected.has(id);
                      const willBeSelected = nextSet.has(id);
                      if (wasSelected !== willBeSelected) {
                        onToggleLha(id);
                      }
                    }
                  }}
                  onRuleChange={
                    onLhaSelectionRulesChange
                      ? (next: LhaSelectionRule) => {
                          onLhaSelectionRulesChange({
                            ...(lhaSelectionRules ?? {}),
                            [agl.id]: next,
                          });
                        }
                      : undefined
                  }
                />
              );
            })}
          </div>
          )}
        </div>
      )}
    </FormSection>
  );
}
