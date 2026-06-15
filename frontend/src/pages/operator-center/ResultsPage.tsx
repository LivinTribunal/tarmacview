import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { getMeasurementResults } from "@/api/measurements";
import type { MeasurementResults } from "@/types/measurement";
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
    <div className="p-4 md:p-6 space-y-4 overflow-y-auto" data-testid="results-page">
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
