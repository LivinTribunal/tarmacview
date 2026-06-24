import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { FileText, Loader2, Upload } from "lucide-react";
import { useAirport } from "@/contexts/AirportContext";
import {
  deleteMeasurement,
  downloadMeasurementReport,
  listAirportMeasurements,
  listMeasurementIterations,
  updateMeasurement,
} from "@/api/measurements";
import type {
  MeasurementIteration,
  MeasurementListItem,
} from "@/types/measurement";
import Button from "@/components/common/Button";
import Input from "@/components/common/Input";
import Modal from "@/components/common/Modal";
import MeasurementStatusChip from "@/components/results/MeasurementStatusChip";
import UploadIterationDialog from "@/components/mission/UploadIterationDialog";
import CompactMeasurementSelector from "./CompactMeasurementSelector";

/** results workspace shell - measurements picker, section tabs, pass rollup, download, and outlet. */
export default function MeasurementTabNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { measurementId } = useParams<{ measurementId: string }>();
  const { selectedAirport } = useAirport();

  const [rows, setRows] = useState<MeasurementListItem[]>([]);
  const [iterations, setIterations] = useState<MeasurementIteration[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [downloading, setDownloading] = useState(false);

  // section tabs route to the results index ("all") or the convergence compare
  // view; the compare tab only appears once the group has 2+ runs
  const resultsBase = `/operator-center/measurements/${measurementId}/results`;
  const onCompare = location.pathname.endsWith("/compare");
  const activeSection = onCompare ? "compare" : "all";
  const sections = useMemo(() => {
    const base = [{ key: "all", labelKey: "measurement.tab.all", path: resultsBase }];
    if (iterations.length >= 2) {
      base.push({
        key: "compare",
        labelKey: "results.tab.compare",
        path: `${resultsBase}/compare`,
      });
    }
    return base;
  }, [iterations.length, resultsBase]);

  // rename/delete state lifted here from the results page so the picker drives them
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // compact pill selector refs + portal anchor
  const selectorRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

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

  // the iteration switcher + compare tab read off the current run's group
  useEffect(() => {
    if (!measurementId) return;
    let cancelled = false;
    listMeasurementIterations(measurementId)
      .then((data) => {
        if (!cancelled) setIterations(data);
      })
      .catch(() => {
        if (!cancelled) setIterations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [measurementId]);

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

  // the run's display name - operator label when set, else the inspection label
  const displayLabel = useCallback(
    (row: MeasurementListItem) => row.label || rowLabel(row),
    [rowLabel],
  );

  const rollupTotal = currentRow ? currentRow.pass_count + currentRow.fail_count : 0;

  // close the picker dropdown on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (selectorRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setPickerOpen(false);
      setSearch("");
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [pickerOpen]);

  const toggleDropdown = useCallback(() => {
    setPickerOpen((open) => {
      if (open) {
        setSearch("");
        return false;
      }
      if (selectorRef.current) {
        const rect = selectorRef.current.getBoundingClientRect();
        setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
      }
      return true;
    });
  }, []);

  const handleSelectMeasurement = useCallback(
    (id: string) => {
      setPickerOpen(false);
      setSearch("");
      if (id !== measurementId) {
        navigate(`/operator-center/measurements/${id}/results`);
      }
    },
    [measurementId, navigate],
  );

  const handleDeselect = useCallback(() => {
    setPickerOpen(false);
    navigate("/operator-center/measurements");
  }, [navigate]);

  const handleRenameConfirm = useCallback(async () => {
    if (!measurementId) return;
    // a blank label clears the run name back to the inspection fallback
    const updated = await updateMeasurement(measurementId, renameValue.trim() || null);
    setRows((prev) =>
      prev.map((r) => (r.id === measurementId ? { ...r, label: updated.label } : r)),
    );
    setRenameOpen(false);
  }, [measurementId, renameValue]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!measurementId) return;
    setDeleting(true);
    try {
      await deleteMeasurement(measurementId);
      navigate("/operator-center/measurements");
    } catch {
      setDeleting(false);
    }
  }, [measurementId, navigate]);

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

  return (
    <div className="flex flex-col h-[calc(100vh-5.25rem)] px-4 pt-2">
      {/* header row - mirrors the navbar 30/70 split */}
      <div
        className="flex items-center flex-shrink-0 pb-3"
        data-testid="measurement-tab-nav"
      >
        {/* left 30% - measurements picker pill */}
        <div className="w-[30%] flex-shrink-0 flex">
          <CompactMeasurementSelector
            selectorRef={selectorRef}
            dropdownRef={dropdownRef}
            dropdownPos={dropdownPos}
            currentRow={currentRow}
            selectedId={measurementId}
            filteredMeasurements={filteredMeasurements}
            dropdownOpen={pickerOpen}
            search={search}
            displayLabel={displayLabel}
            onToggleDropdown={toggleDropdown}
            onRename={() => {
              setRenameValue(currentRow?.label ?? "");
              setRenameOpen(true);
            }}
            onDelete={() => setDeleteOpen(true)}
            onDeselect={handleDeselect}
            onSearchChange={setSearch}
            onSelect={handleSelectMeasurement}
          />
          <div className="w-6 flex-shrink-0" />
        </div>

        {/* right 70% - section tabs, download, pass rollup, status (aligned to the navbar columns) */}
        <div className="flex-1 flex items-center gap-4 min-w-0">
          {/* iteration switcher - jump between runs in the current run's group */}
          {iterations.length > 1 && (
            <select
              value={measurementId ?? ""}
              onChange={(e) =>
                navigate(`/operator-center/measurements/${e.target.value}/results`)
              }
              className="h-11 flex-shrink-0 rounded-full border border-tv-border bg-tv-surface px-3 text-sm text-tv-text-primary"
              aria-label={t("results.iterationSwitcher.label")}
              data-testid="iteration-switcher"
            >
              {iterations.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.label || t("measurement.iteration.label", { index: it.iteration_index })}
                </option>
              ))}
            </select>
          )}

          <div
            className="flex flex-1 items-center justify-center gap-1 rounded-full bg-tv-surface p-1 h-11"
            data-testid="measurement-section-tabs"
          >
            {sections.map((section) => (
              <button
                key={section.key}
                type="button"
                onClick={() => navigate(section.path)}
                className={`px-5 h-9 rounded-full text-sm font-medium transition-colors flex items-center ${
                  activeSection === section.key
                    ? "bg-tv-nav-active-bg text-tv-nav-active-text"
                    : "text-tv-text-primary hover:bg-tv-surface-hover"
                }`}
                data-testid={`section-tab-${section.key}`}
              >
                {t(section.labelKey)}
              </button>
            ))}
          </div>

          {/* re-fly the same inspection from new footage, linked into the group */}
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            disabled={!measurementId}
            className="flex items-center justify-center gap-2 flex-shrink-0 h-11 rounded-full px-4 text-sm font-semibold transition-colors border border-tv-border bg-tv-surface text-tv-text-primary hover:bg-tv-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="upload-iteration-btn"
          >
            <Upload className="h-4 w-4" />
            {t("results.uploadIteration")}
          </button>

          {/* download - aligns under the navbar airport picker */}
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center justify-center gap-2 w-[280px] flex-shrink-0 h-11 rounded-full px-4 text-sm font-semibold transition-colors border border-tv-border bg-tv-surface text-tv-text-primary hover:bg-tv-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="download-pdf-btn"
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            {downloading ? t("results.generatingPdf") : t("results.downloadPdf")}
          </button>

          {/* pass rollup + status merged into one bubble - spans the navbar
              theme-toggle's left edge (81px) to the user menu's right edge
              (140px): 81 + 16 gap + 140 = 237px. download still lines up under
              the airport picker because that trailing span matches the navbar's */}
          <div className="w-[237px] flex-shrink-0 flex items-center">
            {currentRow && (
              <div className="flex w-full items-center rounded-full h-11 bg-tv-surface">
                <div className="flex-1 min-w-0 flex items-center justify-center px-2">
                  <span
                    className="text-sm font-medium text-tv-text-primary whitespace-nowrap truncate"
                    data-testid="pass-rollup"
                  >
                    {t("results.passRollup", {
                      pass: currentRow.pass_count,
                      total: rollupTotal,
                    })}
                  </span>
                </div>
                <span className="h-5 w-px bg-tv-border flex-shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0 flex items-center justify-center px-2">
                  <MeasurementStatusChip
                    status={currentRow.status}
                    size="md"
                    variant="inline"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* results content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Outlet />
      </div>

      {uploadOpen && measurementId && (
        <UploadIterationDialog
          measurementId={measurementId}
          onClose={() => setUploadOpen(false)}
        />
      )}

      <Modal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t("common.delete")}
      >
        <p className="text-sm text-tv-text-primary mb-6">
          {t("measurementsList.deleteConfirm", {
            name: currentRow ? displayLabel(currentRow) : "",
          })}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={handleDeleteConfirm}
            disabled={deleting}
            data-testid="confirm-delete-measurement"
          >
            {t("common.delete")}
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={renameOpen}
        onClose={() => setRenameOpen(false)}
        title={t("measurementsList.renameTitle")}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleRenameConfirm();
          }}
        >
          <Input
            id="measurement-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder={t("measurementsList.renamePlaceholder")}
            data-testid="measurement-rename-input"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setRenameOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" data-testid="confirm-rename-measurement">
              {t("common.save")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
