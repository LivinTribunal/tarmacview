import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Download } from "lucide-react";
import type { DjiHeadingMode } from "@/types/mission";
import type { FlightPlanScope } from "@/types/enums";
import type { CanIncludeGeozonesResult } from "@/constants/exportCapabilities";
import Button from "@/components/common/Button";
import InfoHint from "@/components/common/InfoHint";

const EXPORT_FORMATS = [
  { value: "KML", labelKey: "formatKml", descKey: "formatKmlDesc", capabilityKey: "nameDescOnly" },
  { value: "KMZ", labelKey: "formatKmz", descKey: "formatKmzDesc", capabilityKey: "zoomOnly" },
  { value: "JSON", labelKey: "formatJson", descKey: "formatJsonDesc", capabilityKey: "full" },
  { value: "MAVLINK", labelKey: "formatMavlink", descKey: "formatMavlinkDesc", capabilityKey: "none" },
  { value: "UGCS", labelKey: "formatUgcs", descKey: "formatUgcsDesc", capabilityKey: "none" },
  { value: "WPML", labelKey: "formatWpml", descKey: "formatWpmlDesc", capabilityKey: "zoomOnly" },
  { value: "CSV", labelKey: "formatCsv", descKey: "formatCsvDesc", capabilityKey: "none" },
  { value: "GPX", labelKey: "formatGpx", descKey: "formatGpxDesc", capabilityKey: "none" },
  { value: "LITCHI", labelKey: "formatLitchi", descKey: "formatLitchiDesc", capabilityKey: "none" },
  { value: "DRONEDEPLOY", labelKey: "formatDronedeploy", descKey: "formatDronedeployDesc", capabilityKey: "none" },
] as const;

interface ExportFormatSectionProps {
  exportCollapsed: boolean;
  onToggleCollapsed: () => void;
  exportEnabled: boolean;
  terminal: boolean;
  selectedFormats: Set<string>;
  onSelectFormat: (fmt: string) => void;
  geozoneCheck: CanIncludeGeozonesResult;
  includeGeozones: boolean;
  onToggleGeozones: () => void;
  includeRunwayBuffers: boolean;
  onToggleRunwayBuffers: () => void;
  mavlinkSelected: boolean;
  enforcedSelected: string[];
  advisorySelected: string[];
  showAdvisoryNote: boolean;
  showHeadingModePicker: boolean;
  headingMode: DjiHeadingMode;
  onHeadingModeChange: (mode: DjiHeadingMode) => void;
  flightPlanScope: FlightPlanScope | null | undefined;
  onDownload: () => void;
  isExporting: boolean;
  // extra disable signal layered on top of the format/exporting guards.
  // used by the altitude-clamp gate to keep the button off until ack.
  downloadDisabled?: boolean;
  // rendered between the scope note and the download button. used today
  // for the altitude-clamp warning + checkbox.
  warningSlot?: ReactNode;
}

/** export format dropdown, geozone bundle, dji heading picker, and download button. */
export default function ExportFormatSection({
  exportCollapsed,
  onToggleCollapsed,
  exportEnabled,
  terminal,
  selectedFormats,
  onSelectFormat,
  geozoneCheck,
  includeGeozones,
  onToggleGeozones,
  includeRunwayBuffers,
  onToggleRunwayBuffers,
  mavlinkSelected,
  enforcedSelected,
  advisorySelected,
  showAdvisoryNote,
  showHeadingModePicker,
  headingMode,
  onHeadingModeChange,
  flightPlanScope,
  onDownload,
  isExporting,
  downloadDisabled = false,
  warningSlot,
}: ExportFormatSectionProps) {
  const { t } = useTranslation();
  // the parent set always holds exactly one format; fall back to KMZ defensively
  const selectedValue = Array.from(selectedFormats)[0] ?? "KMZ";
  const selectedFormat =
    EXPORT_FORMATS.find((f) => f.value === selectedValue) ?? EXPORT_FORMATS[1];
  return (
    <div className="bg-tv-surface border border-tv-border rounded-2xl p-4">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex items-center justify-between w-full text-sm font-semibold text-tv-text-primary"
      >
        <span className="rounded-full px-3 py-1 bg-tv-bg border border-tv-border">
          {t("mission.validationExportPage.export")}
        </span>
        <div className="flex items-center gap-2">
          {!exportEnabled && !terminal && (
            <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-tv-warning text-white">
              {t("mission.validationExportPage.needsValidation")}
            </span>
          )}
          {exportCollapsed ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
        </div>
      </button>

      {!exportCollapsed && (
        <div className="border-b border-tv-border -mx-4 mt-3" />
      )}

      {!exportCollapsed && (
        <div className="mt-3 flex flex-col gap-3">
          {/* format picker */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-tv-text-secondary">
              {t("mission.validationExportPage.formatLabel")}
            </label>
            <select
              value={selectedValue}
              onChange={(e) => onSelectFormat(e.target.value)}
              disabled={!exportEnabled || terminal}
              className="w-full appearance-none pl-3 pr-7 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%23888%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="format-select"
            >
              {EXPORT_FORMATS.map((fmt) => (
                <option key={fmt.value} value={fmt.value}>
                  {t(`mission.validationExportPage.${fmt.labelKey}`)}
                </option>
              ))}
            </select>
            <p className="text-xs text-tv-text-muted" data-testid="selected-format-desc">
              {t(`mission.validationExportPage.${selectedFormat.descKey}`)}
            </p>
            <p
              className="text-[11px] text-tv-text-muted italic"
              data-testid={`capability-${selectedFormat.value}`}
            >
              {t(
                `mission.validationExportPage.capabilityNote.${selectedFormat.capabilityKey}`,
              )}
            </p>
          </div>

          {/* geozone bundle toggle */}
          {!terminal && (
            <div
              className="flex flex-col gap-2 px-3 py-3 rounded-xl bg-tv-bg border border-tv-border"
              data-testid="geozone-section"
            >
              <label
                className={`flex items-start gap-3 ${
                  geozoneCheck.enabled ? "cursor-pointer" : "opacity-60 cursor-not-allowed"
                }`}
                title={
                  geozoneCheck.reasonKey
                    ? t(`mission.validationExportPage.geozones.disabledReason.${geozoneCheck.reasonKey}`)
                    : undefined
                }
              >
                <input
                  type="checkbox"
                  checked={includeGeozones && geozoneCheck.enabled}
                  onChange={onToggleGeozones}
                  disabled={!geozoneCheck.enabled || !exportEnabled}
                  className="mt-0.5 accent-[var(--tv-accent)]"
                  data-testid="include-geozones"
                />
                <div>
                  <span className="text-sm font-medium text-tv-text-primary">
                    {t("mission.validationExportPage.geozones.label")}
                  </span>
                  <p className="text-xs text-tv-text-muted">
                    {t("mission.validationExportPage.geozones.description")}
                  </p>
                </div>
              </label>

              {includeGeozones && geozoneCheck.enabled && (
                <label
                  className={`flex items-start gap-3 pl-6 ${
                    mavlinkSelected ? "cursor-pointer" : "opacity-50 cursor-not-allowed"
                  }`}
                  title={
                    !mavlinkSelected
                      ? t(
                          "mission.validationExportPage.geozones.runwayBuffersRequiresMavlink",
                        )
                      : undefined
                  }
                >
                  <input
                    type="checkbox"
                    checked={includeRunwayBuffers && mavlinkSelected}
                    onChange={onToggleRunwayBuffers}
                    disabled={!mavlinkSelected}
                    className="mt-0.5 accent-[var(--tv-accent)]"
                    data-testid="include-runway-buffers"
                  />
                  <div>
                    <span className="text-sm font-medium text-tv-text-primary">
                      {t("mission.validationExportPage.geozones.runwayBuffersLabel")}
                    </span>
                    <p className="text-xs text-tv-text-muted">
                      {t("mission.validationExportPage.geozones.runwayBuffersDescription")}
                    </p>
                  </div>
                </label>
              )}

              {includeGeozones && geozoneCheck.enabled && enforcedSelected.length > 0 && (
                <p
                  className="text-[11px] text-tv-text-muted italic"
                  data-testid="enforced-note"
                >
                  {t("mission.validationExportPage.geozones.enforcedNote", {
                    formats: enforcedSelected.join(", "),
                  })}
                </p>
              )}
              {showAdvisoryNote && (
                <p
                  className="text-[11px] text-tv-warning italic"
                  data-testid="advisory-note"
                >
                  {t("mission.validationExportPage.geozones.advisoryNote", {
                    formats: advisorySelected.join(", "),
                  })}
                </p>
              )}
            </div>
          )}

          {/* dji heading mode picker - only when a DJI WPMZ format is
              selected on a DJI-manufacturer mission */}
          {showHeadingModePicker && (
            <div
              className="flex flex-col gap-2 px-3 py-3 rounded-xl bg-tv-bg border border-tv-border"
              data-testid="dji-heading-mode-section"
            >
              <label className="flex items-center gap-1 text-xs font-medium text-tv-text-secondary">
                <span>{t("mission.validationExportPage.djiHeadingMode.label")}</span>
                <InfoHint
                  text={t("mission.validationExportPage.djiHeadingMode.hint")}
                  label={t("mission.validationExportPage.djiHeadingMode.label")}
                  testId="hint-dji-heading-mode"
                />
              </label>
              <select
                value={headingMode}
                onChange={(e) => onHeadingModeChange(e.target.value as DjiHeadingMode)}
                className="w-full appearance-none pl-3 pr-7 py-2 rounded-full text-sm border border-tv-border bg-tv-bg text-tv-text-primary focus:outline-none focus:border-tv-accent transition-colors bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%23888%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat"
                data-testid="dji-heading-mode-select"
              >
                <option value="smoothTransition">
                  {t("mission.validationExportPage.djiHeadingMode.options.smoothTransition")}
                </option>
                <option value="towardPOI">
                  {t("mission.validationExportPage.djiHeadingMode.options.towardPOI")}
                </option>
                <option value="followWayline">
                  {t("mission.validationExportPage.djiHeadingMode.options.followWayline")}
                </option>
              </select>
            </div>
          )}

          {/* scope info */}
          {!terminal && (
            <p className="text-xs text-tv-text-muted italic px-1">
              {t(
                `mission.validationExportPage.scopeInfo.${
                  flightPlanScope === "MEASUREMENTS_ONLY"
                    ? "measurementsOnly"
                    : "full"
                }`,
              )}
            </p>
          )}

          {/* terminal status message */}
          {terminal && (
            <p className="text-xs text-tv-text-muted italic">
              {t("mission.validationExportPage.exportDisabledTerminal")}
            </p>
          )}

          {warningSlot}

          {/* download button */}
          <Button
            variant="primary"
            onClick={onDownload}
            disabled={
              !exportEnabled ||
              selectedFormats.size === 0 ||
              isExporting ||
              downloadDisabled
            }
            title={!exportEnabled && !terminal ? t("mission.validationExportPage.needsValidation") : undefined}
            className="w-full flex items-center justify-center gap-2"
            data-testid="download-export-btn"
          >
            <Download className="h-4 w-4" />
            {isExporting
              ? t("mission.validationExportPage.downloading")
              : t("mission.validationExportPage.downloadExport")}
          </Button>
        </div>
      )}
    </div>
  );
}
