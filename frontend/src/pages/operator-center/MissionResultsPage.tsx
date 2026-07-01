import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOutletContext, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useAirport } from "@/contexts/AirportContext";
import {
  downloadMeasurementReport,
  getMeasurementResults,
  getMissionResults,
  listAirportMeasurements,
} from "@/api/measurements";
import { listInspectionTemplates } from "@/api/inspectionTemplates";
import type {
  MeasurementListItem,
  MeasurementResults,
  MissionResults,
} from "@/types/measurement";
import type { InspectionTemplateResponse } from "@/types/inspectionTemplate";
import type { MissionTabOutletContext } from "@/components/Layout/MissionTabNav";
import Card from "@/components/common/Card";
import ResultsLeftPanel from "@/components/results/ResultsLeftPanel";
import MissionResultsOverview from "@/components/results/MissionResultsOverview";
import MeasurementFlowDialog from "@/components/mission/MeasurementFlowDialog";
import ResultsPage from "./ResultsPage";

/** mission-scoped results tab - inspection picker, results, and pdf download. */
export default function MissionResultsPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { selectedAirport } = useAirport();
  const { leftPanelEl, mission, setSaveContext, setComputeContext } =
    useOutletContext<MissionTabOutletContext>();

  const [selectedInspectionId, setSelectedInspectionId] = useState<
    string | null
  >(null);
  const [reviewInspectionId, setReviewInspectionId] = useState<string | null>(
    null,
  );
  const [measurements, setMeasurements] = useState<MeasurementListItem[]>([]);
  const [templates, setTemplates] = useState<
    Map<string, InspectionTemplateResponse>
  >(new Map());
  const [results, setResults] = useState<MeasurementResults | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState(false);
  const [overview, setOverview] = useState<MissionResults | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const didInitRef = useRef(false);

  const airportId = selectedAirport?.id;

  const inspections = useMemo(
    () =>
      (mission?.inspections ?? [])
        .slice()
        .sort((a, b) => a.sequence_order - b.sequence_order),
    [mission],
  );

  // newest-first list -> keep the first (latest) run seen per inspection
  const measurementByInspection = useMemo(() => {
    const map = new Map<string, MeasurementListItem>();
    for (const row of measurements) {
      if (!map.has(row.inspection_id)) map.set(row.inspection_id, row);
    }
    return map;
  }, [measurements]);

  const currentRow = selectedInspectionId
    ? (measurementByInspection.get(selectedInspectionId) ?? null)
    : null;

  // run + label backing the manual box-review dialog, null until a row is reviewed
  const reviewRow = reviewInspectionId
    ? (measurementByInspection.get(reviewInspectionId) ?? null)
    : null;
  const reviewInspection = reviewInspectionId
    ? (inspections.find((i) => i.id === reviewInspectionId) ?? null)
    : null;
  const reviewLabel =
    reviewRow?.label ||
    (reviewInspection
      ? templates.get(reviewInspection.template_id)?.name
      : undefined) ||
    t("mission.config.inspections");

  // pdf targets the drilled-down run only - mission-scale pdf is a non-goal
  const downloadTargetId = currentRow?.id ?? null;

  // templates back the picker row names
  useEffect(() => {
    if (!airportId) return;
    let cancelled = false;
    listInspectionTemplates({ airport_id: airportId })
      .then((res) => {
        if (!cancelled) {
          setTemplates(new Map(res.data.map((tpl) => [tpl.id, tpl])));
        }
      })
      .catch(() => {
        if (!cancelled) setTemplates(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [airportId]);

  // airport-wide list scoped to this mission; default view is the overview,
  // only a ?inspection=<DONE> deep-link opens the drill-down on first load
  useEffect(() => {
    if (!airportId || !id) return;
    let cancelled = false;
    listAirportMeasurements(airportId)
      .then((rows) => {
        if (cancelled) return;
        const scoped = rows.filter((r) => r.mission_id === id);
        setMeasurements(scoped);

        if (didInitRef.current) return;
        didInitRef.current = true;
        const byInsp = new Map<string, MeasurementListItem>();
        for (const r of scoped) {
          if (!byInsp.has(r.inspection_id)) byInsp.set(r.inspection_id, r);
        }
        const requested = searchParams.get("inspection");
        if (requested && byInsp.get(requested)?.status === "DONE") {
          setSelectedInspectionId(requested);
        }
      })
      .catch(() => {
        if (!cancelled) setMeasurements([]);
      });
    return () => {
      cancelled = true;
    };
  }, [airportId, id, searchParams]);

  // mission-scale protocol overview - the default landing view
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setOverviewLoading(true);
    setOverviewError(false);
    getMissionResults(id)
      .then((data) => {
        if (!cancelled) setOverview(data);
      })
      .catch(() => {
        if (!cancelled) setOverviewError(true);
      })
      .finally(() => {
        if (!cancelled) setOverviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // load the selected inspection's results when its run is finished
  useEffect(() => {
    if (currentRow?.status !== "DONE") {
      setResults(null);
      setResultsError(false);
      return;
    }
    let cancelled = false;
    setResultsLoading(true);
    setResultsError(false);
    getMeasurementResults(currentRow.id)
      .then((data) => {
        if (!cancelled) setResults(data);
      })
      .catch(() => {
        if (!cancelled) setResultsError(true);
      })
      .finally(() => {
        if (!cancelled) setResultsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentRow?.id, currentRow?.status]);

  // disabled save pill for visual parity with the other tabs
  useEffect(() => {
    setSaveContext({
      onSave: () => {},
      isDirty: false,
      isSaving: false,
      lastSaved: mission?.updated_at ? new Date(mission.updated_at) : null,
    });
    return () => {
      setSaveContext({
        onSave: null,
        isDirty: false,
        isSaving: false,
        lastSaved: null,
      });
    };
  }, [setSaveContext, mission]);

  // re-fetch the mission's runs without re-running the one-shot deep-link drill-in
  const refreshMeasurements = useCallback(() => {
    if (!airportId || !id) return;
    listAirportMeasurements(airportId)
      .then((rows) => setMeasurements(rows.filter((r) => r.mission_id === id)))
      .catch(() => {});
  }, [airportId, id]);

  const handleReviewClose = useCallback(() => {
    setReviewInspectionId(null);
    // picks up AWAITING_CONFIRM -> PROCESSING after confirm; no-op on cancel
    refreshMeasurements();
  }, [refreshMeasurements]);

  const handleDownload = useCallback(async () => {
    if (!downloadTargetId) return;
    setDownloading(true);
    try {
      const { blob, filename } =
        await downloadMeasurementReport(downloadTargetId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename ?? `MeasurementReport_${downloadTargetId}.pdf`;
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
  }, [downloadTargetId]);

  // download pdf button in the action slot
  useEffect(() => {
    setComputeContext({
      onCompute: handleDownload,
      canCompute: !!downloadTargetId && !downloading,
      isComputing: false,
      label: downloading ? t("results.generatingPdf") : t("results.downloadPdf"),
      variant: "secondary",
      icon: "file",
    });
    return () => {
      setComputeContext({
        onCompute: null,
        canCompute: false,
        isComputing: false,
      });
    };
  }, [setComputeContext, handleDownload, downloadTargetId, downloading, t]);

  if (!mission) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-tv-accent" />
      </div>
    );
  }

  return (
    <>
      {leftPanelEl &&
        createPortal(
          <ResultsLeftPanel
            inspections={inspections}
            templates={templates}
            measurementByInspection={measurementByInspection}
            selectedId={selectedInspectionId}
            onSelect={setSelectedInspectionId}
            onReview={setReviewInspectionId}
            results={results}
            currentRow={currentRow}
          />,
          leftPanelEl,
        )}

      {reviewRow && (
        <MeasurementFlowDialog
          measurementId={reviewRow.id}
          inspectionLabel={reviewLabel}
          onClose={handleReviewClose}
        />
      )}

      <div
        className="h-full overflow-y-auto"
        data-testid="mission-results-page"
      >
        {!selectedInspectionId ? (
          <MissionResultsOverview
            overview={overview}
            loading={overviewLoading}
            error={overviewError}
            onDrillDown={setSelectedInspectionId}
          />
        ) : (
          <div>
            <button
              type="button"
              className="mx-4 mt-4 md:mx-6 text-sm text-tv-accent hover:underline"
              onClick={() => setSelectedInspectionId(null)}
              data-testid="back-to-overview"
            >
              {t("results.overview.backToOverview")}
            </button>
            {resultsLoading ? (
              <div
                className="flex items-center justify-center h-64 text-tv-text-muted"
                data-testid="results-loading"
              >
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : resultsError || !results ? (
              <div
                className="p-6 text-sm text-tv-error"
                data-testid="results-error"
              >
                {t("results.loadError")}
              </div>
            ) : !results.has_results ? (
              <div className="p-4 md:p-6">
                <Card>
                  <p
                    className="text-sm text-tv-text-secondary"
                    data-testid="results-pending"
                  >
                    {t("results.notReady")}
                  </p>
                </Card>
              </div>
            ) : (
              <ResultsPage results={results} />
            )}
          </div>
        )}
      </div>
    </>
  );
}
