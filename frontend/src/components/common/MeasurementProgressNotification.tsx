import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useMeasurementProgress } from "@/contexts/MeasurementProgressContext";

/** corner toast showing how many measurement runs are processing in the background. */
export default function MeasurementProgressNotification() {
  const { t } = useTranslation();
  const { activeCount } = useMeasurementProgress();

  if (activeCount === 0) return null;

  return (
    <div
      className="fixed bottom-24 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl bg-tv-surface border border-tv-border text-sm text-tv-text-primary min-w-[280px] max-w-[400px]"
      data-testid="measurement-progress-notification"
    >
      <Loader2 className="h-4 w-4 animate-spin text-tv-accent flex-shrink-0" />
      <span className="truncate">
        {t("measurementProgress.processing", { count: activeCount })}
      </span>
    </div>
  );
}
