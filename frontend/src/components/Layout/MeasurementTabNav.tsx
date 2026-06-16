import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { FileText, List, Loader2 } from "lucide-react";
import { useAirport } from "@/contexts/AirportContext";
import {
  downloadMeasurementReport,
  listAirportMeasurements,
} from "@/api/measurements";
import type { MeasurementListItem } from "@/types/measurement";
import DetailSelector from "@/components/common/DetailSelector";
import DetailSelectorItem from "@/components/common/DetailSelectorItem";

// report sections in the results tab strip - only "all" for now, extensible
const REPORT_SECTIONS = [{ key: "all", labelKey: "measurement.tab.all" }] as const;

/** results workspace shell - measurements picker, section tabs, pass rollup, download, and outlet. */
export default function MeasurementTabNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { measurementId } = useParams<{ measurementId: string }>();
  const { selectedAirport } = useAirport();

  const [rows, setRows] = useState<MeasurementListItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeSection, setActiveSection] = useState<string>(REPORT_SECTIONS[0].key);
  const [downloading, setDownloading] = useState(false);

  const airportId = selectedAirport?.id;

  // the picker + rollup read off the airport-wide list, scoped client-side
  useEffect(() => {
    if (!airportId) return;
    let cancelled = false;
    listAirportMeasurements(airportId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [airportId]);

  const currentRow = useMemo(
    () => rows.find((r) => r.id === measurementId) ?? null,
    [rows, measurementId],
  );

  // one entry per inspection in the current run's mission
  const missionMeasurements = useMemo(() => {
    if (!currentRow) return [];
    return rows
      .filter((r) => r.mission_id === currentRow.mission_id)
      .sort((a, b) => a.inspection_sequence_order - b.inspection_sequence_order);
  }, [rows, currentRow]);

  const filteredMeasurements = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return missionMeasurements;
    return missionMeasurements.filter((r) =>
      `${r.inspection_sequence_order} ${r.inspection_method}`
        .toLowerCase()
        .includes(q),
    );
  }, [missionMeasurements, search]);

  const rowLabel = useCallback(
    (row: MeasurementListItem) =>
      t("measurementsList.inspectionLabel", {
        order: row.inspection_sequence_order,
        method: t(`map.inspectionMethod.${row.inspection_method}`, row.inspection_method),
      }),
    [t],
  );

  const rollupTotal = currentRow ? currentRow.pass_count + currentRow.fail_count : 0;

  const handleSelectMeasurement = useCallback(
    (id: string) => {
      setPickerOpen(false);
      if (id !== measurementId) {
        navigate(`/operator-center/measurements/${id}/results`);
      }
    },
    [measurementId, navigate],
  );

  const handleDownload = useCallback(async () => {
    if (!measurementId) return;
    setDownloading(true);
    try {
      const { blob, filename } = await downloadMeasurementReport(measurementId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename ?? `MeasurementReport_${measurementId}.pdf`;
      document.body.appendChild(a);
      try {
        a.click();
      } finally {
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (err) {
      console.error(
        "measurement report download failed:",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setDownloading(false);
    }
  }, [measurementId]);

  const measurementSelectorBlock = (
    <DetailSelector
      title={t("measurement.label")}
      count={missionMeasurements.length}
      actions={[
        {
          icon: List,
          onClick: () => navigate("/operator-center/measurements"),
          title: t("measurementsList.title"),
        },
      ]}
      renderSelected={() => (
        <span className="flex-1 min-w-0 truncate text-sm font-medium text-tv-text-primary">
          {currentRow ? rowLabel(currentRow) : t("measurement.selectMeasurement")}
        </span>
      )}
      isOpen={pickerOpen}
      onToggle={() => setPickerOpen((o) => !o)}
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder={t("measurement.searchPlaceholder")}
      noResultsText={t("common.noResults")}
      usePortal
      renderDropdownItems={() =>
        filteredMeasurements.length === 0
          ? null
          : filteredMeasurements.map((m) => (
              <DetailSelectorItem
                key={m.id}
                isSelected={m.id === measurementId}
                onClick={() => handleSelectMeasurement(m.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm">{rowLabel(m)}</span>
                  <span className="ml-2 flex-shrink-0 text-xs text-tv-text-muted">
                    {t("measurementsList.passFail", {
                      pass: m.pass_count,
                      fail: m.fail_count,
                    })}
                  </span>
                </div>
              </DetailSelectorItem>
            ))
      }
    />
  );

  return (
    <div className="flex flex-col h-[calc(100vh-5.25rem)] px-4 pt-2">
      {/* header row - mirrors the navbar 30/70 split */}
      <div
        className="flex items-start flex-shrink-0 pb-3"
        data-testid="measurement-tab-nav"
      >
        {/* left 30% - measurements picker */}
        <div className="w-[30%] flex-shrink-0 flex">
          <div className="flex-1 min-w-0">{measurementSelectorBlock}</div>
          <div className="w-6 flex-shrink-0" />
        </div>

        {/* right 70% - section tabs, pass rollup, download */}
        <div className="flex-1 flex items-center gap-4 min-w-0">
          <div
            className="flex flex-1 items-center justify-center gap-1 rounded-full bg-tv-surface p-1 h-11"
            data-testid="measurement-section-tabs"
          >
            {REPORT_SECTIONS.map((section) => (
              <button
                key={section.key}
                type="button"
                onClick={() => setActiveSection(section.key)}
                className={`px-5 h-9 rounded-full text-sm font-medium transition-colors flex items-center ${
                  activeSection === section.key
                    ? "bg-tv-nav-active-bg text-tv-nav-active-text"
                    : "text-tv-text-primary hover:bg-tv-surface-hover"
                }`}
              >
                {t(section.labelKey)}
              </button>
            ))}
          </div>

          {currentRow && (
            <span
              className="flex items-center justify-center rounded-full px-4 h-11 bg-tv-surface text-sm font-medium text-tv-text-primary whitespace-nowrap"
              data-testid="pass-rollup"
            >
              {t("results.passRollup", {
                pass: currentRow.pass_count,
                total: rollupTotal,
              })}
            </span>
          )}

          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center justify-center gap-2 flex-shrink-0 h-11 rounded-full px-4 text-sm font-semibold transition-colors border border-tv-border bg-tv-surface text-tv-text-primary hover:bg-tv-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="download-pdf-btn"
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            {downloading ? t("results.generatingPdf") : t("results.downloadPdf")}
          </button>
        </div>
      </div>

      {/* results content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
