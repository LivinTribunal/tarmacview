import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useOutletContext, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { getMeasurementResults } from "@/api/measurements";
import type { MeasurementResults } from "@/types/measurement";
import type { MeasurementTabOutletContext } from "@/components/Layout/MeasurementTabNav";
import Card from "@/components/common/Card";
import LightAngleChart from "@/components/results/LightAngleChart";
import ChromaticityChart from "@/components/results/ChromaticityChart";
import IntensityChart from "@/components/results/IntensityChart";
import PerLightRgbChart from "@/components/results/PerLightRgbChart";
import PerLightChromaticityChart from "@/components/results/PerLightChromaticityChart";
import VerticalAnalysisSection from "@/components/results/VerticalAnalysisSection";
import HorizontalAnalysisSection from "@/components/results/HorizontalAnalysisSection";
import TransitionAngleTable from "@/components/results/TransitionAngleTable";
import DronePathMap from "@/components/results/DronePathMap";
import DroneHeightProfileChart from "@/components/results/DroneHeightProfileChart";
import TransitionDifferenceTable from "@/components/results/TransitionDifferenceTable";
import GlidePathSummaryTable from "@/components/results/GlidePathSummaryTable";
import ChromaticityComparisonTable from "@/components/results/ChromaticityComparisonTable";
import LuminosityComparisonTable from "@/components/results/LuminosityComparisonTable";
import AnnotatedVideoPlayer from "@/components/results/AnnotatedVideoPlayer";
import ResultsLeftPanel from "@/components/results/ResultsLeftPanel";

// anchored right-column sections, mirrored by the left-panel jump nav
const RESULT_SECTIONS = [
  { id: "papi-vertical", labelKey: "results.sections.vertical" },
  { id: "papi-horizontal", labelKey: "results.sections.horizontal" },
  { id: "drone-path", labelKey: "results.sections.dronePath" },
  { id: "annotated-video", labelKey: "results.sections.video" },
  { id: "data-tables", labelKey: "results.sections.dataTables" },
] as const;

/** operator results page for one finished measurement run. */
export default function ResultsPage() {
  const { t } = useTranslation();
  const { measurementId } = useParams<{ measurementId: string }>();
  const { leftPanelEl, currentRow } =
    useOutletContext<MeasurementTabOutletContext>();
  const [results, setResults] = useState<MeasurementResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

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
    <div className="p-4 md:p-6 space-y-4" data-testid="results-page">
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
          {leftPanelEl &&
            createPortal(
              <ResultsLeftPanel
                results={results}
                currentRow={currentRow}
                sections={RESULT_SECTIONS}
              />,
              leftPanelEl,
            )}

          <section
            id="papi-vertical"
            data-testid="section-papi-vertical"
            className="scroll-mt-4 space-y-4"
          >
            <h2 className="text-sm font-semibold text-tv-text-primary">
              {t("results.sections.vertical")}
            </h2>
            {/* per-light analysis - the three existing per-light charts */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <LightAngleChart lights={results.lights} />
              <IntensityChart lights={results.lights} />
              <ChromaticityChart lights={results.lights} />
            </div>
            {/* per-papi-unit charts with an a/b/c/d selector */}
            <h3 className="text-sm font-medium text-tv-text-primary">
              {t("results.perLight.title")}
            </h3>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <PerLightRgbChart lights={results.lights} />
              <PerLightChromaticityChart lights={results.lights} />
            </div>
            {/* aggregate vertical analysis - all four lights overlaid */}
            <h3 className="text-sm font-medium text-tv-text-primary">
              {t("results.vertical.title")}
            </h3>
            <VerticalAnalysisSection lights={results.lights} />
          </section>

          <section
            id="papi-horizontal"
            data-testid="section-papi-horizontal"
            className="scroll-mt-4 space-y-4"
          >
            <h2 className="text-sm font-semibold text-tv-text-primary">
              {t("results.sections.horizontal")}
            </h2>
            <HorizontalAnalysisSection lights={results.lights} />
          </section>

          <section
            id="drone-path"
            data-testid="section-drone-path"
            className="scroll-mt-4 space-y-4"
          >
            <h2 className="text-sm font-semibold text-tv-text-primary">
              {t("results.sections.dronePath")}
            </h2>
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
              <DroneHeightProfileChart
                dronePath={results.drone_path}
                referencePoints={results.reference_points}
              />
            </div>
          </section>

          <section
            id="annotated-video"
            data-testid="section-annotated-video"
            className="scroll-mt-4 space-y-4"
          >
            <h2 className="text-sm font-semibold text-tv-text-primary">
              {t("results.sections.video")}
            </h2>
            <Card>
              <AnnotatedVideoPlayer videoUrls={results.video_urls} />
            </Card>
          </section>

          <section
            id="data-tables"
            data-testid="section-data-tables"
            className="scroll-mt-4 space-y-4"
          >
            <h2 className="text-sm font-semibold text-tv-text-primary">
              {t("results.sections.dataTables")}
            </h2>
            <Card>
              <h3 className="text-sm font-medium text-tv-text-primary mb-3">
                {t("results.table.title")}
              </h3>
              <TransitionAngleTable summaries={results.summaries} />
            </Card>
            {/* derived PAPI data tables */}
            <section data-testid="results-data-tables" className="space-y-4">
              <h3 className="text-sm font-medium text-tv-text-primary">
                {t("results.dataTables.title")}
              </h3>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <Card>
                  <TransitionDifferenceTable lights={results.lights} />
                </Card>
                <Card>
                  <GlidePathSummaryTable lights={results.lights} />
                </Card>
                <Card>
                  <ChromaticityComparisonTable lights={results.lights} />
                </Card>
                <Card>
                  <LuminosityComparisonTable lights={results.lights} />
                </Card>
              </div>
            </section>
          </section>
        </>
      )}
    </div>
  );
}
