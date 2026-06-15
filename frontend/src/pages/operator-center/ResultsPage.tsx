import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { FileText, Loader2, Pencil, Trash2 } from "lucide-react";
import {
  deleteMeasurement,
  downloadMeasurementReport,
  getMeasurementResults,
  updateMeasurement,
} from "@/api/measurements";
import type { MeasurementResults } from "@/types/measurement";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Input from "@/components/common/Input";
import Modal from "@/components/common/Modal";
import LightAngleChart from "@/components/results/LightAngleChart";
import ChromaticityChart from "@/components/results/ChromaticityChart";
import IntensityChart from "@/components/results/IntensityChart";
import TransitionAngleTable from "@/components/results/TransitionAngleTable";
import DronePathMap from "@/components/results/DronePathMap";
import ClimbProfileChart from "@/components/results/ClimbProfileChart";
import AnnotatedVideoPlayer from "@/components/results/AnnotatedVideoPlayer";

/** operator results page for one finished measurement run. */
export default function ResultsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { measurementId } = useParams<{ measurementId: string }>();
  const [results, setResults] = useState<MeasurementResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!measurementId) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    getMeasurementResults(measurementId)
      .then((data) => {
        if (!cancelled) setResults(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [measurementId]);

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

  const handleRenameConfirm = useCallback(async () => {
    if (!measurementId) return;
    // a blank label clears the run name back to the inspection fallback
    const updated = await updateMeasurement(measurementId, renameValue.trim() || null);
    setResults((prev) => (prev ? { ...prev, label: updated.label } : prev));
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

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-64 text-tv-text-muted"
        data-testid="results-loading"
      >
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error || !results) {
    return (
      <div
        className="p-6 text-sm text-tv-error"
        data-testid="results-error"
      >
        {t("results.loadError")}
      </div>
    );
  }

  const inspectionFallback =
    results.inspection_sequence_order != null
      ? t("measurementsList.inspectionLabel", {
          order: results.inspection_sequence_order,
          method: t(
            `map.inspectionMethod.${results.inspection_method}`,
            results.inspection_method ?? "",
          ),
        })
      : "";
  const displayName = results.label || inspectionFallback;

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-y-auto" data-testid="results-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold text-tv-text-primary">
            {t("results.title")}
          </h1>
          {displayName && (
            <p
              className="text-sm text-tv-text-secondary mt-0.5"
              data-testid="results-run-name"
            >
              {displayName}
            </p>
          )}
          <p className="text-xs text-tv-text-muted mt-0.5">
            {t("results.status", { status: results.status })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="secondary"
            onClick={() => {
              setRenameValue(results.label ?? "");
              setRenameOpen(true);
            }}
            className="flex items-center gap-2"
            data-testid="rename-measurement-btn"
          >
            <Pencil className="h-4 w-4" />
            {t("measurementsList.actions.rename")}
          </Button>
          <Button
            variant="secondary"
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-2"
            data-testid="download-pdf-btn"
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            {downloading ? t("results.generatingPdf") : t("results.downloadPdf")}
          </Button>
          <Button
            variant="danger"
            onClick={() => setDeleteOpen(true)}
            className="flex items-center gap-2"
            data-testid="delete-measurement-btn"
          >
            <Trash2 className="h-4 w-4" />
            {t("measurementsList.actions.delete")}
          </Button>
        </div>
      </div>

      {!results.has_results ? (
        <Card>
          <p
            className="text-sm text-tv-text-secondary"
            data-testid="results-pending"
          >
            {t("results.notReady")}
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <h2 className="text-sm font-medium text-tv-text-primary mb-3">
              {t("results.table.title")}
            </h2>
            <TransitionAngleTable summaries={results.summaries} />
          </Card>

          {/* per-light analysis */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <LightAngleChart lights={results.lights} />
            <IntensityChart lights={results.lights} />
            <ChromaticityChart lights={results.lights} />
          </div>

          {/* flown path + climb profile */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card className="flex flex-col">
              <h3 className="text-sm font-medium text-tv-text-primary mb-3">
                {t("results.map.title")}
              </h3>
              <div className="flex-1 min-h-[320px]">
                <DronePathMap
                  dronePath={results.drone_path}
                  referencePoints={results.reference_points}
                />
              </div>
            </Card>
            <ClimbProfileChart dronePath={results.drone_path} />
          </div>

          <Card>
            <h2 className="text-sm font-medium text-tv-text-primary mb-3">
              {t("results.video.title")}
            </h2>
            <AnnotatedVideoPlayer videoUrls={results.video_urls} />
          </Card>
        </>
      )}

      <Modal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t("common.delete")}
      >
        <p className="text-sm text-tv-text-primary mb-6">
          {t("measurementsList.deleteConfirm", { name: displayName })}
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
