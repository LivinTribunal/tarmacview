import { useTranslation } from "react-i18next";
import { FileText, Loader2 } from "lucide-react";
import Button from "@/components/common/Button";

interface MissionReportSectionProps {
  onDownloadReport?: () => void;
  isDownloadingReport: boolean;
  hasFlightPlan: boolean;
  /** opens the mission's measurements list (results entry point). */
  onViewResults?: () => void;
}

/** reports & results card - technical report download + view results. */
export default function MissionReportSection({
  onDownloadReport,
  isDownloadingReport,
  hasFlightPlan,
  onViewResults,
}: MissionReportSectionProps) {
  const { t } = useTranslation();
  return (
    <div className="bg-tv-surface border border-tv-border rounded-2xl p-4" data-testid="mission-report-section">
      <div className="flex items-center gap-2 mb-3">
        <span className="rounded-full px-3 py-1 bg-tv-bg border border-tv-border text-sm font-semibold text-tv-text-primary">
          {t("mission.missionReport.title")}
        </span>
      </div>
      <p className="text-xs text-tv-text-muted mb-3">
        {t("mission.missionReport.description")}
      </p>
      <Button
        variant="secondary"
        onClick={() => onDownloadReport?.()}
        disabled={!hasFlightPlan || isDownloadingReport || !onDownloadReport}
        title={!hasFlightPlan ? t("mission.missionReport.noFlightPlan") : undefined}
        className="w-full flex items-center justify-center gap-2"
        data-testid="download-report-btn"
      >
        {isDownloadingReport ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <FileText className="h-4 w-4" />
        )}
        {isDownloadingReport
          ? t("mission.missionReport.generating")
          : t("mission.missionReport.download")}
      </Button>

      {onViewResults && (
        <Button
          variant="secondary"
          onClick={onViewResults}
          className="w-full mt-2"
          data-testid="view-results-btn"
        >
          {t("measurementsList.viewResults")}
        </Button>
      )}
    </div>
  );
}
