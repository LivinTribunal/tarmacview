import { useTranslation } from "react-i18next";
import { Loader2, Check, X } from "lucide-react";
import { useComputation } from "@/contexts/ComputationContext";
import ToastShell from "@/components/common/ToastShell";

/** corner toast reflecting the background trajectory computation status. */
export default function ComputationNotification() {
  const { t } = useTranslation();
  const { status, missionName, error, dismiss } = useComputation();

  if (status === "IDLE") return null;

  return (
    <ToastShell
      className="flex items-center gap-3 px-4 py-3 text-sm text-tv-text-primary min-w-[280px] max-w-[400px]"
      testId="computation-notification"
    >
      {status === "COMPUTING" && (
        <>
          <Loader2 className="h-4 w-4 animate-spin text-tv-accent flex-shrink-0" />
          <span className="truncate">
            {missionName
              ? t("computation.computingNamed", { name: missionName })
              : t("computation.computing")}
          </span>
        </>
      )}

      {status === "COMPLETED" && (
        <>
          <div className="flex items-center justify-center h-5 w-5 rounded-full bg-tv-accent/20 flex-shrink-0">
            <Check className="h-3 w-3 text-tv-accent" />
          </div>
          <span className="flex-1 truncate">{t("computation.success")}</span>
          <button
            type="button"
            onClick={dismiss}
            className="flex-shrink-0 text-tv-text-muted hover:text-tv-text-primary transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      )}

      {status === "FAILED" && (
        <>
          <div className="flex items-center justify-center h-5 w-5 rounded-full bg-tv-error/20 flex-shrink-0">
            <X className="h-3 w-3 text-tv-error" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="block text-tv-error truncate">
              {t("computation.failed")}
            </span>
            {error && (
              <span className="block text-xs text-tv-text-muted truncate">
                {error}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="flex-shrink-0 text-tv-text-muted hover:text-tv-text-primary transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </ToastShell>
  );
}
