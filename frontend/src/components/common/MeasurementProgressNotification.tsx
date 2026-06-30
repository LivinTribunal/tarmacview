import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useMeasurementProgress } from "@/contexts/MeasurementProgressContext";
import ToastShell from "@/components/common/ToastShell";

/** corner toast showing how many measurement runs are processing in the background. */
export default function MeasurementProgressNotification() {
  const { t } = useTranslation();
  const { activeCount } = useMeasurementProgress();

  if (activeCount === 0) return null;

  return (
    <ToastShell
      className="flex items-center gap-3 px-4 py-3 text-sm text-tv-text-primary min-w-[280px] max-w-[400px]"
      testId="measurement-progress-notification"
    >
      <Loader2 className="h-4 w-4 animate-spin text-tv-accent flex-shrink-0" />
      <span className="truncate">
        {t("measurementProgress.processing", { count: activeCount })}
      </span>
    </ToastShell>
  );
}
