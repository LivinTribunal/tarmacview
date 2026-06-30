import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { InspectionConfigResponse } from "@/types/inspectionTemplate";
import type { InspectionMethod } from "@/types/enums";
import type { AGLResponse } from "@/types/airport";
import TemplateConfigSection from "@/components/mission/TemplateConfigSection";

type ConfigUpdate = Partial<Omit<InspectionConfigResponse, "id">>;

/** format a date as a human-readable saved timestamp. */
function formatTimestamp(
  date: Date,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return t("coordinator.inspections.savedJustNow");
  if (diffMin < 60)
    return t("coordinator.inspections.savedMinutesAgo", { count: diffMin });

  return t("coordinator.inspections.savedAt", {
    time: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  });
}

interface InspectionConfigCardProps {
  configExpanded: boolean;
  onToggleExpanded: () => void;
  saving: boolean;
  saveError: boolean;
  lastSaved: Date | null;
  config: Omit<InspectionConfigResponse, "id"> | null;
  method: InspectionMethod;
  onChange: (updates: ConfigUpdate) => void;
  onMethodChange: (method: InspectionMethod) => void;
  allAgls: AGLResponse[];
  selectedAglId: string;
  onAglChange: (aglId: string) => void;
  selectedLhaIds: Set<string>;
  onToggleLha: (lhaId: string) => void;
  onSelectAllLhas: () => void;
  onDeselectAllLhas: () => void;
}

/** collapsible config container with autosave-status header. */
export default function InspectionConfigCard({
  configExpanded,
  onToggleExpanded,
  saving,
  saveError,
  lastSaved,
  config,
  method,
  onChange,
  onMethodChange,
  allAgls,
  selectedAglId,
  onAglChange,
  selectedLhaIds,
  onToggleLha,
  onSelectAllLhas,
  onDeselectAllLhas,
}: InspectionConfigCardProps) {
  const { t } = useTranslation();

  return (
    <div className="bg-tv-surface border border-tv-border rounded-3xl">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex w-full items-center gap-2 p-4 text-left"
      >
        <span className="text-base font-semibold text-tv-text-primary rounded-full px-3 py-1 bg-tv-bg border border-tv-border">
          {t("coordinator.inspections.configuration")}
        </span>
        <span className="flex-1" />
        {/* autosave status */}
        <span className="flex items-center gap-1.5 text-xs text-tv-text-muted" onClick={(e) => e.stopPropagation()}>
          {saving && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("coordinator.inspections.saving")}
            </>
          )}
          {!saving && saveError && (
            <span className="text-tv-error">
              {t("coordinator.inspections.saveError")}
            </span>
          )}
          {!saving && !saveError && lastSaved && (
            <>
              <svg className="h-3 w-3 text-tv-success" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              {formatTimestamp(lastSaved, t)}
            </>
          )}
        </span>
        <svg
          className={`h-5 w-5 flex-shrink-0 text-tv-text-secondary transition-transform duration-200 ${
            configExpanded ? "rotate-180" : ""
          }`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {configExpanded && (
        <>
          <div className="border-b border-tv-border" />
          <div className="px-4 py-4">
            <TemplateConfigSection
              config={config}
              method={method}
              onChange={onChange}
              onMethodChange={onMethodChange}
              allAgls={allAgls}
              selectedAglId={selectedAglId}
              onAglChange={onAglChange}
              selectedLhaIds={selectedLhaIds}
              onToggleLha={onToggleLha}
              onSelectAllLhas={onSelectAllLhas}
              onDeselectAllLhas={onDeselectAllLhas}
            />
          </div>
        </>
      )}
    </div>
  );
}
