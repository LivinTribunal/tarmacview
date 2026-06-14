import { useTranslation } from "react-i18next";
import Button from "@/components/common/Button";

interface MissionLifecycleSectionProps {
  canComplete: boolean;
  canCancelMission: boolean;
  canDelete: boolean;
  onRequestComplete: () => void;
  onRequestCancel: () => void;
  onRequestDelete: () => void;
}

/** complete / cancel / delete mission lifecycle buttons. */
export default function MissionLifecycleSection({
  canComplete,
  canCancelMission,
  canDelete,
  onRequestComplete,
  onRequestCancel,
  onRequestDelete,
}: MissionLifecycleSectionProps) {
  const { t } = useTranslation();
  return (
    <div className="bg-tv-surface border border-tv-border rounded-2xl p-4">
      <span className="rounded-full px-3 py-1 bg-tv-bg border border-tv-border text-sm font-semibold text-tv-text-primary">
        {t("mission.validationExportPage.lifecycle")}
      </span>
      <div className="border-b border-tv-border -mx-4 mt-3" />
      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          onClick={onRequestComplete}
          disabled={!canComplete}
          title={!canComplete ? t("mission.validationExportPage.completeTooltip") : undefined}
          className={`w-full px-4 py-2.5 text-sm font-semibold rounded-full transition-colors border ${
            canComplete
              ? "border-tv-accent text-tv-accent hover:bg-tv-accent hover:text-tv-accent-text"
              : "opacity-50 cursor-not-allowed border-tv-border text-tv-text-muted"
          }`}
          data-testid="complete-btn"
        >
          {t("mission.validationExportPage.completeMission")}
        </button>
        <button
          type="button"
          onClick={onRequestCancel}
          disabled={!canCancelMission}
          title={!canCancelMission ? t("mission.validationExportPage.cancelTooltip") : undefined}
          className={`w-full px-4 py-2.5 text-sm font-semibold rounded-full transition-colors border ${
            canCancelMission
              ? "border-tv-warning text-tv-warning hover:bg-tv-warning hover:text-white"
              : "opacity-50 cursor-not-allowed border-tv-border text-tv-text-muted"
          }`}
          data-testid="cancel-mission-btn"
        >
          {t("mission.validationExportPage.cancelMission")}
        </button>
        <Button
          variant="danger"
          onClick={onRequestDelete}
          disabled={!canDelete}
          className="w-full"
          data-testid="delete-btn"
        >
          {t("mission.validationExportPage.deleteMission")}
        </Button>
      </div>
    </div>
  );
}
