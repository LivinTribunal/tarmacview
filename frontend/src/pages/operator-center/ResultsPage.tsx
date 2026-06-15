import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { FileText, Loader2 } from "lucide-react";
import {
  downloadMeasurementReport,
  getMeasurementResults,
} from "@/api/measurements";
import type { MeasurementResults } from "@/types/measurement";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
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
  const { measurementId } = useParams<{ measurementId: string }>();
  const [results, setResults] = useState<MeasurementResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [downloading, setDownloading] = useState(false);

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

  return (
    <div className="p-4 md:p-6 space-y-4 overflow-y-auto" data-testid="results-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold text-tv-text-primary">
            {t("results.title")}
          </h1>
          <p className="text-xs text-tv-text-muted mt-0.5">
            {t("results.status", { status: results.status })}
          </p>
        </div>
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
    </div>
  );
}
